import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator'

export class RegisterDto {
  @IsString()
  username!: string

  @IsString()
  password!: string

  @IsOptional()
  @IsIn(['USER', 'ADMIN'])
  role?: string

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
