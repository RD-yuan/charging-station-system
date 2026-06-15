import { Inject, Injectable } from '@nestjs/common'
import { OrderStatus, PhysicalState, WorkingState } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class AdminDashboardService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async stats() {
    const [activeCount, chargingCount, waitingQueueCount, faultCount, totalPiles] = await Promise.all([
      this.prisma.chargingPile.count({ where: { physicalState: PhysicalState.ON } }),
      this.prisma.chargingPile.count({ where: { workingState: WorkingState.CHARGING } }),
      this.prisma.chargingOrder.count({ where: { status: OrderStatus.WAITING } }),
      this.prisma.chargingPile.count({ where: { workingState: WorkingState.FAULT } }),
      this.prisma.chargingPile.count()
    ])
    return {
      code: 200,
      data: {
        activeCount,
        chargingCount,
        waitingQueueCount,
        faultCount,
        overallEfficiency: activeCount > 0 ? Math.round((chargingCount / activeCount) * 100) : 0,
        totalPiles
      }
    }
  }

  async waitingQueue() {
    const orders = await this.prisma.chargingOrder.findMany({
      where: { status: OrderStatus.WAITING },
      include: { user: true },
      orderBy: [{ submitTime: 'asc' }, { queueNo: 'asc' }]
    })
    return orders.map((order) => ({
      orderId: order.id,
      userId: order.userId,
      username: order.user.username,
      mode: order.chargeMode,
      amount: order.requestedAmount,
      queueNo: order.queueNo,
      timestamp: order.submitTime.toLocaleTimeString()
    }))
  }
}
