import { IsIn } from 'class-validator'
import { DispatchStrategyType } from '../../../common/enums'

export class RescheduleDto {
  @IsIn([DispatchStrategyType.PRIORITY, 'PRIORITY_QUEUE', DispatchStrategyType.TIME_ORDER])
  strategyType!: DispatchStrategyType | 'PRIORITY_QUEUE'
}
