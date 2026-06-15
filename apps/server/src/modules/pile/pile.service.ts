import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { OrderStatus, PhysicalState, WorkingState } from '@prisma/client'
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
        // 将原订单排队号改为 -A 后缀，续充订单继承原号
        const originalQueueNo = active.queueNo
        await this.prisma.chargingOrder.update({
          where: { id: active.id },
          data: { queueNo: `${originalQueueNo}-A` }
        })
        const continuation = await this.prisma.chargingOrder.create({
          data: {
            userId: active.userId,
            chargeMode: active.chargeMode,
            requestedAmount: remaining,
            queueNo: originalQueueNo,
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

    // 3. 受影响的订单 = 被中止的充电订单 + 桩队列中的 IN_PILE_QUEUE 订单
    const queueAffected = await this.prisma.chargingOrder.findMany({
      where: { assignedPileId: pileId, status: OrderStatus.IN_PILE_QUEUE },
      include: { user: true },
      orderBy: [{ pileQueueEnteredAt: 'asc' }, { submitTime: 'asc' }]
    })

    const allAffected = queueAffected.map((o) => ({
      orderId: o.id,
      queueNo: o.queueNo,
      userId: o.userId,
      username: o.user.username,
      requestedAmount: o.requestedAmount,
      status: o.status
    }))

    // 被中止的充电订单也列入受影响列表
    if (active) {
      const activeUser = await this.prisma.user.findUnique({ where: { id: active.userId }, select: { username: true } })
      allAffected.unshift({
        orderId: active.id,
        queueNo: `${active.queueNo}-A`,
        userId: active.userId,
        username: activeUser?.username ?? 'unknown',
        requestedAmount: active.requestedAmount,
        status: 'ABORTED' as const
      })
    }

    // 4. 刷新缓存并广播
    await this.queueCache.refreshPile(pileId)
    this.realtime.broadcast('fault_event', {
      pileId,
      mode: pile.pileType,
      affectedCount: allAffected.length,
      abortedOrderId: active?.id ?? null,
      continuationOrderId,
      affectedOrders: allAffected
    })

    // 5. 若存在 IN_PILE_QUEUE 订单则触发故障重调度，若有续充订单也需基础调度
    const hasQueueAffected = queueAffected.length > 0
    if (hasQueueAffected) {
      await this.dispatchService.triggerFaultReschedule(pileId, DispatchStrategyType.PRIORITY)
    }
    if (hasQueueAffected || continuationOrderId) {
      await this.dispatchService.triggerBasic(pile.pileType)
    }

    return { pile: updated, affectedCount: allAffected.length, detail, continuationOrderId, affectedOrders: allAffected }
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
