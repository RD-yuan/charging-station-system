import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
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
    @Inject(ClockService) private readonly clock: ClockService,
    @Inject(ConfigService) private readonly config: ConfigService
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
   * 扩展 a 演示：单次最优调度（SPT）。
   * 流程：清场 → 创建 4 个 FAST 用户 → 用 6 个"填充订单"占满 F1/F2 →
   *      提交 4 个目标订单（被迫进 WAITING）→ 取消填充订单腾出 6 个 slot →
   *      触发 singleOptimalDispatch → 读回实际分配 → 与期望对比。
   */
  async runSingleOptimalDemo(): Promise<{
    strategy: string
    scenario: string
    expected: Array<{ vehicle: string; pile: string; finishTime: number }>
    actual: Array<{ vehicle: string; pile: string; finishTime: number }>
    expectedTotal: number
    actualTotal: number
    pass: boolean
  }> {
    await this.resetWorld()

    const targetOrders = [
      { vehicle: 'V1', amount: 30 },
      { vehicle: 'V2', amount: 60 },
      { vehicle: 'V3', amount: 90 },
      { vehicle: 'V4', amount: 120 }
    ]
    const fillerCount = 6 // 占满 F1+F2 共 6 slot
    const fastPiles = await this.prisma.chargingPile.findMany({
      where: { pileType: 'FAST' as ChargeMode },
      orderBy: { id: 'asc' }
    })
    const fastCapacity = fastPiles.length * Number(this.config.get<string>('CHARGING_QUEUE_LEN') ?? 2)

    // 1. 创建 4 个目标用户 + N 个填充用户
    for (const t of targetOrders) {
      await this.ensureDemoUser(t.vehicle)
    }
    for (let i = 1; i <= fillerCount; i++) {
      await this.ensureDemoUser(`FILLER_${i}`)
    }

    // 2. 先提交填充订单（占满 FAST 桩）
    for (let i = 1; i <= fillerCount; i++) {
      const u = await this.findUser(`FILLER_${i}`)
      if (u) await this.charging.submitRequest({ chargeMode: 'FAST' as ChargeMode, requestedAmount: 10, userId: u.id })
    }

    // 3. 提交 4 个目标订单（它们会进 WAITING，因为 FAST 桩已满）
    const targetUserMap = new Map<string, string>()
    for (const t of targetOrders) {
      const u = await this.findUser(t.vehicle)
      if (u) {
        targetUserMap.set(t.vehicle, u.id)
        await this.charging.submitRequest({ chargeMode: 'FAST' as ChargeMode, requestedAmount: t.amount, userId: u.id })
      }
    }

    // 4. 取消所有填充订单（让出 slot，状态回 WAITING 区的 4 个目标订单保持不变）
    const fillers = await this.prisma.chargingOrder.findMany({
      where: { user: { username: { startsWith: 'accept_v_filler_' } }, status: { in: [OrderStatus.IN_PILE_QUEUE, OrderStatus.CHARGING] } }
    })
    for (const f of fillers) {
      try { await this.charging.cancel(f.id, { reason: 'USER_STOP' }) } catch {}
    }

    // 5. 触发单次最优调度
    const result = await this.dispatch.triggerSingleOptimal('FAST' as ChargeMode)

    // 6. 读回实际分配
    const actual: Array<{ vehicle: string; pile: string; finishTime: number }> = []
    for (const t of targetOrders) {
      const uid = targetUserMap.get(t.vehicle)
      if (!uid) continue
      const order = await this.prisma.chargingOrder.findFirst({
        where: { userId: uid, status: OrderStatus.IN_PILE_QUEUE },
        include: { assignedPile: true, sessions: true }
      })
      if (!order || !order.assignedPile) {
        actual.push({ vehicle: t.vehicle, pile: '(未分配)', finishTime: 0 })
        continue
      }
      // 计算完工时间：(队前电量 + 自身电量) / power
      const queueAhead = await this.prisma.chargingOrder.count({
        where: {
          assignedPileId: order.assignedPileId,
          status: OrderStatus.IN_PILE_QUEUE,
          OR: [
            { pileQueueEnteredAt: { lt: order.pileQueueEnteredAt ?? new Date(0) } },
            { id: order.id }
          ]
        }
      })
      const aheadOrders = await this.prisma.chargingOrder.findMany({
        where: {
          assignedPileId: order.assignedPileId,
          status: { in: [OrderStatus.IN_PILE_QUEUE, OrderStatus.CHARGING] },
          pileQueueEnteredAt: { lt: order.pileQueueEnteredAt ?? new Date(0) }
        }
      })
      const aheadAmount = aheadOrders.reduce((s, o) => s + o.requestedAmount, 0)
      const finishTime = (aheadAmount + t.amount) / order.assignedPile.power
      actual.push({
        vehicle: t.vehicle,
        pile: order.assignedPile.id,
        finishTime: Math.round(finishTime * 100) / 100
      })
    }

    // 7. 期望（SPT 规则）：V1→F1(1h), V2→F2(2h), V3→F1(4h), V4→F2(6h)
    const expected = [
      { vehicle: 'V1', pile: fastPiles[0]?.id ?? 'F1', finishTime: 1 },
      { vehicle: 'V2', pile: fastPiles[1]?.id ?? 'F2', finishTime: 2 },
      { vehicle: 'V3', pile: fastPiles[0]?.id ?? 'F1', finishTime: 4 },
      { vehicle: 'V4', pile: fastPiles[1]?.id ?? 'F2', finishTime: 6 }
    ]
    const expectedTotal = expected.reduce((s, e) => s + e.finishTime, 0)
    const actualTotal = actual.reduce((s, a) => s + a.finishTime, 0)

    return {
      strategy: 'SINGLE_OPTIMAL_DEMO',
      scenario: `4 辆 FAST 车 (V1=30, V2=60, V3=90, V4=120 度) + 2 个 FAST 桩（${fastPiles.map((p) => p.id).join(',')}，均 ${fastPiles[0]?.power} 度/h）`,
      expected,
      actual,
      expectedTotal,
      actualTotal,
      pass: Math.abs(expectedTotal - actualTotal) < 0.01
    }
  }

  /**
   * 扩展 b 演示：批量最优调度。
   * 流程：清场 → 创建 25 个用户 → 提交 25 个混合 F/T 订单 →
   *      触发 batchOptimalDispatch → 读回实际分配 → 与期望对比。
   */
  async runBatchOptimalDemo(): Promise<{
    strategy: string
    scenario: string
    expected: Array<{ vehicle: string; pile: string; finishTime: number; inWaiting?: boolean }>
    actual: Array<{ vehicle: string; pile: string; finishTime: number; inWaiting?: boolean }>
    expectedTotal: number
    actualTotal: number
    pass: boolean
  }> {
    await this.resetWorld()

    // 25 辆车（13 F + 12 T），来自测试用例 Excel
    const vehicles = [
      { v: 'V1', amt: 100, mode: 'F' as const }, { v: 'V2', amt: 30, mode: 'T' as const },
      { v: 'V3', amt: 90, mode: 'F' as const },  { v: 'V4', amt: 20, mode: 'T' as const },
      { v: 'V5', amt: 110, mode: 'F' as const }, { v: 'V6', amt: 15, mode: 'T' as const },
      { v: 'V7', amt: 80, mode: 'F' as const },  { v: 'V8', amt: 25, mode: 'T' as const },
      { v: 'V9', amt: 60, mode: 'F' as const },  { v: 'V10', amt: 10, mode: 'T' as const },
      { v: 'V11', amt: 70, mode: 'F' as const }, { v: 'V12', amt: 35, mode: 'T' as const },
      { v: 'V13', amt: 50, mode: 'F' as const }, { v: 'V14', amt: 40, mode: 'T' as const },
      { v: 'V15', amt: 95, mode: 'F' as const }, { v: 'V16', amt: 5, mode: 'T' as const },
      { v: 'V17', amt: 85, mode: 'F' as const }, { v: 'V18', amt: 45, mode: 'T' as const },
      { v: 'V19', amt: 75, mode: 'F' as const }, { v: 'V20', amt: 20, mode: 'T' as const },
      { v: 'V21', amt: 65, mode: 'F' as const }, { v: 'V22', amt: 30, mode: 'T' as const },
      { v: 'V23', amt: 55, mode: 'F' as const }, { v: 'V24', amt: 15, mode: 'T' as const },
      { v: 'V25', amt: 105, mode: 'F' as const }
    ]

    // 创建用户 + 提交订单
    const userMap = new Map<string, string>()
    for (const x of vehicles) {
      await this.ensureDemoUser(x.v)
      const u = await this.findUser(x.v)
      if (u) userMap.set(x.v, u.id)
    }
    for (const x of vehicles) {
      const uid = userMap.get(x.v)
      if (uid) {
        await this.charging.submitRequest({
          chargeMode: x.mode === 'F' ? 'FAST' as ChargeMode : 'SLOW' as ChargeMode,
          requestedAmount: x.amt,
          userId: uid
        })
      }
    }

    // 触发批量最优
    await this.dispatch.triggerBatchOptimal(true)

    // 读回实际分配
    const actual: Array<{ vehicle: string; pile: string; finishTime: number; inWaiting?: boolean }> = []
    for (const x of vehicles) {
      const uid = userMap.get(x.v)
      if (!uid) continue
      const order = await this.prisma.chargingOrder.findFirst({
        where: { userId: uid, status: { in: [OrderStatus.WAITING, OrderStatus.IN_PILE_QUEUE] } },
        include: { assignedPile: true }
      })
      if (!order) {
        actual.push({ vehicle: x.v, pile: '(未找到)', finishTime: 0 })
        continue
      }
      if (order.status === OrderStatus.WAITING) {
        actual.push({ vehicle: x.v, pile: '等候区', finishTime: 0, inWaiting: true })
        continue
      }
      if (!order.assignedPile) {
        actual.push({ vehicle: x.v, pile: '(未分配)', finishTime: 0 })
        continue
      }
      const aheadOrders = await this.prisma.chargingOrder.findMany({
        where: {
          assignedPileId: order.assignedPileId,
          status: { in: [OrderStatus.IN_PILE_QUEUE, OrderStatus.CHARGING] },
          pileQueueEnteredAt: { lt: order.pileQueueEnteredAt ?? new Date(0) }
        }
      })
      const aheadAmount = aheadOrders.reduce((s, o) => s + o.requestedAmount, 0)
      const finishTime = (aheadAmount + x.amt) / order.assignedPile.power
      actual.push({
        vehicle: x.v,
        pile: order.assignedPile.id,
        finishTime: Math.round(finishTime * 100) / 100
      })
    }

    // 期望（按 SPT 算法预先算出的最优分配）
    const expected = [
      { vehicle: 'V16', pile: '最快F桩', finishTime: 0.17 },
      { vehicle: 'V10', pile: '次快F桩', finishTime: 0.33 },
      { vehicle: 'V6', pile: '最快F桩', finishTime: 0.67 },
      { vehicle: 'V24', pile: '次快F桩', finishTime: 0.83 },
      { vehicle: 'V4', pile: '最快F桩', finishTime: 1.33 },
      { vehicle: 'V20', pile: '次快F桩', finishTime: 1.5 },
      { vehicle: 'V8', pile: 'T桩#1', finishTime: 2.5 },
      { vehicle: 'V2', pile: 'T桩#2', finishTime: 3.0 },
      { vehicle: 'V22', pile: 'T桩#3', finishTime: 3.0 },
      { vehicle: 'V12', pile: 'T桩#1', finishTime: 6.0 },
      { vehicle: 'V14', pile: 'T桩#2', finishTime: 7.0 },
      { vehicle: 'V18', pile: 'T桩#3', finishTime: 7.5 },
      { vehicle: 'V13', pile: 'T桩#1', finishTime: 11.0 },
      { vehicle: 'V23', pile: 'T桩#2', finishTime: 12.5 },
      { vehicle: 'V9', pile: 'T桩#3', finishTime: 13.5 },
      // 等候区（10 辆大单）
      { vehicle: 'V21', pile: '等候区', finishTime: 0, inWaiting: true },
      { vehicle: 'V11', pile: '等候区', finishTime: 0, inWaiting: true },
      { vehicle: 'V19', pile: '等候区', finishTime: 0, inWaiting: true },
      { vehicle: 'V7', pile: '等候区', finishTime: 0, inWaiting: true },
      { vehicle: 'V17', pile: '等候区', finishTime: 0, inWaiting: true },
      { vehicle: 'V3', pile: '等候区', finishTime: 0, inWaiting: true },
      { vehicle: 'V15', pile: '等候区', finishTime: 0, inWaiting: true },
      { vehicle: 'V1', pile: '等候区', finishTime: 0, inWaiting: true },
      { vehicle: 'V25', pile: '等候区', finishTime: 0, inWaiting: true },
      { vehicle: 'V5', pile: '等候区', finishTime: 0, inWaiting: true }
    ]
    const expectedTotal = 70.83
    const actualTotal = actual.filter((a) => !a.inWaiting).reduce((s, a) => s + a.finishTime, 0)

    return {
      strategy: 'BATCH_OPTIMAL_DEMO',
      scenario: `25 辆车（混合 F/T），5 桩（F1/F2=30度/h, T1/T2/T3=10度/h），每桩 3 席位 + 10 等候`,
      expected,
      actual,
      expectedTotal,
      actualTotal,
      pass: Math.abs(expectedTotal - actualTotal) < 1.0
    }
  }

  private async ensureDemoUser(vehicleId: string): Promise<void> {
    const username = `accept_v_${vehicleId.toLowerCase()}`
    const existing = await this.prisma.user.findUnique({ where: { username } })
    if (existing) return
    const bcrypt = await import('bcryptjs')
    await this.prisma.user.create({
      data: {
        username,
        passwordHash: await bcrypt.hash(VEHICLE_PASSWORD, 10),
        role: 'USER' as const,
        batteryCapacity: 200
      }
    })
  }

  private async findUser(vehicleId: string): Promise<{ id: string } | null> {
    const username = `accept_v_${vehicleId.toLowerCase()}`
    return this.prisma.user.findUnique({ where: { username }, select: { id: true } })
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
