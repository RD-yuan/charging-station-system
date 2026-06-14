import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ChargeMode, OrderStatus, PhysicalState, WorkingState } from '@prisma/client'
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

  async submitRequest(dto: SubmitChargingRequestDto) {
    await this.ensureUserCanSubmit(dto.userId)
    await this.ensureWaitingCapacity(dto.chargeMode)

    const queueNo = await this.nextQueueNo(dto.chargeMode)
    const order = await this.prisma.chargingOrder.create({
      data: {
        userId: dto.userId,
        chargeMode: dto.chargeMode,
        requestedAmount: dto.requestedAmount,
        queueNo,
        status: OrderStatus.WAITING
      }
    })
    await this.queueCache.refreshMode(dto.chargeMode)
    await this.dispatchService.triggerBasic(dto.chargeMode)
    return this.queueStatus(order.id)
  }

  async modifyMode(orderId: string, dto: ModifyModeDto) {
    const order = await this.requireWaitingOrder(orderId)
    await this.ensureWaitingCapacity(dto.newMode)
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

  async modifyAmount(orderId: string, dto: ModifyAmountDto) {
    const order = await this.requireWaitingOrder(orderId)
    const updated = await this.prisma.chargingOrder.update({
      where: { id: order.id },
      data: { requestedAmount: dto.newAmount }
    })
    await this.queueCache.refreshMode(updated.chargeMode)
    await this.dispatchService.triggerBasic(updated.chargeMode)
    return this.queueStatus(updated.id)
  }

  async cancel(orderId: string, dto: CancelChargingDto) {
    const order = await this.prisma.chargingOrder.findUniqueOrThrow({ where: { id: orderId } })
    if (order.status === OrderStatus.WAITING) {
      const updated = await this.prisma.chargingOrder.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.CANCELED,
          assignedPileId: null
        }
      })
      await this.queueCache.refreshMode(order.chargeMode)
      return this.toQueueStatus(updated, 'WAITING')
    }
    if (order.status === OrderStatus.IN_PILE_QUEUE) {
      const pileId = order.assignedPileId
      const updated = await this.prisma.chargingOrder.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.CANCELED,
          assignedPileId: null,
          pileQueueEnteredAt: null
        }
      })
      if (pileId) await this.queueCache.refreshPile(pileId)
      await this.dispatchService.triggerBasic(order.chargeMode)
      return this.toQueueStatus(updated, 'PILE_QUEUE')
    }
    if (order.status === OrderStatus.CHARGING) {
      const targetStatus = dto.reason === 'USER_STOP' || !dto.reason ? OrderStatus.FINISHED : OrderStatus.ABORTED
      const detail = await this.billingService.closeAndBill(orderId, dto.reason ?? 'USER_STOP', targetStatus)
      await this.dispatchService.triggerBasic(order.chargeMode)
      return detail
    }
    throw new BadRequestException(`Order ${order.status} cannot be canceled.`)
  }

  async queueStatus(orderId: string) {
    const order = await this.prisma.chargingOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { assignedPile: true }
    })
    const area = this.queueArea(order.status)
    const aheadCount = await this.aheadCount(order)
    const estimatedWaitTime = await this.estimatedWaitTime(order)
    return this.toQueueStatus(order, area, aheadCount, estimatedWaitTime)
  }

  async start(orderId: string) {
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

    const earlier = await this.prisma.chargingOrder.findFirst({
      where: {
        assignedPileId: order.assignedPileId,
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

    const session = await this.prisma.$transaction(async (tx) => {
      await tx.chargingOrder.update({
        where: { id: order.id },
        data: { status: OrderStatus.CHARGING, startedAt: new Date() }
      })
      await tx.chargingPile.update({
        where: { id: order.assignedPileId! },
        data: { workingState: WorkingState.CHARGING }
      })
      return tx.chargingSession.create({
        data: { orderId: order.id, pileId: order.assignedPileId! }
      })
    })

    await this.queueCache.refreshPile(order.assignedPileId)
    return { orderId, sessionId: session.id, status: OrderStatus.CHARGING, pileId: order.assignedPileId }
  }

  async stop(orderId: string) {
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

  private async ensureWaitingCapacity(mode: ChargeMode | string) {
    const capacity = Number(this.config.get<string>('WAITING_AREA_SIZE') ?? 20)
    const count = await this.prisma.chargingOrder.count({
      where: { chargeMode: mode as ChargeMode, status: OrderStatus.WAITING }
    })
    if (count >= capacity) throw new BadRequestException('Waiting queue is full.')
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
