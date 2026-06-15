import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { ChargeMode, OrderStatus, PhysicalState, WorkingState } from '@prisma/client'
import { ClockService } from '../../common/clock.service'
import { DispatchStrategyType } from '../../common/enums'
import { PrismaService } from '../../prisma/prisma.service'
import { RealtimeService } from '../../realtime/realtime.service'
import { BillingService } from '../billing/billing.service'
import { DispatchService } from '../dispatch/dispatch.service'
import { QueueCacheService } from '../queue/queue-cache.service'
import { calculateChargingProgress } from '../charging/charging-progress'
import { ChargingStarterService } from '../charging/charging-starter.service'

@Injectable()
export class PileService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DispatchService) private readonly dispatchService: DispatchService,
    @Inject(BillingService) private readonly billingService: BillingService,
    @Inject(QueueCacheService) private readonly queueCache: QueueCacheService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
    @Inject(ChargingStarterService) private readonly chargingStarter: ChargingStarterService,
    @Inject(ClockService) private readonly clock: ClockService
  ) {}

  async list() {
    const piles = await this.prisma.chargingPile.findMany({
      orderBy: { id: 'asc' },
      include: {
        orders: {
          where: { status: { in: [OrderStatus.CHARGING, OrderStatus.IN_PILE_QUEUE] } },
          include: { user: true, detail: true, sessions: true },
          orderBy: [{ status: 'desc' }, { pileQueueEnteredAt: 'asc' }, { submitTime: 'asc' }]
        }
      }
    })
    const pileIds = piles.map((pile) => pile.id)
    const faultPiles = piles.filter((pile) => pile.workingState === WorkingState.FAULT)
    const faultPileIds = faultPiles.map((pile) => pile.id)
    const oldestCurrentFault = faultPiles.length > 0
      ? new Date(Math.min(...faultPiles.map((pile) => pile.updatedAt.getTime())) - 10_000)
      : null
    const interruptedOrders = pileIds.length > 0
      ? await this.prisma.chargingOrder.findMany({
        where: {
          assignedPileId: { in: pileIds },
          status: OrderStatus.ABORTED,
          sessions: { some: { stopReason: 'FAULT' } },
          OR: [
            { detail: null },
            ...(oldestCurrentFault
              ? [{ assignedPileId: { in: faultPileIds }, finishedAt: { gte: oldestCurrentFault } }]
              : [])
          ]
        },
        include: { user: true, detail: true, sessions: true },
        orderBy: { finishedAt: 'desc' }
      })
      : []
    const latestInterruptedByPile = new Map<string, (typeof interruptedOrders)[number]>()
    for (const order of interruptedOrders) {
      if (order.assignedPileId && !latestInterruptedByPile.has(order.assignedPileId)) {
        latestInterruptedByPile.set(order.assignedPileId, order)
      }
    }

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
      queue: pile.orders.map((order) => this.toQueueItem(order, pile.power)),
      interruptedOrder: latestInterruptedByPile.has(pile.id)
        ? this.toQueueItem(latestInterruptedByPile.get(pile.id)!, pile.power, true)
        : null
    }))
  }

  queue(pileId: string) {
    return this.prisma.chargingOrder.findMany({
      where: { assignedPileId: pileId, status: { in: [OrderStatus.IN_PILE_QUEUE, OrderStatus.CHARGING] } },
      orderBy: [{ status: 'desc' }, { pileQueueEnteredAt: 'asc' }, { submitTime: 'asc' }],
      include: { user: true }
    }).then((orders) =>
      orders.map((order) => ({
        orderId: order.id,
        queueNo: order.queueNo,
        status: order.status,
        userId: order.userId,
        batteryCapacity: order.user.batteryCapacity,
        requestedAmount: order.requestedAmount,
        waitMinutes: Math.max(0, Math.round((this.clock.millis() - order.submitTime.getTime()) / 60_000))
      }))
    )
  }

  async powerOn(pileId: string) {
    const pile = await this.prisma.chargingPile.update({
      where: { id: pileId },
      data: { physicalState: PhysicalState.ON, workingState: WorkingState.IDLE }
    })
    await this.queueCache.refreshPile(pileId)
    await this.dispatchService.triggerBasic(pile.pileType, true)
    return pile
  }

  async powerOff(pileId: string) {
    const occupied = await this.prisma.chargingOrder.findFirst({
      where: { assignedPileId: pileId, status: { in: [OrderStatus.CHARGING, OrderStatus.IN_PILE_QUEUE] } }
    })
    if (occupied) throw new BadRequestException('Cannot power off a pile while its charging queue is not empty.')

    const pile = await this.prisma.chargingPile.update({
      where: { id: pileId },
      data: { physicalState: PhysicalState.OFF, workingState: WorkingState.IDLE }
    })
    await this.queueCache.refreshPile(pileId)
    return pile
  }

  async reportFault(pileId: string) {
    const pile = await this.prisma.chargingPile.findUniqueOrThrow({ where: { id: pileId } })
    const active = await this.prisma.chargingOrder.findFirst({
      where: { assignedPileId: pileId, status: OrderStatus.CHARGING }
    })
    let detail: unknown = null
    if (active) {
      detail = await this.billingService.interruptForFault(active.id)
    }

    const updated = await this.prisma.chargingPile.update({
      where: { id: pileId },
      data: { workingState: WorkingState.FAULT }
    })
    const affectedCount = await this.prisma.chargingOrder.count({
      where: { assignedPileId: pileId, status: OrderStatus.IN_PILE_QUEUE }
    })
    await this.queueCache.refreshPile(pileId)

    // PS 规则：充电桩故障默认采用优先级调度
    // 1. 把故障桩队列里还在排队的车搬到其他同类可用桩（优先）
    let rescheduleResult: unknown = null
    try {
      rescheduleResult = await this.dispatchService.triggerFaultReschedule(
        pileId,
        DispatchStrategyType.PRIORITY
      )
    } catch (err) {
      this.realtime.broadcast('fault_event', {
        pileId,
        mode: pile.pileType,
        affectedCount,
        abortedOrderId: active?.id ?? null,
        error: `priority reschedule failed: ${(err as Error).message}`
      })
    }
    // 2. 然后调度等候区
    try {
      await this.dispatchService.triggerBasic(pile.pileType, true)
    } catch {
      // 静默：故障调度已经做了主要工作
    }

    this.realtime.broadcast('fault_event', {
      pileId,
      mode: pile.pileType,
      affectedCount,
      abortedOrderId: active?.id ?? null
    })
    return { pile: updated, affectedCount, detail, rescheduleResult }
  }

  reschedule(pileId: string, strategyType: DispatchStrategyType) {
    return this.dispatchService.triggerFaultReschedule(pileId, strategyType)
  }

  async recover(pileId: string) {
    const faultedPile = await this.prisma.chargingPile.findUniqueOrThrow({ where: { id: pileId } })
    const faultStartedAt = new Date(faultedPile.updatedAt.getTime() - 10_000)
    const interruptedOrders = await this.prisma.chargingOrder.findMany({
      where: {
        assignedPileId: pileId,
        status: OrderStatus.ABORTED,
        sessions: { some: { stopReason: 'FAULT' } },
        OR: [
          { detail: null },
          { finishedAt: { gte: faultStartedAt } }
        ]
      },
      include: { detail: true },
      orderBy: [{ pileQueueEnteredAt: 'asc' }, { submitTime: 'asc' }]
    })
    const legacyDetailIds = interruptedOrders.flatMap((order) => order.detail ? [order.detail.id] : [])
    await this.prisma.$transaction(async (tx) => {
      if (legacyDetailIds.length > 0) {
        await tx.billingDetail.deleteMany({ where: { id: { in: legacyDetailIds } } })
      }
      if (interruptedOrders.length > 0) {
        await tx.chargingOrder.updateMany({
          where: { id: { in: interruptedOrders.map((order) => order.id) } },
          data: { status: OrderStatus.IN_PILE_QUEUE, finishedAt: null }
        })
      }
      await tx.chargingPile.update({
        where: { id: pileId },
        data: {
          workingState: WorkingState.IDLE,
          ...(legacyDetailIds.length > 0
            ? { totalChargeCount: { decrement: legacyDetailIds.length } }
            : {})
        }
      })
    })
    await this.queueCache.refreshPile(pileId)
    const resumed = await this.chargingStarter.autoStartPileHeads([pileId])
    await this.dispatchService.triggerRecoveryReschedule(pileId)
    await this.dispatchService.triggerBasic(faultedPile.pileType, true)
    // PS 规则延伸：恢复后再次触发优先级重调度，让恢复的桩尽快进入工作状态
    // （把其他桩上排队的同模式车重新洗牌，可能给恢复的桩腾出更早完工的位次）
    try {
      await this.dispatchService.triggerBasic(faultedPile.pileType, true)
    } catch {
      // 静默
    }
    return {
      pile: await this.prisma.chargingPile.findUniqueOrThrow({ where: { id: pileId } }),
      restoredOrderIds: interruptedOrders.map((order) => order.id),
      resumed
    }
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

  private toQueueItem(
    order: {
      id: string
      queueNo: string
      status: OrderStatus
      userId: string
      requestedAmount: number
      submitTime: Date
      startedAt: Date | null
      user: { username: string; batteryCapacity: number }
      detail: { actualAmount: number } | null
      sessions: Array<{ actualAmount: number | null; sessionStatus: string }>
    },
    power: number,
    interrupted = false
  ) {
    const previousAmount = order.sessions.reduce((sum, session) => (
      session.sessionStatus === 'ACTIVE' ? sum : sum + (session.actualAmount ?? 0)
    ), 0)
    const metrics = calculateChargingProgress({
      requestedAmount: order.requestedAmount,
      power,
      startedAt: order.startedAt,
      actualAmount: interrupted ? previousAmount : order.detail?.actualAmount,
      previousAmount,
      now: this.clock.now()
    })
    return {
      id: order.id,
      orderId: order.id,
      queueNo: order.queueNo,
      status: order.status,
      progress: order.status === OrderStatus.IN_PILE_QUEUE ? 0 : metrics.progress,
      deliveredEnergy: metrics.deliveredEnergy,
      interrupted,
      userId: order.userId,
      username: order.user.username,
      batteryCapacity: order.user.batteryCapacity,
      amount: order.requestedAmount,
      requestedAmount: order.requestedAmount,
      waitMinutes: Math.max(0, Math.round((this.clock.millis() - order.submitTime.getTime()) / 60_000))
    }
  }
}
