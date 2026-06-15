import { Module } from '@nestjs/common'
import { BillingModule } from '../billing/billing.module'
import { HttpSchedulerClient } from './http-scheduler.client'
import { AdminOptimizationController, DispatchController } from './dispatch.controller'
import { DispatchService } from './dispatch.service'

@Module({
  imports: [BillingModule],
  controllers: [DispatchController, AdminOptimizationController],
  providers: [DispatchService, HttpSchedulerClient],
  exports: [DispatchService]
})
export class DispatchModule {}
