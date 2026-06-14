import { IsEnum } from 'class-validator'
import { DispatchStrategyType } from '../../../common/enums'

export class RescheduleDto {
  @IsEnum(DispatchStrategyType)
  strategyType!: DispatchStrategyType
}
