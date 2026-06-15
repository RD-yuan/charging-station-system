import { IsEnum, IsInt, IsPositive } from 'class-validator'
import { ChargeMode, DispatchStrategyType } from '../../../common/enums'

export class DispatchBasicDto {
  @IsEnum(ChargeMode)
  mode!: ChargeMode
}

export class FaultDispatchDto {
  @IsEnum(DispatchStrategyType)
  strategyType!: DispatchStrategyType
}

export class SingleOptimizationDto {
  @IsInt()
  @IsPositive()
  spotsCount!: number

  @IsEnum(ChargeMode)
  mode!: ChargeMode
}

export class BatchOptimizationDto {
  @IsInt()
  @IsPositive()
  spotsCount!: number
}
