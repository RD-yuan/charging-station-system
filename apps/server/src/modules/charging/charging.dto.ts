import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator'
import { ChargeMode } from '@prisma/client'

export class SubmitChargingRequestDto {
  @IsString()
  @IsOptional()
  userId?: string

  @IsEnum(ChargeMode)
  chargeMode!: ChargeMode

  @IsNumber()
  @Min(1)
  requestedAmount!: number
}

export class ModifyModeDto {
  @IsEnum(ChargeMode)
  newMode!: ChargeMode
}

export class ModifyAmountDto {
  @IsNumber()
  @Min(1)
  newAmount!: number
}

export class CancelChargingDto {
  @IsOptional()
  @IsString()
  reason?: string
}
