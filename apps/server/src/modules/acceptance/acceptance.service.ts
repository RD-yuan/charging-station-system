import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common'
import { ChargeMode, OrderStatus, PhysicalState, WorkingState } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { ClockService } from '../../common/clock.service'
import { PrismaService } from '../../prisma/prisma.service'
import { BillingService } from '../billing/billing.service'
import { ChargingService } from '../charging/charging.service'
import { DispatchService } from '../dispatch/dispatch.service'
import { PileService } from '../pile/pile.service'
import { QueueCacheService } from '../queue/queue-cache.service'
import {
  AcceptanceEvent,
  AcceptanceReport,
  AcceptanceReportRow,
  buildPileMapping,
  FAST_COLUMNS,
  PileMapping,
  RowSnapshot,
  SLOW_COLUMNS
} from './excel-schema'
import {
  compareExpectedVsActual,
  collectExpectedSamples,
  parseAcceptanceEvents,
  snapshotWorkbookToBuffer,
  writeExecutionLogSheet,
  writeSnapshotsToSheet
} from './excel.driver'
import {
  actionLabel,
  chargeModeFromFlag,
  resolvePileId,
  VEHICLE_PASSWORD,
  vehicleUsername
} from './event-semantics'

const RUN_LIMIT_HOUR = 9
const RUN_LIMIT_MINUTE = 30
const SERVICE_FEE_RATE_FALLBACK = 0.8

interface VehicleRuntime {
  userId: string
  username: string
  activeOrderId: string | null
}

