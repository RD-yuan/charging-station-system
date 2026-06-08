import { BadRequestException, Injectable } from '@nestjs/common'
import { OrderStatus } from '../../common/enums'
import { PrismaService } from '../../prisma/prisma.service'
import { DispatchService } from '../dispatch/dispatch.service'
import {
  CancelChargingDto,
  ModifyAmountDto,
  ModifyModeDto,
  SubmitChargingRequestDto
} from './charging.dto'

@Injectable()
export class ChargingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchService: DispatchService
  ) {}

  async submitRequest(dto: SubmitChargingRequestDto) {
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
    await this.dispatchService.triggerBasic(dto.chargeMode)
    return this.toQueueStatus(order)
  }

  async modifyMode(orderId: string, dto: ModifyModeDto) {
    const order = await this.requireWaitingOrder(orderId)
    const updated = await this.prisma.chargingOrder.update({
      where: { id: order.id },
      data: {
        chargeMode: dto.newMode,
        queueNo: await this.nextQueueNo(dto.newMode)
      }
    })
    await this.dispatchService.triggerBasic(dto.newMode)
    return this.toQueueStatus(updated)
  }

  async modifyAmount(orderId: string, dto: ModifyAmountDto) {
    const order = await this.requireWaitingOrder(orderId)
    const updated = await this.prisma.chargingOrder.update({
      where: { id: order.id },
      data: { requestedAmount: dto.newAmount }
    })
    await this.dispatchService.triggerBasic(updated.chargeMode)
    return this.toQueueStatus(updated)
  }

  async cancel(orderId: string, dto: CancelChargingDto) {
    const order = await this.prisma.chargingOrder.findUniqueOrThrow({ where: { id: orderId } })
    if (order.status === OrderStatus.WAITING || order.status === OrderStatus.IN_PILE_QUEUE) {
      const updated = await this.prisma.chargingOrder.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.CANCELED,
          assignedPileId: null
        }
      })
      await this.dispatchService.triggerBasic(order.chargeMode)
      return this.toQueueStatus(updated)
    }
    if (order.status === OrderStatus.CHARGING) {
      return {
        orderId,
        status: dto.reason === 'USER_STOP' ? OrderStatus.FINISHED : OrderStatus.ABORTED,
        message: 'Charging session billing will be completed by BillingService.'
      }
    }
    throw new BadRequestException(`Order ${order.status} cannot be canceled.`)
  }

  async queueStatus(orderId: string) {
    const order = await this.prisma.chargingOrder.findUniqueOrThrow({ where: { id: orderId } })
    return this.toQueueStatus(order)
  }

  async start(orderId: string) {
    return { orderId, status: OrderStatus.CHARGING }
  }

  async stop(orderId: string) {
    return { orderId, status: OrderStatus.FINISHED }
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
    const count = await this.prisma.chargingOrder.count({ where: { chargeMode: mode as never } })
    return `${prefix}${count + 1}`
  }

  private toQueueStatus(order: { id: string; queueNo: string; status: string; assignedPileId?: string | null }) {
    return {
      orderId: order.id,
      queueNo: order.queueNo,
      status: order.status,
      assignedPileId: order.assignedPileId,
      aheadCount: 0,
      estimatedWaitTime: 0
    }
  }
}
