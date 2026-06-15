import { Module } from '@nestjs/common'
import { BillingModule } from '../billing/billing.module'
import { DispatchModule } from '../dispatch/dispatch.module'
import { ChargingController, UserChargingAliasController } from './charging.controller'
import { ChargingRuntimeModule } from './charging-runtime.module'
import { ChargingService } from './charging.service'

@Module({
  imports: [BillingModule, DispatchModule, ChargingRuntimeModule],
  controllers: [ChargingController, UserChargingAliasController],
  providers: [ChargingService],
  exports: [ChargingService]
})
export class ChargingModule {}
