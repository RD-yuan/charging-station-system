import { Module } from '@nestjs/common'
import { HttpSchedulerClient } from './http-scheduler.client'
import { DispatchController } from './dispatch.controller'
import { DispatchService } from './dispatch.service'

@Module({
  controllers: [DispatchController],
  providers: [DispatchService, HttpSchedulerClient],
  exports: [DispatchService]
})
export class DispatchModule {}
