import { Injectable } from '@nestjs/common'
import { DispatchStrategyType, PhysicalState, WorkingState } from '../../common/enums'
import { PrismaService } from '../../prisma/prisma.service'
import { DispatchService } from '../dispatch/dispatch.service'

@Injectable()
export class PileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchService: DispatchService
  ) {}

  list() {
    return this.prisma.chargingPile.findMany({ orderBy: { id: 'asc' } })
  }

  queue(pileId: string) {
    return this.prisma.chargingOrder.findMany({
      where: { assignedPileId: pileId },
      orderBy: { submitTime: 'asc' },
      include: { user: true }
    })
  }

  powerOn(pileId: string) {
    return this.prisma.chargingPile.update({
      where: { id: pileId },
      data: { physicalState: PhysicalState.ON, workingState: WorkingState.IDLE }
    })
  }

  powerOff(pileId: string) {
    return this.prisma.chargingPile.update({
      where: { id: pileId },
      data: { physicalState: PhysicalState.OFF, workingState: WorkingState.IDLE }
    })
  }

  reportFault(pileId: string) {
    return this.prisma.chargingPile.update({
      where: { id: pileId },
      data: { workingState: WorkingState.FAULT }
    })
  }

  reschedule(pileId: string, strategyType: DispatchStrategyType) {
    return this.dispatchService.triggerFaultReschedule(pileId, strategyType)
  }

  async recover(pileId: string) {
    const pile = await this.prisma.chargingPile.update({
      where: { id: pileId },
      data: { workingState: WorkingState.IDLE }
    })
    await this.dispatchService.triggerFaultReschedule(pileId, DispatchStrategyType.TIME_ORDER)
    return pile
  }
}
