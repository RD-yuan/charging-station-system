import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AuthModule } from './modules/auth/auth.module'
import { ChargingModule } from './modules/charging/charging.module'
import { DispatchModule } from './modules/dispatch/dispatch.module'
import { PileModule } from './modules/pile/pile.module'
import { ReportModule } from './modules/report/report.module'
import { PrismaModule } from './prisma/prisma.module'
import { RedisModule } from './redis/redis.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    AuthModule,
    ChargingModule,
    PileModule,
    DispatchModule,
    ReportModule
  ]
})
export class AppModule {}
