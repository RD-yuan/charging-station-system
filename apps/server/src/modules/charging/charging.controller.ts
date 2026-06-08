import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import {
  CancelChargingDto,
  ModifyAmountDto,
  ModifyModeDto,
  SubmitChargingRequestDto
} from './charging.dto'
import { ChargingService } from './charging.service'

@ApiTags('charging')
@Controller('charging')
export class ChargingController {
  constructor(private readonly chargingService: ChargingService) {}

  @Post('request')
  submitRequest(@Body() dto: SubmitChargingRequestDto) {
    return this.chargingService.submitRequest(dto)
  }

  @Put(':orderId/mode')
  modifyMode(@Param('orderId') orderId: string, @Body() dto: ModifyModeDto) {
    return this.chargingService.modifyMode(orderId, dto)
  }

  @Put(':orderId/amount')
  modifyAmount(@Param('orderId') orderId: string, @Body() dto: ModifyAmountDto) {
    return this.chargingService.modifyAmount(orderId, dto)
  }

  @Post(':orderId/cancel')
  cancel(@Param('orderId') orderId: string, @Body() dto: CancelChargingDto) {
    return this.chargingService.cancel(orderId, dto)
  }

  @Get(':orderId/queue')
  queueStatus(@Param('orderId') orderId: string) {
    return this.chargingService.queueStatus(orderId)
  }

  @Post(':orderId/start')
  start(@Param('orderId') orderId: string) {
    return this.chargingService.start(orderId)
  }

  @Post(':orderId/stop')
  stop(@Param('orderId') orderId: string) {
    return this.chargingService.stop(orderId)
  }
}
