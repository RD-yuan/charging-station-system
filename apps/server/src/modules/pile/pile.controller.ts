import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { DispatchStrategyType } from '../../common/enums'
import { PileService } from './pile.service'

@ApiTags('piles')
@Controller('admin/piles')
export class PileController {
  constructor(@Inject(PileService) private readonly pileService: PileService) {}

  @Get()
  list() {
    return this.pileService.list()
  }

  @Get(':pileId/queue')
  queue(@Param('pileId') pileId: string) {
    return this.pileService.queue(pileId)
  }

  @Post(':pileId/power-on')
  powerOn(@Param('pileId') pileId: string) {
    return this.pileService.powerOn(pileId)
  }

  @Post(':pileId/power-off')
  powerOff(@Param('pileId') pileId: string) {
    return this.pileService.powerOff(pileId)
  }

  @Post(':pileId/fault')
  fault(@Param('pileId') pileId: string) {
    return this.pileService.reportFault(pileId)
  }

  @Post(':pileId/reschedule')
  reschedule(@Param('pileId') pileId: string, @Body('strategyType') strategyType: DispatchStrategyType) {
    return this.pileService.reschedule(pileId, normalizeStrategy(strategyType))
  }

  @Post(':pileId/recover')
  recover(@Param('pileId') pileId: string) {
    return this.pileService.recover(pileId)
  }

  @Post(':pileId/control')
  control(@Param('pileId') pileId: string, @Body() body: { action: string; targetState?: string }) {
    return this.pileService.control(pileId, body.action, body.targetState)
  }
}

function normalizeStrategy(strategyType: DispatchStrategyType | string) {
  return strategyType === 'PRIORITY_QUEUE' ? DispatchStrategyType.PRIORITY : strategyType as DispatchStrategyType
}
