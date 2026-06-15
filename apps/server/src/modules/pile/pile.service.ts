import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { ChargeMode, OrderStatus, PhysicalState, WorkingState } from '@prisma/client'
import { chargingProgress, deliveredAmount } from '../../common/charging'
import { virtualNowMs } from '../../common/clock'
import { DispatchStrategyType } from '../../common/enums'
import { PrismaService } from '../../prisma/prisma.service'
import { RealtimeService } from '../../realtime/realtime.service'
import { BillingService } from '../billing/billing.service'
import { DispatchService } from '../dispatch/dispatch.service'
import { QueueCacheService } from '../queue/queue-cache.service'

@Injectable()
export class PileService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DispatchService) private readonly dispatchService: DispatchService,
    @Inject(BillingService) private readonly billingService: BillingService,
    @Inject(QueueCacheService) private readonly queueCache: QueueCacheService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService
  ) {}

  async list() {
    // 查询前先自动结束已充满的订单
    await this.dispatchService.autoCompleteCharging()

    const piles = await this.prisma.chargingPile.findMany({
      orderBy: { id: 'asc' },
      include: {
        orders: {
          where: { status: { in: [OrderStatus.CHARGING, OrderStatus.IN_PILE_QUEUE] } },
          include: {
            user: true,
            sessions: {
              where: { sessionStatus: 'ACTIVE' },
              orderBy: { startTime: 'desc' },
              take: 1
            }
          },
          orderBy: [{ startedAt: 'desc' }, { pileQueueEnteredAt: 'asc' }, { submitTime: 'asc' }]
        }
      }
    })
    return piles.map((pile) => ({
      id: pile.id,
      pileId: pile.id,
      type: pile.pileType,
      pileType: pile.pileType,
      power: pile.power,
      physicalState: pile.physicalState,
      workingState: pile.workingState,
      totalChargeCount: pile.totalChargeCount,
      totalChargeDuration: pile.totalChargeDuration,
      totalChargeAmount: pile.totalChargeAmount,
      totalEnergy: pile.totalChargeAmount,
      queue: pile.orders.map((order) => {
        const progress = chargingProgress(order, pile.power)
        return {
          id: order.id,
          orderId: order.id,
          queueNo: order.queueNo,
          status: order.status,
          progress,
          userId: order.userId,
          username: order.user.username,
          batteryCapacity: order.user.batteryCapacity,
          amount: order.requestedAmount,
          requestedAmount: order.requestedAmount,
          activeSessionId: order.sessions[0]?.id ?? null,
          startedAt: order.startedAt,
          deliveredAmount: deliveredAmount(order, pile.power),
          waitMinutes: Math.max(0, Math.round((virtualNowMs() - order.submitTime.getTime()) / 60_000))
        }
      })
    }))
  }

  queue(pileId: string) {
    return this.prisma.chargingOrder.findMany({
      where: { assignedPileId: pileId, status: { in: [OrderStatus.IN_PILE_QUEUE, OrderStatus.CHARGING] } },
      orderBy: [{ startedAt: 'desc' }, { pileQueueEnteredAt: 'asc' }, { submitTime: 'asc' }],
      include: {
        user: true,
        sessions: {
          where: { sessionStatus: 'ACTIVE' },
          orderBy: { startTime: 'desc' },
          take: 1
        },
        assignedPile: true
      }
    }).then((orders) =>
      orders.map((order) => ({
        orderId: order.id,
        queueNo: order.queueNo,
        status: order.status,
        userId: order.userId,
        batteryCapacity: order.user.batteryCapacity,
        requestedAmount: order.requestedAmount,
        progress: chargingProgress(order, order.assignedPile?.power ?? 0),
        activeSessionId: order.sessions[0]?.id ?? null,
        waitMinutes: Math.max(0, Math.round((Date.now() - order.submitTime.getTime()) / 60_000))
      }))
    )
  }

  async powerOn(pileId: string) {
    const current = await this.prisma.chargingPile.findUniqueOrThrow({ where: { id: pileId } })
    const nextWorkingState = current.workingState === WorkingState.FAULT
      ? WorkingState.FAULT
      : WorkingState.IDLE
    const pile = await this.prisma.chargingPile.update({
      where: { id: pileId },
      data: { physicalState: PhysicalState.ON, workingState: nextWorkingState }
    })
    await this.queueCache.refreshPile(pileId)
    if (pile.workingState !== WorkingState.FAULT) await this.dispatchService.triggerBasic(pile.pileType)
    return pile
  }

  async powerOff(pileId: string) {
    const current = await this.prisma.chargingPile.findUniqueOrThrow({ where: { id: pileId } })
    const active = await this.prisma.chargingOrder.findFirst({
      where: { assignedPileId: pileId, status: OrderStatus.CHARGING }
    })
    if (active) throw new BadRequestException('Cannot power off a pile while it is charging.')

    const nextWorkingState = current.workingState === WorkingState.FAULT
      ? WorkingState.FAULT
      : WorkingState.IDLE
    const pile = await this.prisma.chargingPile.update({
      where: { id: pileId },
      data: { physicalState: PhysicalState.OFF, workingState: nextWorkingState }
    })
    await this.queueCache.refreshPile(pileId)
    return pile
  }

  async reportFault(pileId: string) {
    const pile = await this.prisma.chargingPile.findUniqueOrThrow({ where: { id: pileId } })
    const active = await this.prisma.chargingOrder.findFirst({
      where: { assignedPileId: pileId, status: OrderStatus.CHARGING }
    })

    // 1. 中止正在充电的订单，生成详单
    let detail: unknown = null
    let continuationOrderId: string | null = null
    if (active) {
      detail = await this.billingService.closeAndBill(active.id, 'FAULT', OrderStatus.ABORTED, WorkingState.FAULT)
      // 计算剩余未充电量，创建续充订单（WAITING 以便进入重调度）
      const detailRecord = await this.prisma.billingDetail.findUnique({ where: { orderId: active.id } })
      const remaining = Math.round((active.requestedAmount - (detailRecord?.actualAmount ?? 0)) * 100) / 100
      if (remaining > 0) {
        const queueNo = await this.nextRescheduleQueueNo(active.chargeMode)
        const continuation = await this.prisma.chargingOrder.create({
          data: {
            userId: active.userId,
            chargeMode: active.chargeMode,
            requestedAmount: remaining,
            queueNo,
            status: OrderStatus.WAITING
          }
        })
        continuationOrderId = continuation.id
      }
    }

    // 2. 将充电桩置为 FAULT
    const updated = await this.prisma.chargingPile.update({
      where: { id: pileId },
      data: { workingState: WorkingState.FAULT }
    })

    // 3. 受影响的桩队列订单（含明细）
    const affectedOrders = await this.prisma.chargingOrder.findMany({
      where: { assignedPileId: pileId, status: OrderStatus.IN_PILE_QUEUE },
      include: { user: true },
      orderBy: [{ pileQueueEnteredAt: 'asc' }, { submitTime: 'asc' }]
    })

    // 4. 刷新缓存并广播
    await this.queueCache.refreshPile(pileId)
    this.realtime.broadcast('fault_event', {
      pileId,
      mode: pile.pileType,
      affectedCount: affectedOrders.length,
      abortedOrderId: active?.id ?? null,
      continuationOrderId,
      affectedOrders: affectedOrders.map((o) => ({
        orderId: o.id,
        queueNo: o.queueNo,
        userId: o.userId,
        username: o.user.username,
        requestedAmount: o.requestedAmount,
        status: o.status
      }))
    })

    // 5. 自动执行故障优先级调度，之后触发基础调度处理等候区订单
    if (affectedOrders.length > 0 || continuationOrderId) {
      await this.dispatchService.triggerFaultReschedule(pileId, DispatchStrategyType.PRIORITY)
      await this.dispatchService.triggerBasic(pile.pileType)
    }

    return { pile: updated, affectedCount: affectedOrders.length, detail, continuationOrderId, affectedOrders }
  }

  reschedule(pileId: string, strategyType: DispatchStrategyType) {
    return this.dispatchService.triggerFaultReschedule(pileId, strategyType)
  }

  async recover(pileId: string) {
    const pile = await this.prisma.chargingPile.update({
      where: { id: pileId },
      data: { workingState: WorkingState.IDLE }
    })
    await this.queueCache.refreshPile(pileId)
    if (pile.physicalState === PhysicalState.ON) {
      await this.dispatchService.triggerRecoveryReschedule(pileId)
      await this.dispatchService.triggerBasic(pile.pileType)
    }
    return pile
  }

  private async nextRescheduleQueueNo(mode: ChargeMode) {
    const prefix = mode === 'FAST' ? 'F' : 'T'
    const existing = await this.prisma.chargingOrder.findMany({
      where: { chargeMode: mode, queueNo: { startsWith: prefix } },
      select: { queueNo: true }
    })
    const max = existing.reduce((current, item) => {
      const number = Number(item.queueNo.replace(/\D/g, ''))
      return Number.isFinite(number) ? Math.max(current, number) : current
    }, 0)
    return `${prefix}${max + 1}`
  }

  async control(pileId: string, action: string, targetState?: string) {
    if (action === 'TOGGLE_POWER') {
      const pile = await this.prisma.chargingPile.findUniqueOrThrow({ where: { id: pileId } })
      return pile.physicalState === PhysicalState.ON ? this.powerOff(pileId) : this.powerOn(pileId)
    }
    if (action === 'REPORT_FAULT' || targetState === WorkingState.FAULT) return this.reportFault(pileId)
    if (action === 'RECOVER_PILE' || targetState === WorkingState.IDLE) return this.recover(pileId)
    throw new BadRequestException(`Unsupported pile control action: ${action}`)
  }
}
