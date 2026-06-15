import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ChargeMode, OrderStatus, PhysicalState, WorkingState } from '@prisma/client'
import { virtualNowMs } from '../../common/clock'
import { DispatchStrategyType } from '../../common/enums'
import { PrismaService } from '../../prisma/prisma.service'
import { RealtimeService } from '../../realtime/realtime.service'
import { RedisService } from '../../redis/redis.service'
import { BillingService } from '../billing/billing.service'
import { QueueCacheService } from '../queue/queue-cache.service'
import { HttpSchedulerClient } from './http-scheduler.client'

interface SchedulerOrder {
  order_id: string
  queue_no: string
  charge_mode?: ChargeMode | null
  requested_amount: number
  status: OrderStatus
}

interface SchedulerPile {
  pile_id: string
  pile_type: ChargeMode
  power: number
  working_state: WorkingState
  queued_orders: SchedulerOrder[]
}

interface SchedulerAssignment {
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
  private readonly logger = new Logger(DispatchService.name)

  constructor(
    @Inject(HttpSchedulerClient) private readonly schedulerClient: HttpSchedulerClient,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(QueueCacheService) private readonly queueCache: QueueCacheService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(BillingService) private readonly billingService: BillingService,
    @Inject(RedisService) private readonly redis: RedisService
  ) {}

  async triggerBasicAll() {
    const lockKey = 'lock:dispatch:basic'
    const locked = await this.redis.lock(lockKey, 15000)
    if (!locked) { this.logger.warn('triggerBasicAll skipped: lock held by another process'); return { dispatched: [] } }
    try {
      await this.autoCompleteCharging()
      await this.wakeIdlePiles()
      await this.triggerBasic('FAST')
      await this.triggerBasic('SLOW')
      return { dispatched: ['FAST', 'SLOW'] }
    } finally {
      await this.redis.unlock(lockKey)
    }
  }

  async triggerBasic(mode: ChargeMode | string) {
    // 先自动结束所有已充满的订单，释放桩位
    await this.autoCompleteCharging()
    const chargeMode = mode as ChargeMode
    const waitingOrders = await this.waitingOrders(chargeMode)
    const pileQueues = await this.pileQueues(chargeMode)
    const response = await this.safeSchedule('/dispatch/basic', { mode: chargeMode, waiting_orders: waitingOrders, pile_queues: pileQueues }, () =>
      localBasicDispatch(waitingOrders, pileQueues)
    )
    const applied = await this.applyAssignments(response.assignments ?? [], chargeMode)
    await this.queueCache.refreshMode(chargeMode)
    this.realtime.broadcast('dispatch_result', { strategy: 'BASIC', mode: chargeMode, applied })
    return { ...response, assignments: applied }
  }

  async triggerFaultReschedule(pileId: string, strategyType: DispatchStrategyType) {
    const lockKey = `lock:dispatch:fault:${pileId}`
    const locked = await this.redis.lock(lockKey, 10000)
    if (!locked) { this.logger.warn(`triggerFaultReschedule ${pileId} skipped: lock held`); return { assignments: [] } }
    try {
    const pile = await this.prisma.chargingPile.findUniqueOrThrow({ where: { id: pileId } })
    const path = strategyType === DispatchStrategyType.TIME_ORDER
      ? '/dispatch/fault-time-order'
      : '/dispatch/fault-priority'
    const affectedOrders = await this.assignedOrders(pileId)
    const normalQueuedOrders = strategyType === DispatchStrategyType.TIME_ORDER
      ? await this.assignedOrdersByMode(pile.pileType, pileId)
      : []
    const movableOrders = strategyType === DispatchStrategyType.TIME_ORDER
      ? [...affectedOrders, ...normalQueuedOrders]
      : affectedOrders
    const sameModePileQueues = strategyType === DispatchStrategyType.TIME_ORDER
      ? await this.pileQueues(pile.pileType, pileId, [OrderStatus.CHARGING])
      : await this.pileQueues(pile.pileType, pileId)
    const response = await this.safeSchedule(
      path,
      { pile_id: pileId, affected_orders: movableOrders, same_mode_pile_queues: sameModePileQueues },
      () => strategyType === DispatchStrategyType.TIME_ORDER
        ? localTimeOrderDispatch(movableOrders, sameModePileQueues)
        : localBasicDispatch(affectedOrders, sameModePileQueues)
    )
    const applied = await this.applyAssignments(
      response.assignments ?? [],
      pile.pileType,
      movableOrders.map((order) => order.order_id)
    )
    await this.queueCache.refreshPile(pileId)
    this.realtime.broadcast('fault_event', { pileId, strategyType, affectedCount: movableOrders.length, reassignedCount: applied.length })
    this.realtime.broadcast('dispatch_result', { strategy: strategyType, mode: pile.pileType, applied })
    return { ...response, assignments: applied }
    } finally {
      await this.redis.unlock(lockKey)
    }
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
    await this.queueCache.refreshMode(mode)
    this.realtime.broadcast('dispatch_result', { strategy: 'SINGLE_OPTIMIZATION', mode, applied })
    return { ...response, assignments: applied }
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
    await this.queueCache.refreshAll()
    this.realtime.broadcast('dispatch_result', { strategy: 'BATCH_OPTIMIZATION', applied })
    return { ...response, assignments: applied }
  }

