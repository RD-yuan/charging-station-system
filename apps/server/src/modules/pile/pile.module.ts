import { Module } from '@nestjs/common'
import { BillingModule } from '../billing/billing.module'
import { DispatchModule } from '../dispatch/dispatch.module'
import { ChargingRuntimeModule } from '../charging/charging-runtime.module'
import { PileController } from './pile.controller'
import { PileService } from './pile.service'

@Module({
  imports: [BillingModule, DispatchModule, ChargingRuntimeModule],
  controllers: [PileController],
  providers: [PileService],
  exports: [PileService]
})
export class PileModule {}
