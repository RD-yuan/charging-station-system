import { Body, Controller, Param, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { DispatchService } from './dispatch.service'
import {
  BatchOptimizationDto,
  DispatchBasicDto,
  FaultDispatchDto,
  SingleOptimizationDto
} from './dto/dispatch.dto'

@ApiTags('dispatch')
@Controller('dispatch')
export class DispatchController {
  constructor(private readonly dispatchService: DispatchService) {}

  @Post('basic')
  basic(@Body() dto: DispatchBasicDto) {
    return this.dispatchService.triggerBasic(dto.mode)
  }

  @Post('fault/:pileId')
  fault(@Param('pileId') pileId: string, @Body() dto: FaultDispatchDto) {
    return this.dispatchService.triggerFaultReschedule(pileId, dto.strategyType)
  }

  @Post('recovery-time-order')
  recovery() {
    return this.dispatchService.triggerRecoveryTimeOrder()
  }

  @Post('single-optimization')
  single(@Body() dto: SingleOptimizationDto) {
    return this.dispatchService.triggerSingleOptimization(dto)
  }

  @Post('batch-optimization')
  batch(@Body() dto: BatchOptimizationDto) {
    return this.dispatchService.triggerBatchOptimization(dto)
  }
}