@Injectable()
export class AcceptanceService {
  private readonly logger = new Logger(AcceptanceService.name)

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChargingService) private readonly charging: ChargingService,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(PileService) private readonly pileService: PileService,
    @Inject(DispatchService) private readonly dispatch: DispatchService,
    @Inject(QueueCacheService) private readonly queueCache: QueueCacheService,
    @Inject(ClockService) private readonly clock: ClockService
  ) {}

  async run(input: { fileBuffer?: Buffer; stopAtLimit?: boolean }): Promise<{
    report: AcceptanceReport
    excel: Buffer
  }> {
    const buffer = input.fileBuffer ?? (await this.loadDefaultFile())
    const stopAtLimit = input.stopAtLimit ?? true
    const startedAt = new Date().toISOString()

    const { events, workbook, sheet } = await parseAcceptanceEvents(buffer)

    await this.resetWorld()
    const actualPiles = await this.prisma.chargingPile.findMany({ select: { id: true, pileType: true } })
    if (actualPiles.length === 0) {
      throw new BadRequestException('数据库里没有任何充电桩，请先运行 prisma:seed。')
    }
    const mapping = buildPileMapping(actualPiles as Array<{ id: string; pileType: 'FAST' | 'SLOW' }>)
    this.logger.log(
      `桩位映射：${[...mapping.tagToPileId.entries()].map(([t, id]) => `${t}→${id}`).join(', ')}`
    )

    const expectedMap = collectExpectedSamples(sheet, mapping)

    this.clock.freeze(this.eventTime(events[0]?.rawTime ?? '06:00:00'))

    const vehicles = new Map<string, VehicleRuntime>()
    const snapshots = new Map<number, RowSnapshot>()
    const rows: AcceptanceReportRow[] = []

    for (const ev of events) {
      if (stopAtLimit && this.isAfterLimit(ev.time)) {
        rows.push(this.makeSkippedRow(ev, '到达 9:30 上限，按用例说明停止执行'))
        continue
      }
      this.clock.advanceTo(ev.time)
      await this.tick(`pre-${ev.rawTime}`)
      const row = await this.executeEvent(ev, vehicles, mapping)
      rows.push(row)
      this.clock.advanceTo(ev.time)
      await this.tick(`post-${ev.rawTime}`)
      const snap = await this.snapshot(mapping)
      snap.rowIndex = ev.rowIndex
      snap.time = ev.time
      snapshots.set(ev.rowIndex, snap)
      row.pilesActual = snap.piles
        .map((p) => {
          const slotStrs = p.slots.map((s) =>
            s.vehicle ? `${s.vehicle}/${s.deliveredEnergy.toFixed(1)}/${s.currentFee.toFixed(1)}` : '-'
          )
          return `${p.pileId}=[${slotStrs.join('|')}]`
        })
        .join('  ')
      row.waitingActual = snap.waiting.map((w) => `${w.vehicle}/${w.mode}/${w.amount.toFixed(0)}`).join(' | ')
    }

    this.clock.thaw()

    // 测试结束后立刻做一次 autoComplete 清理：把虚拟时间里还没充满的 CHARGING 订单
    // 按"已超过 requestedAmount"判定全部结算掉，避免管理端看到一堆"卡住"的进行中订单。
    // 注意：这会用真实时间判定（clock 已 thaw），session.startTime 是虚拟时间，差值很大，
    // 所以所有还活着的 CHARGING 订单都会被结算。
    await this.cleanupChargingOrders()

    await writeSnapshotsToSheet(sheet, Array.from(snapshots.values()), mapping)
    writeExecutionLogSheet(workbook, rows)
    const excel = await snapshotWorkbookToBuffer(workbook)
    const finishedAt = new Date().toISOString()

    const report = compareExpectedVsActual(expectedMap, snapshots, rows, mapping)
    report.startedAt = startedAt
    report.finishedAt = finishedAt

    return { report, excel }
  }

  async resetWorld() {
    this.logger.log('清场：删除所有充电订单/会话/账单/测试用户，重置充电桩')
    await this.prisma.billingDetail.deleteMany()
    await this.prisma.chargingSession.deleteMany()
    await this.prisma.chargingOrder.deleteMany()
    await this.prisma.user.deleteMany({
      where: { username: { startsWith: 'accept_v_' } }
    })
    await this.prisma.chargingPile.updateMany({
      data: {
        physicalState: PhysicalState.ON,
        workingState: WorkingState.IDLE,
        totalChargeCount: 0,
        totalChargeDuration: 0,
        totalChargeAmount: 0
      }
    })
    await this.queueCache.refreshAll(false)
  }

  /**
   * 测试收尾：把所有非终态订单处理掉，重置桩状态，让管理端立刻清爽。
   * - CHARGING：直接 billing.closeAndBill 生成账单（不走 charging.stop 避免和 5s autoComplete 抢）
   * - IN_PILE_QUEUE / WAITING：批量 CANCELED（没真正充电，不需要账单）
   * - ABORTED（无 detail）：批量 CANCELED
   * - 故障桩：重置 IDLE
   */
  private async cleanupChargingOrders() {
    this.logger.log('[cleanup] 开始清理残留订单')

    // CHARGING：直接走 closeAndBill，跳过 triggerBasic（与 autoComplete 等价但更快）
    let chargingOrders = await this.prisma.chargingOrder.findMany({
      where: { status: OrderStatus.CHARGING },
      select: { id: true, queueNo: true }
    })
    let completedViaCleanup = 0
    for (const order of chargingOrders) {
      try {
        await this.billing.closeAndBill(order.id, 'AUTO_COMPLETE', OrderStatus.FINISHED)
        completedViaCleanup++
      } catch (err) {
        // 多半是 autoComplete tick 抶先完成了，无碍
      }
    }
    this.logger.log(`[cleanup] CHARGING 处理 ${completedViaCleanup}/${chargingOrders.length}`)

    // IN_PILE_QUEUE / WAITING / ABORTED-no-detail：批量 CANCELED
    const pendingOrders = await this.prisma.chargingOrder.findMany({
      where: {
        status: {
          in: [OrderStatus.IN_PILE_QUEUE, OrderStatus.WAITING, OrderStatus.ABORTED]
        }
      },
      select: { id: true, queueNo: true, status: true }
    })
    if (pendingOrders.length > 0) {
      await this.prisma.chargingOrder.updateMany({
        where: { id: { in: pendingOrders.map((o) => o.id) } },
        data: {
          status: OrderStatus.CANCELED,
          assignedPileId: null,
          pileQueueEnteredAt: null
        }
      })
      this.logger.log(
        `[cleanup] 批量取消 ${pendingOrders.length} 个非终态订单：${pendingOrders.map((o) => `${o.queueNo}(${o.status})`).join(', ')}`
      )
    }

    // 重置故障桩
    const faultedPiles = await this.prisma.chargingPile.findMany({
      where: { workingState: WorkingState.FAULT },
      select: { id: true }
    })
    if (faultedPiles.length > 0) {
      await this.prisma.chargingPile.updateMany({
        where: { id: { in: faultedPiles.map((p) => p.id) } },
        data: { workingState: WorkingState.IDLE }
      })
      this.logger.log(`[cleanup] 重置故障桩：${faultedPiles.map((p) => p.id).join(', ')}`)
    }

    await this.queueCache.refreshAll(false)
    this.logger.log('[cleanup] 完成')
  }

  /**
   * 充电达到 requestedAmount 时主动结算。
   * 后台 ChargingAutoCompleteService 默认 5s 轮询也会做这件事，
   * 但在虚拟时钟模式下 setInterval 节奏对不上事件节奏，
   * 所以驱动里在每次时钟推进后同步触发一次，确保快照拍摄前状态已经收敛。
   */
  private async tick(label: string) {
    const now = this.clock.now()
    const chargingOrders = await this.prisma.chargingOrder.findMany({
      where: { status: OrderStatus.CHARGING },
      include: {
        assignedPile: true,
        sessions: { where: { sessionStatus: 'ACTIVE' }, take: 1 }
      }
    })
    for (const order of chargingOrders) {
      const session = order.sessions[0]
      if (!session || !order.assignedPile) continue
      const elapsedHours = Math.max(0, (now.getTime() - session.startTime.getTime()) / 3_600_000)
      const delivered = elapsedHours * order.assignedPile.power
      if (delivered + 1e-6 >= order.requestedAmount) {
        try {
          await this.charging.stop(order.id)
        } catch (err) {
          const msg = (err as Error).message
          // 与后台 5s autoComplete tick 抢同一订单时会撞这个错，订单确实被完成了，无碍
          if (!msg.includes('Only CHARGING orders can be stopped')) {
            this.logger.warn(`[${label}] auto-stop ${order.queueNo} 失败：${msg}`)
          }
        }
      }
    }
  }

  private async loadDefaultFile(): Promise<Buffer> {
    const fs = await import('fs')
    const path = await import('path')
    const candidates = [
      path.resolve(process.cwd(), '作业验收用例.xlsx'),
      path.resolve(process.cwd(), '..', '作业验收用例.xlsx'),
      path.resolve(process.cwd(), '..', '..', '作业验收用例.xlsx'),
      path.resolve(process.cwd(), '..', '..', '..', '作业验收用例.xlsx')
    ]
    for (const candidate of candidates) {
      try {
        await fs.promises.access(candidate)
        return await fs.promises.readFile(candidate)
      } catch {
        // continue
      }
    }
    throw new BadRequestException(
      `未找到默认的 作业验收用例.xlsx（已查找：${candidates.join('；')}）。请在前端上传文件，或把它放在工程根目录 / apps/server 目录。`
    )
  }

  private isAfterLimit(time: Date): boolean {
    const minutes = time.getHours() * 60 + time.getMinutes()
    return minutes > RUN_LIMIT_HOUR * 60 + RUN_LIMIT_MINUTE
  }

  private eventTime(raw: string): Date {
    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim())
    const base = new Date('2026-06-15T00:00:00')
    if (!match) return base
    base.setHours(Number(match[1]), Number(match[2]), match[3] ? Number(match[3]) : 0, 0)
    return base
  }

  private makeSkippedRow(ev: AcceptanceEvent, msg: string): AcceptanceReportRow {
    return {
      rowIndex: ev.rowIndex,
      time: ev.rawTime,
      event: ev.raw,
      actionLabel: '跳过',
      apiCalled: '-',
      apiStatus: 'SKIPPED',
      apiMessage: msg,
      pilesActual: '',
      waitingActual: '',
      expectedSamples: []
    }
  }

  private async executeEvent(
    ev: AcceptanceEvent,
    vehicles: Map<string, VehicleRuntime>,
    mapping: PileMapping
  ): Promise<AcceptanceReportRow> {
    const tuple = ev.parsed
    const base: AcceptanceReportRow = {
      rowIndex: ev.rowIndex,
      time: ev.rawTime,
      event: ev.raw,
      actionLabel: tuple ? actionLabel(tuple, mapping) : '未知事件',
      apiCalled: '',
      apiStatus: 'OK',
      apiMessage: '',
      pilesActual: '',
      waitingActual: '',
      expectedSamples: []
    }
    if (!tuple) {
      base.apiStatus = 'ERROR'
      base.apiMessage = '无法解析事件元组'
      return base
    }
    try {
      switch (tuple.action) {
        case 'A':
          if (tuple.value === '0') {
            await this.handleCancel(tuple, vehicles, base)
          } else {
            await this.handleArrive(tuple, vehicles, base)
          }
          break
        case 'B':
          await this.handlePileEvent(tuple, base, mapping)
          break
        case 'C':
          await this.handleChangeRequest(tuple, vehicles, base)
          break
        default:
          base.apiStatus = 'SKIPPED'
          base.apiMessage = `未实现的动作 ${tuple.action}`
      }
    } catch (err) {
      base.apiStatus = 'ERROR'
      base.apiMessage = err instanceof Error ? err.message : String(err)
    }
    return base
  }

  private async handleArrive(
    tuple: { target: string; flag: string; value: string },
    vehicles: Map<string, VehicleRuntime>,
    base: AcceptanceReportRow
  ) {
    const mode = chargeModeFromFlag(tuple.flag)
    if (!mode) throw new BadRequestException(`未知的充电类型 ${tuple.flag}`)
    const amount = Number(tuple.value)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException(`无效的充电量 ${tuple.value}`)
    }
    const runtime = await this.ensureVehicle(tuple.target)
    vehicles.set(tuple.target, runtime)
    base.apiCalled = `POST /api/charging/request (mode=${mode}, amount=${amount}, userId=${runtime.userId})`
    const result = await this.charging.submitRequest(
      {
        chargeMode: mode as ChargeMode,
        requestedAmount: amount,
        userId: runtime.userId
      }
    )
    runtime.activeOrderId = result.orderId
    base.apiMessage = `orderId=${result.orderId}; queueNo=${result.queueNo}; area=${result.queueArea}; pile=${result.assignedPileId ?? '-'}`
  }

  private async handleCancel(
    tuple: { target: string },
    vehicles: Map<string, VehicleRuntime>,
    base: AcceptanceReportRow
  ) {
    let runtime = vehicles.get(tuple.target)
    if (!runtime || !runtime.activeOrderId) {
      const userId = await this.resolveUserId(tuple.target)
      if (!userId) {
        base.apiStatus = 'SKIPPED'
        base.apiMessage = `${tuple.target} 当前没有活动订单`
        return
      }
      const current = await this.charging.current(userId)
      if (!current) {
        base.apiStatus = 'SKIPPED'
        base.apiMessage = `${tuple.target} 当前没有活动订单`
        return
      }
      runtime = { userId, username: vehicleUsername(tuple.target), activeOrderId: current.orderId }
      vehicles.set(tuple.target, runtime)
    }
    const orderId = runtime.activeOrderId!
    base.apiCalled = `POST /api/charging/${orderId}/cancel`
    const result: any = await this.charging.cancel(orderId, { reason: 'USER_STOP' })
    runtime.activeOrderId = null
    base.apiMessage = `cancel result: ${JSON.stringify(result).slice(0, 160)}`
  }

  private async handlePileEvent(
    tuple: { target: string; value: string },
    base: AcceptanceReportRow,
    mapping: PileMapping
  ) {
    const pileId = resolvePileId(tuple.target, mapping)
    if (!pileId) throw new BadRequestException(`无法识别桩编号 ${tuple.target}（DB 中可能没有对应类型的桩）`)
    if (tuple.value === '0') {
      base.apiCalled = `POST /api/admin/piles/${pileId}/fault`
      const result = await this.pileService.reportFault(pileId)
      base.apiMessage = `fault; affected=${result.affectedCount}`
    } else {
      base.apiCalled = `POST /api/admin/piles/${pileId}/recover`
      const result = await this.pileService.recover(pileId)
      base.apiMessage = `recover; restored=${result.restoredOrderIds.length}; resumed=${result.resumed.length}`
    }
  }

  private async handleChangeRequest(
    tuple: { target: string; flag: string; value: string },
    vehicles: Map<string, VehicleRuntime>,
    base: AcceptanceReportRow
  ) {
    const wantsModeChange = tuple.flag === 'F' || tuple.flag === 'T'
    const numericAmount = Number(tuple.value)
    const wantsAmountChange = Number.isFinite(numericAmount) && tuple.value !== '-1'
    if (wantsAmountChange && numericAmount <= 0) {
      throw new BadRequestException(`无效的新充电量 ${tuple.value}`)
    }
    if (!wantsModeChange && !wantsAmountChange) {
      base.apiStatus = 'SKIPPED'
      base.apiMessage = `${tuple.target} 变更内容为空（类型不变 + 电量不变）`
      return
    }

    const runtime = vehicles.get(tuple.target) ?? (await this.refreshRuntime(tuple.target))
    if (!runtime || !runtime.activeOrderId) {
      base.apiStatus = 'SKIPPED'
      base.apiMessage = `${tuple.target} 没有可修改的订单`
      return
    }
    const orderId = runtime.activeOrderId
    const apiCalls: string[] = []
    const messages: string[] = []

    if (wantsModeChange) {
      const newMode = tuple.flag === 'F' ? ChargeMode.FAST : ChargeMode.SLOW
      apiCalls.push(`PUT /api/charging/${orderId}/mode (newMode=${newMode})`)
      const result = await this.charging.modifyMode(orderId, { newMode })
      messages.push(`mode→${result.chargeMode}`)
    }
    if (wantsAmountChange) {
      apiCalls.push(`PUT /api/charging/${orderId}/amount (newAmount=${numericAmount})`)
      const result = await this.charging.modifyAmount(orderId, { newAmount: numericAmount })
      messages.push(`amount→${result.requestedAmount}`)
    }
    base.apiCalled = apiCalls.join(' + ')
    base.apiMessage = messages.join('; ')
  }

  private async ensureVehicle(vehicleId: string): Promise<VehicleRuntime> {
    const username = vehicleUsername(vehicleId)
    const existing = await this.prisma.user.findUnique({ where: { username } })
    if (existing) {
      return { userId: existing.id, username, activeOrderId: null }
    }
    const passwordHash = await bcrypt.hash(VEHICLE_PASSWORD, 10)
    const created = await this.prisma.user.create({
      data: { username, passwordHash, role: 'USER', batteryCapacity: 200 }
    })
    return { userId: created.id, username, activeOrderId: null }
  }

  private async resolveUserId(vehicleId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({ where: { username: vehicleUsername(vehicleId) } })
    return user?.id ?? null
  }

  private async refreshRuntime(vehicleId: string): Promise<VehicleRuntime | null> {
    const userId = await this.resolveUserId(vehicleId)
    if (!userId) return null
    const current = await this.charging.current(userId)
    return {
      userId,
      username: vehicleUsername(vehicleId),
      activeOrderId: current?.orderId ?? null
    }
  }

  private async snapshot(mapping: PileMapping): Promise<RowSnapshot> {
    const rules = await this.billing.activeRules()
    const serviceFeeRate = rules[0]?.serviceFeeRate ?? SERVICE_FEE_RATE_FALLBACK
    const now = this.clock.now()

    const piles = await this.prisma.chargingPile.findMany({
      where: { id: { in: [...mapping.pileIdToCol.keys()] } },
      include: {
        orders: {
          where: { status: { in: [OrderStatus.CHARGING, OrderStatus.IN_PILE_QUEUE] } },
          include: {
            user: true,
            sessions: { orderBy: { startTime: 'asc' } }
          },
          orderBy: [{ status: 'desc' }, { pileQueueEnteredAt: 'asc' }, { submitTime: 'asc' }]
        }
      }
    })

    const pileSnapshots = [...mapping.pileIdToCol.keys()].map((pileId) => {
      const pile = piles.find((p) => p.id === pileId)
      const emptySlot = () => ({ vehicle: null, deliveredEnergy: 0, currentFee: 0 })
      if (!pile) return { pileId, slots: [emptySlot(), emptySlot(), emptySlot()] }

      // 把订单排成 3 个席位：CHARGING 优先（slot 0），剩下按 pileQueueEnteredAt 排序
      const chargingOrder = pile.orders.find((o) => o.status === OrderStatus.CHARGING)
      const queuedOrders = pile.orders
        .filter((o) => o.status === OrderStatus.IN_PILE_QUEUE)
        .sort((a, b) => (a.pileQueueEnteredAt?.getTime() ?? 0) - (b.pileQueueEnteredAt?.getTime() ?? 0))
      const ordered = chargingOrder ? [chargingOrder, ...queuedOrders] : queuedOrders

      const slots = []
      for (let i = 0; i < 3; i++) {
        const order = ordered[i]
        if (!order) {
          slots.push(emptySlot())
          continue
        }
        if (order.status === OrderStatus.CHARGING) {
          // 已完成 session 累加 + 当前 ACTIVE session 按 (now - startTime) × power
          const completed = order.sessions
            .filter((s) => s.sessionStatus !== 'ACTIVE')
            .reduce((sum, s) => sum + (s.actualAmount ?? 0), 0)
          const active = order.sessions.find((s) => s.sessionStatus === 'ACTIVE')
          let activeDelivered = 0
          if (active && active.startTime) {
            const elapsedH = Math.max(0, (now.getTime() - active.startTime.getTime()) / 3_600_000)
            activeDelivered = elapsedH * pile.power
          }
          const delivered = Math.min(order.requestedAmount, completed + activeDelivered)
          const price = this.priceAt(now, rules)
          const fee = Math.round((delivered * (price + serviceFeeRate)) * 100) / 100
          slots.push({
            vehicle: vehicleLabel(order.user.username),
            deliveredEnergy: Math.round(delivered * 100) / 100,
            currentFee: fee
          })
        } else {
          // IN_PILE_QUEUE：还在排队没开始充，0 度 0 元
          slots.push({
            vehicle: vehicleLabel(order.user.username),
            deliveredEnergy: 0,
            currentFee: 0
          })
        }
      }
      return { pileId, slots }
    })

    const waitingRaw = await this.prisma.chargingOrder.findMany({
      where: { status: OrderStatus.WAITING },
      orderBy: [{ submitTime: 'asc' }, { queueNo: 'asc' }],
      include: { user: true }
    })
    const waiting = waitingRaw.map((order) => ({
      vehicle: vehicleLabel(order.user.username),
      mode: (order.chargeMode === 'FAST' ? 'F' : 'T') as 'F' | 'T',
      amount: Number(order.requestedAmount)
    }))

    return { rowIndex: 0, time: now, piles: pileSnapshots, waiting }
  }

  private priceAt(time: Date, rules: Array<{ startMinute: number; endMinute: number; price: number }>): number {
    const minute = time.getHours() * 60 + time.getMinutes()
    for (const rule of rules) {
      if (rule.startMinute < rule.endMinute) {
        if (minute >= rule.startMinute && minute < rule.endMinute) return rule.price
      } else if (minute >= rule.startMinute || minute < rule.endMinute) {
        return rule.price
      }
    }
    return 0.7
  }
}

function vehicleLabel(username: string | undefined): string {
  if (!username) return '?'
  const match = /accept_v_([A-Za-z0-9_]+)/.exec(username)
  if (!match) return username
  return match[1].toUpperCase()
}
