import { Module } from '@nestjs/common'
import { DispatchModule } from '../dispatch/dispatch.module'
import { ChargingController } from './charging.controller'
import { ChargingService } from './charging.service'

@Module({
  imports: [DispatchModule],
  controllers: [ChargingController],
  providers: [ChargingService],
  exports: [ChargingService]
})
export class ChargingModule {}
