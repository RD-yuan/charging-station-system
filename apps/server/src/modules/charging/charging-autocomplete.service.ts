import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { OrderStatus } from '@prisma/client'
import { ClockService } from '../../common/clock.service'
import { PrismaService } from '../../prisma/prisma.service'
import { BillingService } from '../billing/billing.service'
import { DispatchService } from '../dispatch/dispatch.service'

const TICK_INTERVAL_MS = 5_000
const COMPLETE_EPSILON = 1e-6

@Injectable()
export class ChargingAutoCompleteService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChargingAutoCompleteService.name)
  private timer: NodeJS.Timeout | null = null

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(DispatchService) private readonly dispatch: DispatchService,
    @Inject(ClockService) private readonly clock: ClockService
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error(`auto-complete tick failed: ${err?.message ?? err}`)
      })
    }, TICK_INTERVAL_MS)
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async tick() {
    const now = this.clock.now()
    const chargingOrders = await this.prisma.chargingOrder.findMany({
      where: { status: OrderStatus.CHARGING },
      include: {
        assignedPile: true,
        sessions: { where: { sessionStatus: 'ACTIVE' }, take: 1 }
      }
    })

    for (const order of chargingOrders) {
      const session = order.sessions[0]
      if (!session || !order.assignedPile) continue
      const elapsedHours = Math.max(0, (now.getTime() - session.startTime.getTime()) / 3_600_000)
      const delivered = elapsedHours * order.assignedPile.power
      if (delivered + COMPLETE_EPSILON >= order.requestedAmount) {
        try {
          await this.billing.closeAndBill(order.id, 'AUTO_COMPLETE', OrderStatus.FINISHED)
          await this.dispatch.triggerBasic(order.chargeMode, true)
          this.logger.log(
            `auto-completed ${order.queueNo} (delivered ${delivered.toFixed(2)}/${order.requestedAmount})`
          )
        } catch (err) {
          this.logger.warn(`auto-complete ${order.queueNo} failed: ${(err as Error).message}`)
        }
      }
    }
  }
}
