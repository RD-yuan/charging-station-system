import { IsNumber, IsOptional, IsString, Min } from 'class-validator'

export class RegisterDto {
  @IsString()
  username!: string

  @IsString()
  password!: string

  @IsOptional()
  @IsNumber()
  @Min(1)
  batteryCapacity?: number
}

export class LoginDto {
  @IsString()
  username!: string

  @IsString()
  password!: string
}
