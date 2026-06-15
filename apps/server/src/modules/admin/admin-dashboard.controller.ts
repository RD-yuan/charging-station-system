import { Body, Controller, Get, Inject, Post, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { getClockSpeed, setClockSpeed } from '../../common/clock'
import { Roles } from '../../common/decorators/roles.decorator'
import { RolesGuard } from '../auth/guards/roles.guard'
import { AdminDashboardService } from './admin-dashboard.service'

@ApiTags('admin dashboard')
@UseGuards(RolesGuard)
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

  @Get('clock-speed')
  getClockSpeed() {
    return { speed: getClockSpeed() }
  }

  @Post('clock-speed')
  setClockSpeed(@Body('speed') speed: number) {
    const clamped = Math.max(0.1, Math.min(100, Number(speed) || 1))
    setClockSpeed(clamped)
    return { speed: getClockSpeed() }
  }
}
