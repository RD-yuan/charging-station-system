import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  UploadedFile,
  UseInterceptors
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { AcceptanceService } from './acceptance.service'
import type { Request } from 'express'

@ApiTags('acceptance')
@Roles('ADMIN')
@Controller('admin/acceptance')
export class AcceptanceController {
  constructor(@Inject(AcceptanceService) private readonly service: AcceptanceService) {}

  @Post('run')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  async run(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request
  ) {
    const stopAtLimit = req.body?.stopAtLimit !== 'false' && req.body?.stopAtLimit !== false
    const result = await this.service.run({
      fileBuffer: file?.buffer,
      stopAtLimit
    })
    return {
      report: result.report,
      filename: `验收结果_${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`,
      excelBase64: result.excel.toString('base64')
    }
  }

  @Post('reset')
  @HttpCode(200)
  async reset() {
    await this.service.resetWorld()
    return { ok: true, message: '已清空订单/会话/账单与测试用户，重置充电桩状态。' }
  }

  @Get('health')
  health() {
    return { ok: true, ts: new Date().toISOString() }
  }
}
