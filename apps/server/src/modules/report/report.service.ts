import { Inject, Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class ReportService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(timeType: 'DAY' | 'WEEK' | 'MONTH') {
    const piles = await this.prisma.chargingPile.findMany({ orderBy: { id: 'asc' } })
    const rangeStart = rangeStartFor(timeType)
    const details = await this.prisma.billingDetail.findMany({
      where: { generatedAt: { gte: rangeStart } },
      include: { session: true }
    })

    const byPile = new Map<string, {
      totalChargeCount: number
      totalChargeDuration: number
      totalChargeAmount: number
      totalChargeFee: number
      totalServiceFee: number
      totalFee: number
    }>()

    for (const detail of details) {
      const current = byPile.get(detail.session.pileId) ?? {
        totalChargeCount: 0,
        totalChargeDuration: 0,
        totalChargeAmount: 0,
        totalChargeFee: 0,
        totalServiceFee: 0,
        totalFee: 0
      }
      current.totalChargeCount += 1
      current.totalChargeDuration += detail.duration
      current.totalChargeAmount += detail.actualAmount
      current.totalChargeFee += detail.chargeFee
      current.totalServiceFee += detail.serviceFee
      current.totalFee += detail.totalFee
      byPile.set(detail.session.pileId, current)
    }

    return piles.map((pile) => ({
      timeType,
      pileId: pile.id,
      totalChargeCount: byPile.get(pile.id)?.totalChargeCount ?? 0,
      totalChargeDuration: round(byPile.get(pile.id)?.totalChargeDuration ?? 0),
      totalChargeAmount: round(byPile.get(pile.id)?.totalChargeAmount ?? 0),
      totalChargeFee: round(byPile.get(pile.id)?.totalChargeFee ?? 0),
      totalServiceFee: round(byPile.get(pile.id)?.totalServiceFee ?? 0),
      totalFee: round(byPile.get(pile.id)?.totalFee ?? 0)
    }))
  }
}

function rangeStartFor(timeType: 'DAY' | 'WEEK' | 'MONTH') {
  const now = new Date()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (timeType === 'WEEK') start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  if (timeType === 'MONTH') start.setDate(1)
  return start
}

function round(value: number) {
  return Math.round(value * 100) / 100
}
