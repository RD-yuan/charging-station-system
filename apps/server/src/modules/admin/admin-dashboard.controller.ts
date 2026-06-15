import { Controller, Get, Inject } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { AdminDashboardService } from './admin-dashboard.service'

@ApiTags('admin dashboard')
@Roles('ADMIN')
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
