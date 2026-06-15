import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ChargeMode, OrderStatus, PhysicalState, WorkingState } from '@prisma/client'
import { ClockService } from '../../common/clock.service'
import { DispatchStrategyType } from '../../common/enums'
import { PrismaService } from '../../prisma/prisma.service'
import { RealtimeService } from '../../realtime/realtime.service'
import { QueueCacheService } from '../queue/queue-cache.service'
import { ChargingStarterService } from '../charging/charging-starter.service'
import { HttpSchedulerClient } from './http-scheduler.client'

export interface SchedulerOrder {
  order_id: string
  queue_no: string
  charge_mode?: ChargeMode | null
  requested_amount: number
  status: OrderStatus
}

export interface SchedulerPile {
  pile_id: string
  pile_type: ChargeMode
  power: number
  working_state: WorkingState
  queue_capacity: number
  queued_orders: SchedulerOrder[]
}

export interface SchedulerAssignment {
  order_id?: string
  orderId?: string
  queue_no?: string
  queueNo?: string
  pile_id?: string
  pileId?: string
  projected_finish_time?: number
  projectedFinishTime?: number
}

interface SchedulerResponse {
  applied?: boolean
  message?: string
  assignments?: SchedulerAssignment[]
}

@Injectable()
export class DispatchService {
  constructor(
    @Inject(HttpSchedulerClient) private readonly schedulerClient: HttpSchedulerClient,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(QueueCacheService) private readonly queueCache: QueueCacheService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(ChargingStarterService) private readonly chargingStarter: ChargingStarterService,
    @Inject(ClockService) private readonly clock: ClockService
  ) {}

  async triggerBasic(mode: ChargeMode | string, autoStart = false) {
    const chargeMode = mode as ChargeMode
    const waitingOrders = await this.waitingOrders(chargeMode)
    const pileQueues = await this.pileQueues(chargeMode)
    const response = await this.safeSchedule('/dispatch/basic', { mode: chargeMode, waiting_orders: waitingOrders, pile_queues: pileQueues }, () =>
      localBasicDispatch(waitingOrders, pileQueues)
    )
    const applied = await this.applyAssignments(response.assignments ?? [], chargeMode)
    const autoStarted = autoStart
      ? await this.chargingStarter.autoStartPileHeads(pileQueues.map((pile) => pile.pile_id))
      : []
    await this.queueCache.refreshMode(chargeMode)
    this.realtime.broadcast('dispatch_result', { strategy: 'BASIC', mode: chargeMode, applied, autoStarted })
    return { ...response, assignments: applied, autoStarted }
  }

  async triggerFaultReschedule(pileId: string, strategyType: DispatchStrategyType) {
    const pile = await this.prisma.chargingPile.findUniqueOrThrow({ where: { id: pileId } })
    const path = strategyType === DispatchStrategyType.TIME_ORDER
      ? '/dispatch/fault-time-order'
      : '/dispatch/fault-priority'
    const affectedOrders = await this.assignedOrders(pileId)
    const sameModePileQueues = await this.pileQueues(pile.pileType, pileId)
    const timeOrderCandidates = [...affectedOrders, ...sameModePileQueues.flatMap((queue) => queue.queued_orders)]
    const movableOrderIds = strategyType === DispatchStrategyType.TIME_ORDER
      ? [...affectedOrders, ...sameModePileQueues.flatMap((queue) => queue.queued_orders)].map((order) => order.order_id)
      : affectedOrders.map((order) => order.order_id)
    if (movableOrderIds.length > 0) {
      await this.prisma.chargingOrder.updateMany({
        where: { id: { in: movableOrderIds }, status: OrderStatus.IN_PILE_QUEUE },
        data: { status: OrderStatus.WAITING, assignedPileId: null, pileQueueEnteredAt: null }
      })
    }
    const response = await this.safeSchedule(
      path,
      { pile_id: pileId, affected_orders: affectedOrders, same_mode_pile_queues: sameModePileQueues },
      () => strategyType === DispatchStrategyType.TIME_ORDER
        ? localTimeOrderDispatch(
          timeOrderCandidates,
          sameModePileQueues.map((queue) => ({ ...queue, queued_orders: [] }))
        )
        : localBasicDispatch(affectedOrders, sameModePileQueues)
    )
    const applied = await this.applyAssignments(response.assignments ?? [], pile.pileType)
    const autoStarted = await this.chargingStarter.autoStartPileHeads(
      sameModePileQueues.map((queue) => queue.pile_id)
    )
    await Promise.all([
      this.queueCache.refreshMode(pile.pileType),
      this.queueCache.refreshPile(pileId),
      ...sameModePileQueues.map((queue) => this.queueCache.refreshPile(queue.pile_id))
    ])
    this.realtime.broadcast('fault_event', { pileId, strategyType, affectedCount: affectedOrders.length, reassignedCount: applied.length })
    this.realtime.broadcast('dispatch_result', { strategy: strategyType, mode: pile.pileType, applied, autoStarted })
    return { ...response, assignments: applied, autoStarted }
  }

