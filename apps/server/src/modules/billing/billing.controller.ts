import { Controller, Get, Inject, Param } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { BillingService } from './billing.service'

@ApiTags('billing')
@Controller()
export class BillingController {
  constructor(@Inject(BillingService) private readonly billingService: BillingService) {}

  @Get('user/details/:detailId')
  detailById(@Param('detailId') detailId: string) {
    return this.billingService.detailById(detailId)
  }

  @Get('user/charging/:orderId/detail')
  detailByOrder(@Param('orderId') orderId: string) {
    return this.billingService.detailByOrder(orderId)
  }
}
