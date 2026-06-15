import { Controller, Get, Inject } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { AdminDashboardService } from './admin-dashboard.service'

@ApiTags('admin dashboard')
@Controller('admin')
export class AdminDashboardController {
  constructor(@Inject(AdminDashboardService) private readonly dashboardService: AdminDashboardService) {}

  @Get('dashboard/stats')
  stats() {
    return this.dashboardService.stats()
  }

  @Get('waiting-queue')
  waitingQueue() {
    return this.dashboardService.waitingQueue()
  }
}
