import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { RolesGuard } from '../auth/guards/roles.guard'
import { ReportService } from './report.service'

@ApiTags('reports')
@UseGuards(RolesGuard)
@Roles('ADMIN')
@Controller('admin/reports')
export class ReportController {
  constructor(@Inject(ReportService) private readonly reportService: ReportService) {}

  @Get()
  list(@Query('timeType') timeType: 'DAY' | 'WEEK' | 'MONTH' = 'DAY') {
    return this.reportService.list(timeType)
  }
}
