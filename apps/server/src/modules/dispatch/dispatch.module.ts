import { Module } from '@nestjs/common'
import { ChargingRuntimeModule } from '../charging/charging-runtime.module'
import { HttpSchedulerClient } from './http-scheduler.client'
import { AdminOptimizationController, DispatchController } from './dispatch.controller'
import { DispatchService } from './dispatch.service'

@Module({
  imports: [ChargingRuntimeModule],
  controllers: [DispatchController, AdminOptimizationController],
  providers: [DispatchService, HttpSchedulerClient],
  exports: [DispatchService]
})
export class DispatchModule {}