  async triggerSingleOptimization(payload: { spotsCount: number; mode: ChargeMode }) {
    const mode = payload.mode as ChargeMode
    const candidateOrders = (await this.waitingOrders(mode)).slice(0, payload.spotsCount)
    const pileQueues = await this.pileQueues(mode)
    const response = await this.safeSchedule(
      '/dispatch/single-optimization',
      {
        spots_count: payload.spotsCount,
        mode,
        candidate_orders: candidateOrders,
        pile_queues: pileQueues
      },
      () => localBasicDispatch(candidateOrders, pileQueues)
    )
    const applied = await this.applyAssignments(response.assignments ?? [], mode)
    const autoStarted = await this.chargingStarter.autoStartPileHeads(
      pileQueues.map((pile) => pile.pile_id)
    )
    await this.queueCache.refreshMode(mode)
    this.realtime.broadcast('dispatch_result', { strategy: 'SINGLE_OPTIMIZATION', mode, applied, autoStarted })
    return { ...response, assignments: applied, autoStarted }
  }

  async triggerBatchOptimization(payload: { spotsCount: number }) {
    const candidateOrders = (await this.waitingOrders()).slice(0, payload.spotsCount)
    const pileQueues = await this.pileQueues()
    const response = await this.safeSchedule(
      '/dispatch/batch-optimization',
      {
        spots_count: payload.spotsCount,
        candidate_orders: candidateOrders,
        pile_queues: pileQueues
      },
      () => localBatchDispatch(candidateOrders, pileQueues)
    )
    const applied = await this.applyAssignments(response.assignments ?? [])
    const autoStarted = await this.chargingStarter.autoStartPileHeads(
      pileQueues.map((pile) => pile.pile_id)
    )
    await this.queueCache.refreshAll()
    this.realtime.broadcast('dispatch_result', { strategy: 'BATCH_OPTIMIZATION', applied, autoStarted })
    return { ...response, assignments: applied, autoStarted }
  }

  async triggerRecoveryReschedule(pileId: string) {
    const pile = await this.prisma.chargingPile.findUniqueOrThrow({ where: { id: pileId } })
    const sameModePileQueues = await this.pileQueues(pile.pileType)
    const affectedOrders = sameModePileQueues.flatMap((queue) => queue.queued_orders)
    if (affectedOrders.length > 0) {
      await this.prisma.chargingOrder.updateMany({
        where: { id: { in: affectedOrders.map((order) => order.order_id) }, status: OrderStatus.IN_PILE_QUEUE },
        data: { status: OrderStatus.WAITING, assignedPileId: null, pileQueueEnteredAt: null }
      })
    }
    const response = await this.safeSchedule(
      '/dispatch/recovery-time-order',
      { pile_id: pileId, affected_orders: [], same_mode_pile_queues: sameModePileQueues },
      () => localTimeOrderDispatch(affectedOrders, sameModePileQueues.map((queue) => ({ ...queue, queued_orders: [] })))
    )
    const applied = await this.applyAssignments(response.assignments ?? [], pile.pileType)
    const autoStarted = await this.chargingStarter.autoStartPileHeads(
      sameModePileQueues.map((queue) => queue.pile_id)
    )
    await Promise.all([
      this.queueCache.refreshMode(pile.pileType),
      ...sameModePileQueues.map((queue) => this.queueCache.refreshPile(queue.pile_id))
    ])
    this.realtime.broadcast('dispatch_result', { strategy: 'RECOVERY_TIME_ORDER', mode: pile.pileType, applied, autoStarted })
    return { ...response, assignments: applied, autoStarted }
  }

  private async safeSchedule(path: string, payload: unknown, fallback: () => SchedulerAssignment[]): Promise<SchedulerResponse> {
    try {
      return await this.schedulerClient.post(path, payload)
    } catch {
      return {
        applied: true,
        message: 'Scheduler service unavailable; applied local fallback strategy.',
        assignments: fallback()
      }
    }
  }

  private async waitingOrders(mode?: ChargeMode) {
    const orders = await this.prisma.chargingOrder.findMany({
      where: {
        status: OrderStatus.WAITING,
        ...(mode ? { chargeMode: mode } : {})
      },
      orderBy: [{ submitTime: 'asc' }, { queueNo: 'asc' }]
    })
    return orders.map(toSchedulerOrder)
  }

  private async assignedOrders(pileId: string) {
    const orders = await this.prisma.chargingOrder.findMany({
      where: { assignedPileId: pileId, status: OrderStatus.IN_PILE_QUEUE },
      orderBy: [{ pileQueueEnteredAt: 'asc' }, { submitTime: 'asc' }]
    })
    return orders.map(toSchedulerOrder)
  }

