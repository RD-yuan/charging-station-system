import { Module } from '@nestjs/common'
import { BillingModule } from '../billing/billing.module'
import { ChargingModule } from '../charging/charging.module'
import { DispatchModule } from '../dispatch/dispatch.module'
import { PileModule } from '../pile/pile.module'
import { AcceptanceController } from './acceptance.controller'
import { AcceptanceService } from './acceptance.service'

@Module({
  imports: [ChargingModule, BillingModule, PileModule, DispatchModule],
  controllers: [AcceptanceController],
  providers: [AcceptanceService]
})
export class AcceptanceModule {}
