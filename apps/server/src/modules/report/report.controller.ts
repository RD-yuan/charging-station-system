import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { ReportService } from './report.service'

@ApiTags('reports')
@Controller('admin/reports')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Get()
  list(@Query('timeType') timeType: 'DAY' | 'WEEK' | 'MONTH' = 'DAY') {
    return this.reportService.list(timeType)
  }
}
