import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { BillingPeriod, ChargingSession, OrderStatus, WorkingState } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { QueueCacheService } from '../queue/queue-cache.service'

interface PriceRule {
  period: BillingPeriod
  startMinute: number
  endMinute: number
  price: number
  serviceFeeRate: number
  version: number
}

type SessionWithPile = ChargingSession & { pile: { power: number } }

@Injectable()
export class BillingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(QueueCacheService) private readonly queueCache: QueueCacheService
  ) {}

  async closeAndBill(
    orderId: string,
    stopReason: string,
    targetStatus: OrderStatus,
    pileWorkingState: WorkingState = WorkingState.IDLE
  ) {
    const order = await this.prisma.chargingOrder.findUnique({
      where: { id: orderId },
      include: {
        detail: true,
        sessions: {
          include: { pile: true },
          orderBy: { startTime: 'asc' }
        }
      }
    })
    if (!order) throw new BadRequestException(`Order ${orderId} not found.`)
    if (order.detail) return this.detailByOrder(orderId)

    const session = order.sessions.find((item) => item.sessionStatus === 'ACTIVE')
    if (!session) throw new BadRequestException(`Order ${orderId} has no active charging session.`)

    const stopTime = new Date()
    const rules = await this.activeRules()
    const activeActualAmount = this.actualAmount(order.requestedAmount, session, stopTime)
    const activeDuration = this.sessionDuration(session.startTime, stopTime)
    const previousSessions = order.sessions.filter((item) =>
      item.id !== session.id &&
      item.stopTime &&
      item.actualAmount &&
      item.actualAmount > 0
    )
    const previousAmount = previousSessions.reduce((sum, item) => sum + (item.actualAmount ?? 0), 0)
    const previousDuration = previousSessions.reduce((sum, item) => sum + this.sessionDuration(item.startTime, item.stopTime!), 0)
    const previousChargeFee = previousSessions.reduce((sum, item) => {
      return sum + this.calculateChargeFee(item.startTime, item.stopTime!, item.actualAmount ?? 0, rules)
    }, 0)

    const actualAmount = round(previousAmount + activeActualAmount, 4)
    const duration = round(previousDuration + activeDuration, 4)
    const chargeFee = round(previousChargeFee + this.calculateChargeFee(session.startTime, stopTime, activeActualAmount, rules), 2)
    const serviceFeeRate = rules[0]?.serviceFeeRate ?? 0.8
    const serviceFee = round(actualAmount * serviceFeeRate, 2)
    const totalFee = round(chargeFee + serviceFee, 2)
    const billingRuleVersion = rules[0]?.version ?? 1

    const detail = await this.prisma.$transaction(async (tx) => {
      await tx.chargingSession.update({
        where: { id: session.id },
        data: {
          stopTime,
          actualAmount: activeActualAmount,
          stopReason,
          sessionStatus: targetStatus === OrderStatus.ABORTED ? 'ABORTED' : 'CLOSED'
        }
      })
      await tx.chargingOrder.update({
        where: { id: order.id },
        data: {
          status: targetStatus,
          finishedAt: stopTime
        }
      })
      await tx.chargingPile.update({
        where: { id: session.pileId },
        data: {
          workingState: pileWorkingState,
          totalChargeCount: { increment: 1 },
          totalChargeDuration: { increment: activeDuration },
          totalChargeAmount: { increment: activeActualAmount }
        }
      })
      return tx.billingDetail.create({
        data: {
          orderId: order.id,
          sessionId: session.id,
          actualAmount,
          duration,
          chargeFee,
          serviceFee,
          totalFee,
          billingRuleVersion
        },
        include: {
          order: true,
          session: { include: { pile: true } }
        }
      })
    })

    await this.queueCache.refreshMode(order.chargeMode)
    await this.queueCache.refreshPile(session.pileId)
    return this.toDetailDto(detail)
  }

  async detailByOrder(orderId: string, userId?: string) {
    const detail = await this.prisma.billingDetail.findUnique({
      where: { orderId },
      include: { order: true, session: { include: { pile: true } } }
    })
    if (detail) {
      if (userId && detail.order.userId !== userId) throw new BadRequestException('Detail does not belong to current user.')
      return this.toDetailDto(detail)
    }
    throw new BadRequestException(`Order ${orderId} has no billing detail.`)
  }

  async detailById(detailId: string, userId?: string) {
    const detail = await this.prisma.billingDetail.findUnique({
      where: { id: detailId },
      include: { order: true, session: { include: { pile: true } } }
    })
    if (!detail) throw new BadRequestException(`Detail ${detailId} not found.`)
    if (userId && detail.order.userId !== userId) throw new BadRequestException('Detail does not belong to current user.')
    return this.toDetailDto(detail)
  }

  async activeRules() {
    const latest = await this.prisma.billingRule.findFirst({
      where: { active: true },
      orderBy: { version: 'desc' }
    })
    if (!latest) return defaultRules()

    const rules = await this.prisma.billingRule.findMany({
      where: { active: true, version: latest.version },
      orderBy: [{ startMinute: 'asc' }]
    })
    return rules.length > 0 ? rules : defaultRules()
  }

  calculateChargeFee(startTime: Date, stopTime: Date, actualAmount: number, rules: PriceRule[]) {
    const durationMs = Math.max(1, stopTime.getTime() - startTime.getTime())
    let cursor = startTime.getTime()
    let chargeFee = 0

    while (cursor < stopTime.getTime()) {
      const current = new Date(cursor)
      const nextBoundary = Math.min(stopTime.getTime(), this.nextRuleBoundary(current, rules).getTime())
      const sliceRatio = (nextBoundary - cursor) / durationMs
      const sliceAmount = actualAmount * sliceRatio
      const price = this.priceAt(current, rules)
      chargeFee += sliceAmount * price
      cursor = nextBoundary
    }

    if (cursor === startTime.getTime()) {
      chargeFee = actualAmount * this.priceAt(startTime, rules)
    }
    return round(chargeFee, 2)
  }

  private actualAmount(requestedAmount: number, session: SessionWithPile, stopTime: Date) {
    if (session.actualAmount && session.actualAmount > 0) return session.actualAmount
    const elapsedHours = Math.max(0, (stopTime.getTime() - session.startTime.getTime()) / 3_600_000)
    const delivered = elapsedHours * session.pile.power
    return round(Math.min(requestedAmount, delivered), 4)
  }

  private sessionDuration(startTime: Date, stopTime: Date) {
    return round((stopTime.getTime() - startTime.getTime()) / 3_600_000, 4)
  }

  private priceAt(time: Date, rules: PriceRule[]) {
    const minute = time.getHours() * 60 + time.getMinutes()
    return rules.find((rule) => minuteInRule(minute, rule))?.price ?? 0.7
  }

  private nextRuleBoundary(time: Date, rules: PriceRule[]) {
    const minute = time.getHours() * 60 + time.getMinutes()
    const boundaries = rules
      .flatMap((rule) => [rule.startMinute, rule.endMinute])
      .map((boundary) => {
        const next = new Date(time)
        next.setHours(Math.floor(boundary / 60), boundary % 60, 0, 0)
        if (next.getTime() <= time.getTime()) next.setDate(next.getDate() + 1)
        return next
      })
      .sort((a, b) => a.getTime() - b.getTime())
    return boundaries[0] ?? new Date(time.getTime() + 3_600_000)
  }

  private toDetailDto(detail: {
    id: string
    generatedAt: Date
    actualAmount: number
    duration: number
    chargeFee: number
    serviceFee: number
    totalFee: number
    order: { id: string; queueNo: string; userId: string; status: OrderStatus }
    session: { id: string; pileId: string; startTime: Date; stopTime: Date | null; pile: { id: string } }
  }) {
    return {
      detailId: detail.id,
      orderId: detail.order.id,
      sessionId: detail.session.id,
      queueNo: detail.order.queueNo,
      userId: detail.order.userId,
      status: detail.order.status,
      pileId: detail.session.pileId,
      generatedAt: detail.generatedAt,
      startTime: detail.session.startTime,
      stopTime: detail.session.stopTime,
      actualAmount: detail.actualAmount,
      duration: detail.duration,
      chargeFee: detail.chargeFee,
      serviceFee: detail.serviceFee,
      totalFee: detail.totalFee
    }
  }

}

