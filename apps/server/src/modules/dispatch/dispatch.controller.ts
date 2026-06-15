import { Body, Controller, Inject, Param, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { ChargeMode } from '@prisma/client'
import { DispatchStrategyType } from '../../common/enums'
import { DispatchService } from './dispatch.service'

@ApiTags('dispatch')
@Controller('dispatch')
export class DispatchController {
  constructor(@Inject(DispatchService) private readonly dispatchService: DispatchService) {}

  @Post('basic/:mode')
  basic(@Param('mode') mode: ChargeMode) {
    return this.dispatchService.triggerBasic(mode)
  }

  @Post('fault/:pileId')
  fault(@Param('pileId') pileId: string, @Body('strategyType') strategyType: DispatchStrategyType) {
    return this.dispatchService.triggerFaultReschedule(pileId, strategyType)
  }

  @Post('single-optimization')
  single(@Body() body: { spotsCount: number; mode: ChargeMode }) {
    return this.dispatchService.triggerSingleOptimization(body)
  }

  @Post('batch-optimization')
  batch(@Body() body: { spotsCount: number }) {
    return this.dispatchService.triggerBatchOptimization(body)
  }
}

@ApiTags('admin optimization')
@Controller('admin/optimization')
export class AdminOptimizationController {
  constructor(@Inject(DispatchService) private readonly dispatchService: DispatchService) {}

  @Post('single')
  single(@Body() body: { spotsCount: number; mode: ChargeMode }) {
    return this.dispatchService.triggerSingleOptimization(body)
  }

  @Post('batch')
  batch(@Body() body: { spotsCount: number }) {
    return this.dispatchService.triggerBatchOptimization(body)
  }
}
