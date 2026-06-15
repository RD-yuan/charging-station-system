import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { OrderStatus, PhysicalState, WorkingState } from '@prisma/client'
import { ClockService } from '../../common/clock.service'
import { PrismaService } from '../../prisma/prisma.service'
import { QueueCacheService } from '../queue/queue-cache.service'

@Injectable()
export class ChargingStarterService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(QueueCacheService) private readonly queueCache: QueueCacheService,
    @Inject(ClockService) private readonly clock: ClockService
  ) {}

  async start(orderId: string, userId?: string) {
    const order = await this.prisma.chargingOrder.findFirst({
      where: { id: orderId, ...(userId ? { userId } : {}) },
      include: { assignedPile: true }
    })
    if (!order) throw new NotFoundException(`Order ${orderId} not found.`)
    if (order.status !== OrderStatus.IN_PILE_QUEUE || !order.assignedPileId || !order.assignedPile) {
      throw new BadRequestException('Only orders at the head of a pile queue can start charging.')
    }
    if (order.assignedPile.physicalState !== PhysicalState.ON || order.assignedPile.workingState !== WorkingState.IDLE) {
      throw new BadRequestException('Assigned pile is not available.')
    }

    const head = await this.findPileQueueHead(order.assignedPileId)
    if (!head || head.id !== order.id) {
      throw new BadRequestException('Order is not at the head of its pile queue.')
    }

    const session = await this.prisma.$transaction(async (tx) => {
      const updatedPile = await tx.chargingPile.updateMany({
        where: {
          id: order.assignedPileId!,
          physicalState: PhysicalState.ON,
          workingState: WorkingState.IDLE
        },
        data: { workingState: WorkingState.CHARGING }
      })
      const updatedOrder = await tx.chargingOrder.updateMany({
        where: {
          id: order.id,
          status: OrderStatus.IN_PILE_QUEUE,
          assignedPileId: order.assignedPileId
        },
        data: { status: OrderStatus.CHARGING, startedAt: this.clock.now() }
      })
      if (updatedPile.count !== 1 || updatedOrder.count !== 1) {
        throw new BadRequestException('Order or pile state changed before charging could start.')
      }
      return tx.chargingSession.create({
        data: { orderId: order.id, pileId: order.assignedPileId!, startTime: this.clock.now() }
      })
    })

    await this.queueCache.refreshPile(order.assignedPileId)
    return { orderId, sessionId: session.id, status: OrderStatus.CHARGING, pileId: order.assignedPileId }
  }

  async autoStartPileHeads(pileIds: string[]) {
    const started: Array<{ orderId: string; sessionId: string; status: OrderStatus; pileId: string }> = []
    for (const pileId of [...new Set(pileIds)].sort()) {
      const pile = await this.prisma.chargingPile.findUnique({ where: { id: pileId } })
      if (!pile || pile.physicalState !== PhysicalState.ON || pile.workingState !== WorkingState.IDLE) continue

      const head = await this.findPileQueueHead(pileId)
      if (!head) continue
      try {
        started.push(await this.start(head.id))
      } catch (error) {
        if (!(error instanceof BadRequestException)) throw error
      }
    }
    return started
  }

  private findPileQueueHead(pileId: string) {
    return this.prisma.chargingOrder.findFirst({
      where: { assignedPileId: pileId, status: OrderStatus.IN_PILE_QUEUE },
      orderBy: [{ pileQueueEnteredAt: 'asc' }, { submitTime: 'asc' }]
    })
  }
}
