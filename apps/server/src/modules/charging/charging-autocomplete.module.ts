import { Module } from '@nestjs/common'
import { BillingModule } from '../billing/billing.module'
import { DispatchModule } from '../dispatch/dispatch.module'
import { ChargingAutoCompleteService } from './charging-autocomplete.service'

@Module({
  imports: [BillingModule, DispatchModule],
  providers: [ChargingAutoCompleteService]
})
export class ChargingAutoCompleteModule {}
