import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  async list(timeType: 'DAY' | 'WEEK' | 'MONTH') {
    const piles = await this.prisma.chargingPile.findMany({ orderBy: { id: 'asc' } })
    return piles.map((pile) => ({
      timeType,
      pileId: pile.id,
      totalChargeCount: pile.totalChargeCount,
      totalChargeDuration: pile.totalChargeDuration,
      totalChargeAmount: pile.totalChargeAmount,
      totalChargeFee: 0,
      totalServiceFee: 0,
      totalFee: 0
    }))
  }
}
