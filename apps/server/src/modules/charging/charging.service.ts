import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ChargeMode, OrderStatus, PhysicalState, WorkingState } from '@prisma/client'
import { virtualNowMs } from '../../common/clock'
import { PrismaService } from '../../prisma/prisma.service'
import { BillingService } from '../billing/billing.service'
import { DispatchService } from '../dispatch/dispatch.service'
import { QueueCacheService } from '../queue/queue-cache.service'
import {
  CancelChargingDto,
  ModifyAmountDto,
  ModifyModeDto,
  SubmitChargingRequestDto
} from './charging.dto'

@Injectable()
export class ChargingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DispatchService) private readonly dispatchService: DispatchService,
    @Inject(BillingService) private readonly billingService: BillingService,
    @Inject(QueueCacheService) private readonly queueCache: QueueCacheService,
    @Inject(ConfigService) private readonly config: ConfigService
  ) {}

  async submitRequest(dto: SubmitChargingRequestDto, userId?: string) {
    const uid = userId ?? dto.userId
    if (!uid) throw new BadRequestException('userId is required.')
    await this.ensureUserCanSubmit(uid)
    await this.ensureWaitingCapacity()

    // 带重试的订单创建，防止并发 queueNo 冲突
    for (let attempt = 0; attempt < 3; attempt++) {
      const queueNo = await this.nextQueueNo(dto.chargeMode)
      try {
        const order = await this.prisma.chargingOrder.create({
          data: {
            userId: uid,
            chargeMode: dto.chargeMode,
            requestedAmount: dto.requestedAmount,
            queueNo,
            status: OrderStatus.WAITING
          }
        })
        await this.queueCache.refreshMode(dto.chargeMode)
        await this.dispatchService.triggerBasic(dto.chargeMode)
        return this.queueStatus(order.id)
      } catch (err) {
        // unique 冲突时重试，其他错误直接抛出
        if (attempt === 2 || !isUniqueConstraintError(err)) throw err
      }
    }
    throw new BadRequestException('Failed to create order after retries.')
  }

  async modifyMode(orderId: string, dto: ModifyModeDto, userId?: string) {
    await this.ensureOrderOwner(orderId, userId)
    const order = await this.requireWaitingOrder(orderId)
    if (order.chargeMode === dto.newMode) return this.queueStatus(order.id)
    const updated = await this.prisma.chargingOrder.update({
      where: { id: order.id },
      data: {
        chargeMode: dto.newMode,
        queueNo: await this.nextQueueNo(dto.newMode)
      }
    })
    await this.queueCache.refreshMode(order.chargeMode)
    await this.queueCache.refreshMode(dto.newMode)
    await this.dispatchService.triggerBasic(dto.newMode)
    return this.queueStatus(updated.id)
  }

  async modifyAmount(orderId: string, dto: ModifyAmountDto, userId?: string) {
    await this.ensureOrderOwner(orderId, userId)
    const order = await this.requireWaitingOrder(orderId)
    const updated = await this.prisma.chargingOrder.update({
      where: { id: order.id },
      data: { requestedAmount: dto.newAmount }
    })
    await this.queueCache.refreshMode(updated.chargeMode)
    await this.dispatchService.triggerBasic(updated.chargeMode)
    return this.queueStatus(updated.id)
  }

  async cancel(orderId: string, dto: CancelChargingDto, userId?: string) {
    await this.ensureOrderOwner(orderId, userId)
    const order = await this.prisma.chargingOrder.findUniqueOrThrow({ where: { id: orderId } })
    if (order.status === OrderStatus.WAITING) {
      const updated = await this.prisma.chargingOrder.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.CANCELED,
          assignedPileId: null,
          finishedAt: new Date()
        }
      })
      await this.queueCache.refreshMode(order.chargeMode)
      await this.dispatchService.triggerBasic(order.chargeMode)
      return this.toQueueStatus(updated, 'WAITING')
    }
    if (order.status === OrderStatus.IN_PILE_QUEUE) {
      const pileId = order.assignedPileId
      const updated = await this.prisma.chargingOrder.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.CANCELED,
          assignedPileId: null,
          pileQueueEnteredAt: null,
          finishedAt: new Date()
        }
      })
      if (pileId) await this.queueCache.refreshPile(pileId)
      await this.dispatchService.triggerBasic(order.chargeMode)
      return this.toQueueStatus(updated, 'PILE_QUEUE')
    }
    if (order.status === OrderStatus.CHARGING) {
      const targetStatus = dto.reason === 'USER_STOP' ? OrderStatus.FINISHED : OrderStatus.ABORTED
      const detail = await this.billingService.closeAndBill(orderId, dto.reason ?? 'FAULT', targetStatus)
      await this.dispatchService.triggerBasic(order.chargeMode)
      return detail
    }
    throw new BadRequestException(`Order ${order.status} cannot be canceled.`)
  }

  async listOrders(userId: string) {
    const orders = await this.prisma.chargingOrder.findMany({
      where: { userId },
      include: {
        detail: {
          include: {
            session: true
          }
        }
      },
      orderBy: [{ submitTime: 'desc' }, { createdAt: 'desc' }]
    })

    return orders.map((order) => {
      const isTerminalWithoutDetail = (order.status === OrderStatus.CANCELED || order.status === OrderStatus.ABORTED) && !order.detail
      const detail = order.detail
        ? {
            detailId: order.detail.id,
            orderId: order.id,
            sessionId: order.detail.sessionId,
            queueNo: order.queueNo,
            userId: order.userId,
            status: order.status,
            pileId: order.detail.session.pileId,
            generatedAt: order.detail.generatedAt,
            startTime: order.detail.session.startTime,
            stopTime: order.detail.session.stopTime,
            actualAmount: order.detail.actualAmount,
            duration: order.detail.duration,
            chargeFee: order.detail.chargeFee,
            serviceFee: order.detail.serviceFee,
            totalFee: order.detail.totalFee
          }
        : isTerminalWithoutDetail
        ? {
            detailId: `cancel-${order.id}`,
            orderId: order.id,
            sessionId: null,
            queueNo: order.queueNo,
            userId: order.userId,
            status: order.status,
            pileId: order.assignedPileId,
            generatedAt: order.finishedAt ?? order.createdAt,
            startTime: null,
            stopTime: order.finishedAt,
            actualAmount: 0,
            duration: 0,
            chargeFee: 0,
            serviceFee: 0,
            totalFee: 0
          }
        : null

      return {
        orderId: order.id,
        queueNo: order.queueNo,
        status: order.status,
        chargeMode: order.chargeMode,
        requestedAmount: order.requestedAmount,
        assignedPileId: order.assignedPileId,
        pileId: order.assignedPileId,
        queueArea: this.queueArea(order.status),
        submitTime: order.submitTime,
        startedAt: order.startedAt,
        finishedAt: order.finishedAt,
        detail
      }
    })
  }

  async queueStatus(orderId: string, userId?: string) {
    await this.ensureOrderOwner(orderId, userId)
    await this.dispatchService.autoCompleteCharging()
    const order = await this.prisma.chargingOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { assignedPile: true }
    })
    const area = this.queueArea(order.status)
    const aheadCount = await this.aheadCount(order)
    const estimatedWaitTime = await this.estimatedWaitTime(order)
    return this.toQueueStatus(order, area, aheadCount, estimatedWaitTime)
  }

  async start(orderId: string, userId?: string) {
    await this.ensureOrderOwner(orderId, userId)
    const order = await this.prisma.chargingOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { assignedPile: true }
    })
    if (order.status !== OrderStatus.IN_PILE_QUEUE || !order.assignedPileId || !order.assignedPile) {
      throw new BadRequestException('Only orders at the head of a pile queue can start charging.')
    }
    if (order.assignedPile.physicalState !== PhysicalState.ON || order.assignedPile.workingState !== WorkingState.IDLE) {
      throw new BadRequestException('Assigned pile is not available.')
    }

    const session = await this.prisma.$transaction(async (tx) => {
      // 队首检查在事务内，防止 TOCTOU
      const earlier = await tx.chargingOrder.findFirst({
        where: {
          assignedPileId: order.assignedPileId!,
          status: OrderStatus.IN_PILE_QUEUE,
          id: { not: order.id },
          OR: [
            { pileQueueEnteredAt: { lt: order.pileQueueEnteredAt ?? order.submitTime } },
            { pileQueueEnteredAt: null, submitTime: { lt: order.submitTime } }
          ]
        },
        orderBy: [{ pileQueueEnteredAt: 'asc' }, { submitTime: 'asc' }]
      })
      if (earlier) throw new BadRequestException('Order is not at the head of its pile queue.')

      const vNow = new Date(virtualNowMs())
      await tx.chargingOrder.update({
        where: { id: order.id },
        data: { status: OrderStatus.CHARGING, startedAt: vNow }
      })
      await tx.chargingPile.update({
        where: { id: order.assignedPileId! },
        data: { workingState: WorkingState.CHARGING }
      })
      return tx.chargingSession.create({
        data: { orderId: order.id, pileId: order.assignedPileId!, startTime: vNow }
      })
    })

    await this.queueCache.refreshPile(order.assignedPileId)
    return { orderId, sessionId: session.id, status: OrderStatus.CHARGING, pileId: order.assignedPileId }
  }

  async stop(orderId: string, userId?: string) {
    await this.ensureOrderOwner(orderId, userId)
    const order = await this.prisma.chargingOrder.findUniqueOrThrow({ where: { id: orderId } })
    if (order.status !== OrderStatus.CHARGING) throw new BadRequestException('Only CHARGING orders can be stopped.')
    const detail = await this.billingService.closeAndBill(orderId, 'USER_STOP', OrderStatus.FINISHED)
    await this.dispatchService.triggerBasic(order.chargeMode)
    return detail
  }

  private async requireWaitingOrder(orderId: string) {
    const order = await this.prisma.chargingOrder.findUniqueOrThrow({ where: { id: orderId } })
    if (order.status !== OrderStatus.WAITING) {
      throw new BadRequestException('Only WAITING orders can be modified.')
    }
    return order
  }

  private async nextQueueNo(mode: string) {
    const prefix = mode === 'FAST' ? 'F' : 'T'
    const existing = await this.prisma.chargingOrder.findMany({
      where: { chargeMode: mode as ChargeMode, queueNo: { startsWith: prefix } },
      select: { queueNo: true }
    })
    const max = existing.reduce((current, item) => {
      const number = Number(item.queueNo.replace(/\D/g, ''))
      return Number.isFinite(number) ? Math.max(current, number) : current
    }, 0)
    return `${prefix}${max + 1}`
  }

  private async ensureUserCanSubmit(userId: string) {
    await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })
    const existing = await this.prisma.chargingOrder.findFirst({
      where: {
        userId,
        status: { in: [OrderStatus.WAITING, OrderStatus.IN_PILE_QUEUE, OrderStatus.CHARGING] }
      }
    })
    if (existing) throw new BadRequestException('User already has an unfinished charging order.')
  }

  private async ensureWaitingCapacity() {
    const capacity = Number(this.config.get<string>('WAITING_AREA_SIZE') ?? 20)
    const count = await this.prisma.chargingOrder.count({
      where: { status: OrderStatus.WAITING }
    })
    if (count >= capacity) throw new BadRequestException('Waiting queue is full.')
  }

  private async ensureOrderOwner(orderId: string, userId?: string) {
    if (!userId) return
    const order = await this.prisma.chargingOrder.findUniqueOrThrow({
      where: { id: orderId },
      select: { userId: true }
    })
    if (order.userId !== userId) throw new BadRequestException('Order does not belong to current user.')
  }

  private queueArea(status: OrderStatus) {
    if (status === OrderStatus.WAITING) return 'WAITING'
    if (status === OrderStatus.IN_PILE_QUEUE) return 'PILE_QUEUE'
    if (status === OrderStatus.CHARGING) return 'CHARGING'
    return 'FINISHED'
  }

  private async aheadCount(order: { status: OrderStatus; chargeMode: ChargeMode; assignedPileId?: string | null; pileQueueEnteredAt?: Date | null; submitTime: Date; id: string }) {
    if (order.status === OrderStatus.WAITING) {
      return this.prisma.chargingOrder.count({
        where: {
          chargeMode: order.chargeMode,
          status: OrderStatus.WAITING,
          submitTime: { lt: order.submitTime }
        }
      })
    }
    if (order.status === OrderStatus.IN_PILE_QUEUE && order.assignedPileId) {
      return this.prisma.chargingOrder.count({
        where: {
          assignedPileId: order.assignedPileId,
          status: { in: [OrderStatus.IN_PILE_QUEUE, OrderStatus.CHARGING] },
          id: { not: order.id },
          OR: [
            { status: OrderStatus.CHARGING },
            { pileQueueEnteredAt: { lt: order.pileQueueEnteredAt ?? order.submitTime } }
          ]
        }
      })
    }
    return 0
  }

  private async estimatedWaitTime(order: { status: OrderStatus; assignedPileId?: string | null; pileQueueEnteredAt?: Date | null; submitTime: Date }) {
    if (order.status !== OrderStatus.IN_PILE_QUEUE || !order.assignedPileId) return 0
    const pile = await this.prisma.chargingPile.findUnique({
      where: { id: order.assignedPileId },
      include: {
        orders: {
          where: {
            status: { in: [OrderStatus.IN_PILE_QUEUE, OrderStatus.CHARGING] },
            OR: [
              { status: OrderStatus.CHARGING },
              { pileQueueEnteredAt: { lt: order.pileQueueEnteredAt ?? order.submitTime } }
            ]
          }
        }
      }
    })
    if (!pile) return 0
    const hours = pile.orders.reduce((sum, item) => sum + item.requestedAmount / pile.power, 0)
    return Math.round(hours * 60)
  }

  private toQueueStatus(
    order: { id: string; queueNo: string; status: string; assignedPileId?: string | null; chargeMode?: string; requestedAmount?: number },
    queueArea = 'WAITING',
    aheadCount = 0,
    estimatedWaitTime = 0
  ) {
    return {
      orderId: order.id,
      queueNo: order.queueNo,
      status: order.status,
      chargeMode: order.chargeMode,
      requestedAmount: order.requestedAmount,
      queueArea,
      assignedPileId: order.assignedPileId,
      aheadCount,
      estimatedWaitTime
    }
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as Record<string, unknown>).code === 'P2002'
}
