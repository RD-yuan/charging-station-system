import { Module } from '@nestjs/common'
import { ChargingStarterService } from './charging-starter.service'

@Module({
  providers: [ChargingStarterService],
  exports: [ChargingStarterService]
})
export class ChargingRuntimeModule {}
