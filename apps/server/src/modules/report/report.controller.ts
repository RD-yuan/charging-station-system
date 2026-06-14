import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { RolesGuard } from '../auth/guards/roles.guard'
import { ReportService } from './report.service'

@ApiTags('reports')
@ApiBearerAuth()
@Controller('admin/reports')
@UseGuards(RolesGuard)
@Roles('ADMIN')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Get()
  list(@Query('timeType') timeType: 'DAY' | 'WEEK' | 'MONTH' = 'DAY') {
    return this.reportService.list(timeType)
  }
}
