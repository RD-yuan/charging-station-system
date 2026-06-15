import { Body, Controller, Inject, Param, ParseEnumPipe, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { ChargeMode } from '@prisma/client'
import { DispatchStrategyType } from '../../common/enums'
import { Roles } from '../../common/decorators/roles.decorator'
import { DispatchService } from './dispatch.service'
import { BatchOptimizationDto, FaultDispatchDto, SingleOptimizationDto } from './dto/dispatch.dto'

@ApiTags('dispatch')
@Roles('ADMIN')
@Controller('dispatch')
export class DispatchController {
  constructor(@Inject(DispatchService) private readonly dispatchService: DispatchService) {}

  @Post('basic/:mode')
  basic(@Param('mode', new ParseEnumPipe(ChargeMode)) mode: ChargeMode) {
    return this.dispatchService.triggerBasic(mode, true)
  }

  @Post('fault/:pileId')
  fault(@Param('pileId') pileId: string, @Body() dto: FaultDispatchDto) {
    return this.dispatchService.triggerFaultReschedule(pileId, dto.strategyType)
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

@ApiTags('admin optimization')
@Roles('ADMIN')
@Controller('admin/optimization')
export class AdminOptimizationController {
  constructor(@Inject(DispatchService) private readonly dispatchService: DispatchService) {}

  @Post('single')
  single(@Body() dto: SingleOptimizationDto) {
    return this.dispatchService.triggerSingleOptimization(dto)
  }

  @Post('batch')
  batch(@Body() dto: BatchOptimizationDto) {
    return this.dispatchService.triggerBatchOptimization(dto)
  }
}
