import { Injectable } from '@nestjs/common'
import { ChargeMode, DispatchStrategyType } from '../../common/enums'
import { HttpSchedulerClient } from './http-scheduler.client'

@Injectable()
export class DispatchService {
  constructor(private readonly schedulerClient: HttpSchedulerClient) {}

  async triggerBasic(mode: ChargeMode | string) {
    return this.safeSchedule('/dispatch/basic', { mode })
  }

  async triggerFaultReschedule(pileId: string, strategyType: DispatchStrategyType) {
    const path = strategyType === DispatchStrategyType.TIME_ORDER
      ? '/dispatch/fault-time-order'
      : '/dispatch/fault-priority'
    return this.safeSchedule(path, { pileId })
  }

  async triggerSingleOptimization(payload: { spotsCount: number; mode: ChargeMode }) {
    return this.safeSchedule('/dispatch/single-optimization', payload)
  }

  async triggerBatchOptimization(payload: { spotsCount: number }) {
    return this.safeSchedule('/dispatch/batch-optimization', payload)
  }

  private async safeSchedule(path: string, payload: unknown) {
    try {
      return await this.schedulerClient.post(path, payload)
    } catch {
      return {
        applied: false,
        message: 'Scheduler service unavailable; request accepted as no-op scaffold.',
        assignments: []
      }
    }
  }
}
