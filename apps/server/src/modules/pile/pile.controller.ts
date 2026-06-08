import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { DispatchStrategyType } from '../../common/enums'
import { PileService } from './pile.service'

@ApiTags('piles')
@Controller('admin/piles')
export class PileController {
  constructor(private readonly pileService: PileService) {}

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
    return this.pileService.reschedule(pileId, strategyType)
  }

  @Post(':pileId/recover')
  recover(@Param('pileId') pileId: string) {
    return this.pileService.recover(pileId)
  }
}
