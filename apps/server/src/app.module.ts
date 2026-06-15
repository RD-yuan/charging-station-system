import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ClockModule } from './common/clock.module'
import { AdminDashboardModule } from './modules/admin/admin-dashboard.module'
import { AcceptanceModule } from './modules/acceptance/acceptance.module'
import { AuthModule } from './modules/auth/auth.module'
import { BillingModule } from './modules/billing/billing.module'
import { ChargingAutoCompleteModule } from './modules/charging/charging-autocomplete.module'
import { ChargingModule } from './modules/charging/charging.module'
import { DispatchModule } from './modules/dispatch/dispatch.module'
import { PileModule } from './modules/pile/pile.module'
import { QueueModule } from './modules/queue/queue.module'
import { RealtimeModule } from './realtime/realtime.module'
import { ReportModule } from './modules/report/report.module'
import { PrismaModule } from './prisma/prisma.module'
import { RedisModule } from './redis/redis.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ClockModule,
    PrismaModule,
    RedisModule,
    RealtimeModule,
    QueueModule,
    BillingModule,
    AdminDashboardModule,
    AuthModule,
    ChargingModule,
    ChargingAutoCompleteModule,
    PileModule,
    DispatchModule,
    ReportModule,
    AcceptanceModule
  ]
})
export class AppModule {}
