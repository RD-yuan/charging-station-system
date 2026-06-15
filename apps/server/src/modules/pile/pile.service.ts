import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { OrderStatus, PhysicalState, WorkingState } from '@prisma/client'
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
          waitMinutes: Math.max(0, Math.round((Date.now() - order.submitTime.getTime()) / 60_000))
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
    const detail = active
      ? await this.billingService.closeAndBill(active.id, 'FAULT', OrderStatus.ABORTED, WorkingState.FAULT)
      : null

    const updated = await this.prisma.chargingPile.update({
      where: { id: pileId },
      data: { workingState: WorkingState.FAULT }
    })
    const affectedCount = await this.prisma.chargingOrder.count({
      where: { assignedPileId: pileId, status: OrderStatus.IN_PILE_QUEUE }
    })

    await this.queueCache.refreshPile(pileId)
    this.realtime.broadcast('fault_event', {
      pileId,
      mode: pile.pileType,
      affectedCount,
      abortedOrderId: active?.id ?? null
    })
    return { pile: updated, affectedCount, detail }
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

function chargingProgress(
  order: {
    status: OrderStatus
    requestedAmount: number
    sessions: Array<{ startTime: Date }>
  },
  pilePower: number
) {
  if (order.status !== OrderStatus.CHARGING || order.requestedAmount <= 0 || pilePower <= 0) return 0
  const session = order.sessions[0]
  if (!session) return 0
  return Math.min(100, Math.round((deliveredAmount(order, pilePower) / order.requestedAmount) * 1000) / 10)
}

function deliveredAmount(
  order: {
    status: OrderStatus
    sessions: Array<{ startTime: Date }>
  },
  pilePower: number
) {
  if (order.status !== OrderStatus.CHARGING || pilePower <= 0) return 0
  const session = order.sessions[0]
  if (!session) return 0
  const elapsedHours = Math.max(0, (Date.now() - session.startTime.getTime()) / 3_600_000)
  return Math.round(elapsedHours * pilePower * 10_000) / 10_000
}
