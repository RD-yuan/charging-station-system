import { Body, Controller, Get, Inject, Param, Post, Put } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import {
  CancelChargingDto,
  ModifyAmountDto,
  ModifyModeDto,
  SubmitChargingRequestDto
} from './charging.dto'
import { ChargingService } from './charging.service'

@ApiTags('charging')
@Roles('ADMIN')
@Controller('charging')
export class ChargingController {
  constructor(@Inject(ChargingService) private readonly chargingService: ChargingService) {}

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

@ApiTags('user charging')
@Roles('USER')
@Controller('user/charging')
export class UserChargingAliasController {
  constructor(@Inject(ChargingService) private readonly chargingService: ChargingService) {}

  @Post('request')
  submitRequest(@Body() dto: SubmitChargingRequestDto, @CurrentUser('userId') userId: string) {
    return this.chargingService.submitRequest(dto, userId)
  }

  @Get('current')
  current(@CurrentUser('userId') userId: string) {
    return this.chargingService.current(userId)
  }

  @Put(':orderId/mode')
  modifyMode(@Param('orderId') orderId: string, @Body() dto: ModifyModeDto, @CurrentUser('userId') userId: string) {
    return this.chargingService.modifyMode(orderId, dto, userId)
  }

  @Put(':orderId/amount')
  modifyAmount(@Param('orderId') orderId: string, @Body() dto: ModifyAmountDto, @CurrentUser('userId') userId: string) {
    return this.chargingService.modifyAmount(orderId, dto, userId)
  }

  @Post(':orderId/cancel')
  cancel(@Param('orderId') orderId: string, @Body() dto: CancelChargingDto, @CurrentUser('userId') userId: string) {
    return this.chargingService.cancel(orderId, dto, userId)
  }

  @Get(':orderId/queue')
  queueStatus(@Param('orderId') orderId: string, @CurrentUser('userId') userId: string) {
    return this.chargingService.queueStatus(orderId, userId)
  }

  @Post(':orderId/start')
  start(@Param('orderId') orderId: string, @CurrentUser('userId') userId: string) {
    return this.chargingService.start(orderId, userId)
  }

  @Post(':orderId/stop')
  stop(@Param('orderId') orderId: string, @CurrentUser('userId') userId: string) {
    return this.chargingService.stop(orderId, userId)
  }
}
