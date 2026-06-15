import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ChargeMode, OrderStatus } from '@prisma/client'
import { ClockService } from '../../common/clock.service'
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
import { ChargingStarterService } from './charging-starter.service'

@Injectable()
export class ChargingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DispatchService) private readonly dispatchService: DispatchService,
    @Inject(BillingService) private readonly billingService: BillingService,
    @Inject(QueueCacheService) private readonly queueCache: QueueCacheService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(ChargingStarterService) private readonly chargingStarter: ChargingStarterService,
    @Inject(ClockService) private readonly clock: ClockService
  ) {}

  private clockNow(): Date {
    return this.clock.now()
  }

  async submitRequest(dto: SubmitChargingRequestDto, userId?: string) {
    const uid = userId ?? dto.userId
    if (!uid) throw new BadRequestException('userId is required.')
    const user = await this.ensureUserCanSubmit(uid)
    if (dto.requestedAmount > user.batteryCapacity) {
      throw new BadRequestException('Requested amount exceeds the user battery capacity.')
    }
    await this.ensureWaitingCapacity(dto.chargeMode)

    const queueNo = await this.nextQueueNo(dto.chargeMode)
    const order = await this.prisma.chargingOrder.create({
      data: {
        userId: uid,
        chargeMode: dto.chargeMode,
        requestedAmount: dto.requestedAmount,
        queueNo,
        status: OrderStatus.WAITING,
        submitTime: this.clockNow()
      }
    })
    await this.queueCache.refreshMode(dto.chargeMode)
    await this.dispatchService.triggerBasic(dto.chargeMode, true)
    return this.queueStatus(order.id, uid)
  }

  async current(userId: string) {
    const order = await this.prisma.chargingOrder.findFirst({
      where: {
        userId,
        OR: [
          { status: { in: [OrderStatus.WAITING, OrderStatus.IN_PILE_QUEUE, OrderStatus.CHARGING] } },
          {
            status: OrderStatus.ABORTED,
            detail: null,
            sessions: { some: { stopReason: 'FAULT' } }
          }
        ]
      },
      orderBy: { createdAt: 'desc' }
    })
    return order ? this.queueStatus(order.id, userId) : null
  }

  async modifyMode(orderId: string, dto: ModifyModeDto, userId?: string) {
    const order = await this.requireWaitingOrder(orderId, userId)
    if (order.chargeMode === dto.newMode) return this.queueStatus(order.id, userId)
    const updated = await this.prisma.chargingOrder.update({
      where: { id: order.id },
      data: {
        chargeMode: dto.newMode,
        queueNo: await this.nextQueueNo(dto.newMode)
      }
    })
    await this.queueCache.refreshMode(order.chargeMode)
    await this.queueCache.refreshMode(dto.newMode)
    await this.dispatchService.triggerBasic(dto.newMode, true)
    return this.queueStatus(updated.id, userId)
  }

  async modifyAmount(orderId: string, dto: ModifyAmountDto, userId?: string) {
    const order = await this.requireWaitingOrder(orderId, userId)
    if (userId) {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })
      if (dto.newAmount > user.batteryCapacity) {
        throw new BadRequestException('Requested amount exceeds the user battery capacity.')
      }
    }
    const updated = await this.prisma.chargingOrder.update({
      where: { id: order.id },
      data: { requestedAmount: dto.newAmount }
    })
    await this.queueCache.refreshMode(updated.chargeMode)
    await this.dispatchService.triggerBasic(updated.chargeMode, true)
    return this.queueStatus(updated.id, userId)
  }

  async cancel(orderId: string, dto: CancelChargingDto, userId?: string) {
    const order = await this.requireOrder(orderId, userId)
    if (order.status === OrderStatus.WAITING) {
      const updated = await this.prisma.chargingOrder.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.CANCELED,
          assignedPileId: null
        }
      })
      await this.queueCache.refreshMode(order.chargeMode)
      return this.toQueueStatus(updated, this.queueArea(updated.status))
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
      await this.dispatchService.triggerBasic(order.chargeMode, true)
      return this.toQueueStatus(updated, this.queueArea(updated.status))
    }
    if (order.status === OrderStatus.CHARGING) {
      const targetStatus = dto.reason === 'USER_STOP' || !dto.reason ? OrderStatus.FINISHED : OrderStatus.ABORTED
      const detail = await this.billingService.closeAndBill(orderId, dto.reason ?? 'USER_STOP', targetStatus)
      await this.dispatchService.triggerBasic(order.chargeMode, true)
      return detail
    }
    if (order.status === OrderStatus.ABORTED) {
      // 故障中断的订单：用户放弃恢复，直接取消（已充的部分电量已在故障时结算到 session 里）
      const updated = await this.prisma.chargingOrder.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.CANCELED,
          assignedPileId: null,
          pileQueueEnteredAt: null
        }
      })
      await this.queueCache.refreshMode(order.chargeMode)
      return this.toQueueStatus(updated, this.queueArea(updated.status))
    }
    throw new BadRequestException(`Order ${order.status} cannot be canceled.`)
  }

  async queueStatus(orderId: string, userId?: string) {
    const order = await this.prisma.chargingOrder.findFirst({
      where: { id: orderId, ...(userId ? { userId } : {}) },
      include: { assignedPile: true, detail: true, sessions: true }
    })
    if (!order) throw new NotFoundException(`Order ${orderId} not found.`)
    const recoverable = order.status === OrderStatus.ABORTED
      && !order.detail
      && order.sessions.some((session) => session.stopReason === 'FAULT')
    const area = recoverable ? 'FAULT_INTERRUPTED' : this.queueArea(order.status)
    const aheadCount = await this.aheadCount(order)
    const estimatedWaitTime = await this.estimatedWaitTime(order)
    return { ...this.toQueueStatus(order, area, aheadCount, estimatedWaitTime), recoverable }
  }

  async start(orderId: string, userId?: string) {
    return this.chargingStarter.start(orderId, userId)
  }

  async stop(orderId: string, userId?: string) {
    const order = await this.requireOrder(orderId, userId)
    if (order.status !== OrderStatus.CHARGING) throw new BadRequestException('Only CHARGING orders can be stopped.')
    const detail = await this.billingService.closeAndBill(orderId, 'USER_STOP', OrderStatus.FINISHED)
    await this.dispatchService.triggerBasic(order.chargeMode, true)
    return detail
  }

  private async requireWaitingOrder(orderId: string, userId?: string) {
    const order = await this.requireOrder(orderId, userId)
    if (order.status !== OrderStatus.WAITING) {
      throw new BadRequestException('Only WAITING orders can be modified.')
    }
    return order
  }

  private async requireOrder(orderId: string, userId?: string) {
    const order = await this.prisma.chargingOrder.findFirst({
      where: { id: orderId, ...(userId ? { userId } : {}) }
    })
    if (!order) throw new NotFoundException(`Order ${orderId} not found.`)
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
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException(`User ${userId} not found.`)
    const existing = await this.prisma.chargingOrder.findFirst({
      where: {
        userId,
        OR: [
          { status: { in: [OrderStatus.WAITING, OrderStatus.IN_PILE_QUEUE, OrderStatus.CHARGING] } },
          {
            status: OrderStatus.ABORTED,
            detail: null,
            sessions: { some: { stopReason: 'FAULT' } }
          }
        ]
      }
    })
    if (existing) throw new BadRequestException('User already has an unfinished charging order.')
    return user
  }

  private async ensureWaitingCapacity(_mode: ChargeMode | string) {
    const capacity = Number(this.config.get<string>('WAITING_AREA_SIZE') ?? 20)
    const count = await this.prisma.chargingOrder.count({
      where: { status: OrderStatus.WAITING }
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