  private async pileQueues(mode?: ChargeMode, excludePileId?: string) {
    const piles = await this.prisma.chargingPile.findMany({
      where: {
        physicalState: PhysicalState.ON,
        workingState: { not: WorkingState.FAULT },
        ...(mode ? { pileType: mode } : {}),
        ...(excludePileId ? { id: { not: excludePileId } } : {})
      },
      include: {
        orders: {
          where: { status: { in: [OrderStatus.CHARGING, OrderStatus.IN_PILE_QUEUE] } },
          orderBy: [{ status: 'desc' }, { pileQueueEnteredAt: 'asc' }, { submitTime: 'asc' }]
        }
      },
      orderBy: { id: 'asc' }
    })
    return piles.map((pile) => ({
      pile_id: pile.id,
      pile_type: pile.pileType,
      power: pile.power,
      working_state: pile.workingState,
      queue_capacity: this.pileQueueCapacity(),
      queued_orders: pile.orders.map(toSchedulerOrder)
    }))
  }

  private async applyAssignments(assignments: SchedulerAssignment[], mode?: ChargeMode) {
    const applied: Array<{ orderId: string; queueNo: string; pileId: string; projectedFinishTime: number }> = []
    const touchedPiles = new Set<string>()
    const enteredAt = this.clock.millis()

    for (const [index, assignment] of assignments.entries()) {
      const orderId = assignment.order_id ?? assignment.orderId
      const pileId = assignment.pile_id ?? assignment.pileId
      if (!orderId || !pileId) continue

      const order = await this.prisma.chargingOrder.findUnique({ where: { id: orderId } })
      if (!order || order.status === OrderStatus.CHARGING || isTerminal(order.status)) continue

      const pile = await this.prisma.chargingPile.findUnique({ where: { id: pileId } })
      if (!pile || pile.physicalState !== PhysicalState.ON || pile.workingState === WorkingState.FAULT) continue
      if (mode && pile.pileType !== mode) continue
      const queueLength = await this.prisma.chargingOrder.count({
        where: {
          assignedPileId: pileId,
          status: { in: [OrderStatus.CHARGING, OrderStatus.IN_PILE_QUEUE] },
          id: { not: orderId }
        }
      })
      if (queueLength >= this.pileQueueCapacity()) continue

      await this.prisma.chargingOrder.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.IN_PILE_QUEUE,
          assignedPileId: pileId,
          pileQueueEnteredAt: new Date(enteredAt + index)
        }
      })

      touchedPiles.add(pileId)
      applied.push({
        orderId,
        queueNo: assignment.queue_no ?? assignment.queueNo ?? order.queueNo,
        pileId,
        projectedFinishTime: assignment.projected_finish_time ?? assignment.projectedFinishTime ?? 0
      })
    }

    await Promise.all([...touchedPiles].map((pileId) => this.queueCache.refreshPile(pileId)))
    return applied
  }

  private pileQueueCapacity() {
    return Number(this.config.get<string>('CHARGING_QUEUE_LEN') ?? 2)
  }
}

function toSchedulerOrder(order: { id: string; queueNo: string; chargeMode: ChargeMode; requestedAmount: number; status: OrderStatus }): SchedulerOrder {
  return {
    order_id: order.id,
    queue_no: order.queueNo,
    charge_mode: order.chargeMode,
    requested_amount: order.requestedAmount,
    status: order.status
  }
}

export function localBasicDispatch(orders: SchedulerOrder[], piles: SchedulerPile[]): SchedulerAssignment[] {
  const assignments: SchedulerAssignment[] = []
  for (const order of orders) {
    const candidates = piles.filter(
      (pile) => pile.working_state !== WorkingState.FAULT && pile.queued_orders.length < pile.queue_capacity
    )
    if (candidates.length === 0) continue
    const target = candidates.sort((a, b) => {
      const aFinish = projectedFinish(order, a)
      const bFinish = projectedFinish(order, b)
      return aFinish - bFinish || a.pile_id.localeCompare(b.pile_id) || a.queued_orders.length - b.queued_orders.length
    })[0]
    const projected = projectedFinish(order, target)
    target.queued_orders.push(order)
    assignments.push({
      order_id: order.order_id,
      queue_no: order.queue_no,
      pile_id: target.pile_id,
      projected_finish_time: Math.round(projected * 10_000) / 10_000
    })
  }
  return assignments
}

export function localTimeOrderDispatch(orders: SchedulerOrder[], piles: SchedulerPile[]) {
  return localBasicDispatch([...orders].sort((a, b) => queueNumber(a.queue_no) - queueNumber(b.queue_no)), piles)
}

function localBatchDispatch(orders: SchedulerOrder[], piles: SchedulerPile[]) {
  return localBasicDispatch([...orders].sort((a, b) => b.requested_amount - a.requested_amount), piles)
}

function projectedFinish(order: SchedulerOrder, pile: SchedulerPile) {
  const queued = pile.queued_orders.reduce((sum, item) => sum + item.requested_amount / pile.power, 0)
  return queued + order.requested_amount / pile.power
}

function queueNumber(queueNo: string) {
  return Number(queueNo.replace(/\D/g, '')) || 0
}

function isTerminal(status: OrderStatus) {
  return status === OrderStatus.FINISHED || status === OrderStatus.CANCELED || status === OrderStatus.ABORTED
}
