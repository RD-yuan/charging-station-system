import { Module } from '@nestjs/common'
import { BillingModule } from '../billing/billing.module'
import { DispatchModule } from '../dispatch/dispatch.module'
import { PileController } from './pile.controller'
import { PileService } from './pile.service'

@Module({
  imports: [BillingModule, DispatchModule],
  controllers: [PileController],
  providers: [PileService]
})
export class PileModule {}
