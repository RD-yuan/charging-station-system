import { Controller, Get, Inject, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { ReportService } from './report.service'

@ApiTags('reports')
@Roles('ADMIN')
@Controller('admin/reports')
export class ReportController {
  constructor(@Inject(ReportService) private readonly reportService: ReportService) {}

  @Get()
  list(@Query('timeType') timeType: 'DAY' | 'WEEK' | 'MONTH' = 'DAY') {
    return this.reportService.list(timeType)
  }
}
