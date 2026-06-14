import { Inject, Injectable } from '@nestjs/common'
import { ChargeMode, OrderStatus } from '../../common/enums'
import { PrismaService } from '../../prisma/prisma.service'
import { RedisService } from '../../redis/redis.service'
import { RealtimeService } from '../../realtime/realtime.service'

@Injectable()
export class QueueCacheService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService
  ) {}

  async refreshMode(mode: ChargeMode | string, broadcast = true) {
    const waiting = await this.prisma.chargingOrder.findMany({
      where: { status: OrderStatus.WAITING, chargeMode: mode as ChargeMode },
      orderBy: [{ submitTime: 'asc' }, { queueNo: 'asc' }],
      include: { user: true }
    })

    const payload = waiting.map((order, index) => ({
      rank: index + 1,
      orderId: order.id,
      carId: order.queueNo,
      type: order.chargeMode,
      targetKwh: order.requestedAmount,
      userAccount: order.user.username,
      userId: order.userId,
      checkInTime: order.submitTime.toISOString(),
      queueNo: order.queueNo
    }))

    await this.redis.setJson(`waiting:${mode}`, payload)
    if (broadcast) this.realtime.broadcast('waiting_queue_changed', payload)
    return payload
  }

  async refreshPile(pileId: string, broadcast = true) {
    const pile = await this.prisma.chargingPile.findUnique({
      where: { id: pileId },
      include: {
        orders: {
          where: { status: { in: [OrderStatus.IN_PILE_QUEUE, OrderStatus.CHARGING] } },
          include: { user: true },
          orderBy: [{ status: 'desc' }, { pileQueueEnteredAt: 'asc' }, { submitTime: 'asc' }]
        }
      }
    })
    if (!pile) return null

    const payload = {
      id: pile.id,
      name: `${pile.id}号${pile.pileType === ChargeMode.FAST ? '快速' : '慢速'}充电桩`,
      type: pile.pileType,
      physicalState: pile.physicalState,
      status: pile.workingState,
      workingState: pile.workingState,
      currentPower: pile.workingState === 'CHARGING' ? String(pile.power) : '0',
      voltage: '380',
      targetCar: pile.orders[0]?.queueNo ?? null,
      progress: pile.workingState === 'CHARGING' ? 50 : 0,
      queue: pile.orders.map((order) => ({
        orderId: order.id,
        queueNo: order.queueNo,
        status: order.status,
        userId: order.userId,
        username: order.user.username,
        requestedAmount: order.requestedAmount,
        enteredAt: order.pileQueueEnteredAt?.toISOString() ?? null
      }))
    }

    await this.redis.setJson(`pile:${pileId}`, payload)
    if (broadcast) this.realtime.broadcast('pile_metrics_update', [payload])
    return payload
  }

  async refreshAll(broadcast = true) {
    const modes = await Promise.all([
      this.refreshMode(ChargeMode.FAST, broadcast),
      this.refreshMode(ChargeMode.SLOW, broadcast)
    ])
    const piles = await this.prisma.chargingPile.findMany({ select: { id: true } })
    await Promise.all(piles.map((pile) => this.refreshPile(pile.id, broadcast)))
    return { waiting: modes.flat(), piles: piles.length }
  }
}