  async triggerRecoveryReschedule(pileId: string) {
    const lockKey = `lock:dispatch:recovery:${pileId}`
    const locked = await this.redis.lock(lockKey, 10000)
    if (!locked) { this.logger.warn(`triggerRecoveryReschedule ${pileId} skipped: lock held`); return { assignments: [] } }
    try {
    const pile = await this.prisma.chargingPile.findUniqueOrThrow({ where: { id: pileId } })
    const sameModePileQueues = await this.pileQueues(pile.pileType, undefined, [OrderStatus.CHARGING])
    const affectedOrders = await this.assignedOrdersByMode(pile.pileType)
    const response = await this.safeSchedule(
      '/dispatch/recovery-time-order',
      { pile_id: pileId, affected_orders: affectedOrders, same_mode_pile_queues: sameModePileQueues },
      () => localTimeOrderDispatch(affectedOrders, sameModePileQueues)
    )
    const applied = await this.applyAssignments(
      response.assignments ?? [],
      pile.pileType,
      affectedOrders.map((order) => order.order_id)
    )
    this.realtime.broadcast('dispatch_result', { strategy: 'RECOVERY_TIME_ORDER', mode: pile.pileType, applied })
    return { ...response, assignments: applied }
    } finally {
      await this.redis.unlock(lockKey)
    }
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

  private async assignedOrdersByMode(mode: ChargeMode, excludePileId?: string) {
    const orders = await this.prisma.chargingOrder.findMany({
      where: {
        chargeMode: mode,
        status: OrderStatus.IN_PILE_QUEUE,
        assignedPileId: excludePileId ? { not: excludePileId } : { not: null }
      },
      orderBy: [{ queueNo: 'asc' }, { pileQueueEnteredAt: 'asc' }, { submitTime: 'asc' }]
    })
    return orders.map(toSchedulerOrder)
  }

  private async pileQueues(
    mode?: ChargeMode,
    excludePileId?: string,
    orderStatuses: OrderStatus[] = [OrderStatus.CHARGING, OrderStatus.IN_PILE_QUEUE]
  ) {
    const piles = await this.prisma.chargingPile.findMany({
      where: {
        physicalState: PhysicalState.ON,
        workingState: { not: WorkingState.FAULT },
        ...(mode ? { pileType: mode } : {}),
        ...(excludePileId ? { id: { not: excludePileId } } : {})
      },
      include: {
        orders: {
          where: { status: { in: orderStatuses } },
          orderBy: [{ startedAt: 'desc' }, { pileQueueEnteredAt: 'asc' }, { submitTime: 'asc' }]
        }
      },
      orderBy: { id: 'asc' }
    })
    return piles.map((pile) => ({
      pile_id: pile.id,
      pile_type: pile.pileType,
      power: pile.power,
      working_state: pile.workingState,
      queued_orders: pile.orders.map(toSchedulerOrder)
    }))
  }

  private async applyAssignments(assignments: SchedulerAssignment[], mode?: ChargeMode, movableOrderIds: string[] = []) {
    const applied: Array<{ orderId: string; queueNo: string; pileId: string; projectedFinishTime: number; autoStarted: boolean }> = []
    const touchedPiles = new Set<string>()
    const autoStartedPiles = new Set<string>()
    const enteredAt = Date.now()
    const movableSet = new Set(movableOrderIds)

    for (const [index, assignment] of assignments.entries()) {
      const orderId = assignment.order_id ?? assignment.orderId
      const pileId = assignment.pile_id ?? assignment.pileId
      if (!orderId || !pileId) continue

      const order = await this.prisma.chargingOrder.findUnique({ where: { id: orderId } })
      if (!order || order.status === OrderStatus.CHARGING || isTerminal(order.status)) continue

      const pile = await this.prisma.chargingPile.findUnique({ where: { id: pileId } })
      if (!pile || pile.physicalState !== PhysicalState.ON || pile.workingState === WorkingState.FAULT) continue
      if (mode && pile.pileType !== mode) continue
      const excludedIds = Array.from(new Set([orderId, ...movableSet]))
      const queueLength = await this.prisma.chargingOrder.count({
        where: {
          assignedPileId: pileId,
          status: { in: [OrderStatus.CHARGING, OrderStatus.IN_PILE_QUEUE] },
          id: { notIn: excludedIds }
        }
      })
      const plannedForPile = applied.filter((item) => item.pileId === pileId).length
      if (queueLength + plannedForPile >= this.pileQueueCapacity()) continue

      // 桩空闲且本批次未在此桩自动启动过 → 直接开始充电
      const shouldAutoStart = pile.workingState === WorkingState.IDLE && !autoStartedPiles.has(pileId)
      const vNow = virtualNowMs()

      await this.prisma.$transaction(async (tx) => {
        await tx.chargingOrder.update({
          where: { id: orderId },
          data: shouldAutoStart
            ? { status: OrderStatus.CHARGING, assignedPileId: pileId, startedAt: new Date(vNow), pileQueueEnteredAt: new Date(enteredAt + index) }
            : { status: OrderStatus.IN_PILE_QUEUE, assignedPileId: pileId, pileQueueEnteredAt: new Date(enteredAt + index) }
        })
        if (shouldAutoStart) {
          await tx.chargingPile.update({
            where: { id: pileId },
            data: { workingState: WorkingState.CHARGING }
          })
          await tx.chargingSession.create({
            data: { orderId, pileId, startTime: new Date(vNow) }
          })
          autoStartedPiles.add(pileId)
        }
      })

      touchedPiles.add(pileId)
      if (order.assignedPileId && order.assignedPileId !== pileId) touchedPiles.add(order.assignedPileId)
      applied.push({
        orderId,
        queueNo: assignment.queue_no ?? assignment.queueNo ?? order.queueNo,
        pileId,
        projectedFinishTime: assignment.projected_finish_time ?? assignment.projectedFinishTime ?? 0,
        autoStarted: shouldAutoStart
      })
    }

    await Promise.all([...touchedPiles].map((pileId) => this.queueCache.refreshPile(pileId)))
    return applied
  }

  private async wakeIdlePiles() {
    const idlePiles = await this.prisma.chargingPile.findMany({
      where: { physicalState: PhysicalState.ON, workingState: WorkingState.IDLE },
      include: {
        orders: {
          where: { status: OrderStatus.IN_PILE_QUEUE },
          orderBy: [{ pileQueueEnteredAt: 'asc' }, { submitTime: 'asc' }],
          take: 1
        }
      }
    })

    for (const pile of idlePiles) {
      const order = pile.orders[0]
      if (!order) continue

      // 防并发：获取每根桩的唤醒锁
      const pileLockKey = `lock:pile:${pile.id}:wake`
      const pileLocked = await this.redis.lock(pileLockKey, 5000)
      if (!pileLocked) continue

      const vNow = new Date(virtualNowMs())
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.chargingOrder.update({
            where: { id: order.id },
            data: { status: OrderStatus.CHARGING, startedAt: vNow }
          })
          await tx.chargingPile.update({
            where: { id: pile.id },
            data: { workingState: WorkingState.CHARGING }
          })
          await tx.chargingSession.create({
            data: { orderId: order.id, pileId: pile.id, startTime: vNow }
          })
        })
        await this.queueCache.refreshPile(pile.id)
      } catch {
        // 启动失败不阻塞
      } finally {
        await this.redis.unlock(pileLockKey)
      }
    }
  }

  async autoCompleteCharging() {
    const orders = await this.prisma.chargingOrder.findMany({
      where: { status: OrderStatus.CHARGING },
      include: {
        sessions: {
          where: { sessionStatus: 'ACTIVE' },
          include: { pile: true },
          take: 1
        },
        assignedPile: true
      }
    })

    const now = virtualNowMs()
    for (const order of orders) {
      const session = order.sessions[0]
      const pile = order.assignedPile
      if (!session || !pile || pile.power <= 0) continue

      const elapsedHours = Math.max(0, (now - session.startTime.getTime()) / 3_600_000)
      const delivered = elapsedHours * pile.power

      if (delivered >= order.requestedAmount) {
        try {
          await this.billingService.closeAndBill(order.id, 'CHARGE_COMPLETE', OrderStatus.FINISHED, WorkingState.IDLE)
          await this.queueCache.refreshPile(pile.id)
          await this.queueCache.refreshMode(order.chargeMode)
          this.realtime.broadcast('charging_complete', { orderId: order.id, pileId: pile.id })
        } catch {
          // 自动结束失败不阻塞调度
        }
      }
    }
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

function localBasicDispatch(orders: SchedulerOrder[], piles: SchedulerPile[]): SchedulerAssignment[] {
  const assignments: SchedulerAssignment[] = []
  for (const order of orders) {
    const candidates = piles.filter((pile) => pile.working_state !== WorkingState.FAULT)
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

function localTimeOrderDispatch(orders: SchedulerOrder[], piles: SchedulerPile[]) {
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
