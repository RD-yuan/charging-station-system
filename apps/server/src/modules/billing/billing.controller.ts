import { Controller, Get, Inject, Param } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { BillingService } from './billing.service'

@ApiTags('billing')
@Roles('USER')
@Controller()
export class BillingController {
  constructor(@Inject(BillingService) private readonly billingService: BillingService) {}

  @Get('user/details/:detailId')
  detailById(@Param('detailId') detailId: string, @CurrentUser('userId') userId: string) {
    return this.billingService.detailById(detailId, userId)
  }

  @Get('user/charging/:orderId/detail')
  detailByOrder(@Param('orderId') orderId: string, @CurrentUser('userId') userId: string) {
    return this.billingService.detailByOrder(orderId, userId)
  }
}
