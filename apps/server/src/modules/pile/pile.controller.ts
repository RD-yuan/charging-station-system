import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { RolesGuard } from '../auth/guards/roles.guard'
import { PileService } from './pile.service'
import { RescheduleDto } from './dto/pile.dto'

@ApiTags('piles')
@ApiBearerAuth()
@Controller('admin/piles')
@UseGuards(RolesGuard)
@Roles('ADMIN')
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
  reschedule(@Param('pileId') pileId: string, @Body() dto: RescheduleDto) {
    return this.pileService.reschedule(pileId, dto.strategyType)
  }

  @Post(':pileId/recover')
  recover(@Param('pileId') pileId: string) {
    return this.pileService.recover(pileId)
  }
}
