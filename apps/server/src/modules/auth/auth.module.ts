import { Module } from '@nestjs/common'
import { AdminAuthAliasController, AdminAuthController, AuthController, UserAuthAliasController } from './auth.controller'
import { AuthService } from './auth.service'

@Module({
  controllers: [AuthController, UserAuthAliasController, AdminAuthController, AdminAuthAliasController],
  providers: [AuthService],
  exports: [AuthService]
})
export class AuthModule {}
