import { IsNotEmpty, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator'

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  username!: string

  @IsString()
  @MinLength(6)
  password!: string

  @IsOptional()
  @IsNumber()
  @Min(1)
  batteryCapacity?: number
}

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  username!: string

  @IsString()
  @IsNotEmpty()
  password!: string
}