function defaultRules(): PriceRule[] {
  return [
    { period: BillingPeriod.FLAT, startMinute: 7 * 60, endMinute: 10 * 60, price: 0.7, serviceFeeRate: 0.8, version: 1 },
    { period: BillingPeriod.PEAK, startMinute: 10 * 60, endMinute: 15 * 60, price: 1.0, serviceFeeRate: 0.8, version: 1 },
    { period: BillingPeriod.FLAT, startMinute: 15 * 60, endMinute: 18 * 60, price: 0.7, serviceFeeRate: 0.8, version: 1 },
    { period: BillingPeriod.PEAK, startMinute: 18 * 60, endMinute: 21 * 60, price: 1.0, serviceFeeRate: 0.8, version: 1 },
    { period: BillingPeriod.FLAT, startMinute: 21 * 60, endMinute: 23 * 60, price: 0.7, serviceFeeRate: 0.8, version: 1 },
    { period: BillingPeriod.VALLEY, startMinute: 23 * 60, endMinute: 7 * 60, price: 0.4, serviceFeeRate: 0.8, version: 1 }
  ]
}

function minuteInRule(minute: number, rule: PriceRule) {
  if (rule.startMinute < rule.endMinute) return minute >= rule.startMinute && minute < rule.endMinute
  return minute >= rule.startMinute || minute < rule.endMinute
}

function round(value: number, digits: number) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
