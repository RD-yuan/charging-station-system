import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { BillingPeriod, ChargingSession, OrderStatus, WorkingState } from '@prisma/client'
import { ClockService } from '../../common/clock.service'
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

@Injectable()
export class BillingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(QueueCacheService) private readonly queueCache: QueueCacheService,
    @Inject(ClockService) private readonly clock: ClockService
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
        assignedPile: true,
        detail: true,
        sessions: {
          include: { pile: true },
          orderBy: { startTime: 'desc' },
        }
      }
    })
    if (!order) throw new BadRequestException(`Order ${orderId} not found.`)
    if (order.detail) return this.detailByOrder(orderId)
    const session = order.sessions.find((item) => item.sessionStatus === 'ACTIVE')
    if (!session) throw new BadRequestException(`Order ${orderId} has no active charging session.`)

    const stopTime = this.clock.now()
    const rules = await this.activeRules()
    const previousSessions = order.sessions.filter((item) => item.id !== session.id && item.stopTime)
    const previousAmount = previousSessions.reduce((sum, item) => sum + (item.actualAmount ?? 0), 0)
    const currentAmount = this.actualAmount(Math.max(0, order.requestedAmount - previousAmount), session, stopTime)
    const currentDuration = round((stopTime.getTime() - session.startTime.getTime()) / 3_600_000, 4)
    const actualAmount = round(previousAmount + currentAmount, 4)
    const duration = round(previousSessions.reduce(
      (sum, item) => sum + Math.max(0, (item.stopTime!.getTime() - item.startTime.getTime()) / 3_600_000),
      currentDuration
    ), 4)
    const chargeFee = round(previousSessions.reduce(
      (sum, item) => sum + this.calculateChargeFee(item.startTime, item.stopTime!, item.actualAmount ?? 0, rules),
      this.calculateChargeFee(session.startTime, stopTime, currentAmount, rules)
    ), 2)
    const serviceFeeRate = rules[0]?.serviceFeeRate ?? 0.8
    const serviceFee = round(actualAmount * serviceFeeRate, 2)
    const totalFee = round(chargeFee + serviceFee, 2)
    const billingRuleVersion = rules[0]?.version ?? 1

    await this.prisma.$transaction(async (tx) => {
      await tx.chargingSession.update({
        where: { id: session.id },
        data: {
          stopTime,
          actualAmount: currentAmount,
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
          totalChargeDuration: { increment: currentDuration },
          totalChargeAmount: { increment: currentAmount }
        }
      })
      try {
        await tx.billingDetail.create({
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
        })
      } catch (err: any) {
        // P2002 = unique constraint：并发场景下另一条线程已经为这个 order 创建过账单了
        //（AcceptanceService.tick 和 ChargingAutoCompleteService.tick 抢同一订单）。
        // 账单已经存在，事务其他副作用照常完成，最后通过 detailByOrder 返回那一份。
        if (err?.code !== 'P2002') throw err
      }
    })

    await this.queueCache.refreshMode(order.chargeMode)
    await this.queueCache.refreshPile(session.pileId)
    return this.detailByOrder(order.id)
  }

  async interruptForFault(orderId: string) {
    const order = await this.prisma.chargingOrder.findUnique({
      where: { id: orderId },
      include: {
        sessions: {
          where: { sessionStatus: 'ACTIVE' },
          include: { pile: true },
          orderBy: { startTime: 'desc' },
          take: 1
        }
      }
    })
    if (!order) throw new BadRequestException(`Order ${orderId} not found.`)
    const session = order.sessions[0]
    if (!session) throw new BadRequestException(`Order ${orderId} has no active charging session.`)

    const stopTime = this.clock.now()
    const rules = await this.activeRules()
    const previousAmount = await this.prisma.chargingSession.aggregate({
      where: { orderId, id: { not: session.id }, actualAmount: { not: null } },
      _sum: { actualAmount: true }
    })
    const deliveredBefore = previousAmount._sum.actualAmount ?? 0
    const actualAmount = this.actualAmount(
      Math.max(0, order.requestedAmount - deliveredBefore),
      session,
      stopTime
    )
    const duration = round((stopTime.getTime() - session.startTime.getTime()) / 3_600_000, 4)
    const chargeFee = this.calculateChargeFee(session.startTime, stopTime, actualAmount, rules)
    const serviceFee = round(actualAmount * (rules[0]?.serviceFeeRate ?? 0.8), 2)

    await this.prisma.$transaction(async (tx) => {
      await tx.chargingSession.update({
        where: { id: session.id },
        data: {
          stopTime,
          actualAmount,
          stopReason: 'FAULT',
          sessionStatus: 'ABORTED'
        }
      })
      await tx.chargingOrder.update({
        where: { id: order.id },
        data: { status: OrderStatus.ABORTED, finishedAt: stopTime }
      })
      await tx.chargingPile.update({
        where: { id: session.pileId },
        data: {
          workingState: WorkingState.FAULT,
          totalChargeDuration: { increment: duration },
          totalChargeAmount: { increment: actualAmount }
        }
      })
    })

    await this.queueCache.refreshMode(order.chargeMode)
    await this.queueCache.refreshPile(session.pileId)
    return {
      orderId,
      sessionId: session.id,
      pileId: session.pileId,
      status: OrderStatus.ABORTED,
      recoverable: true,
      actualAmount: round(deliveredBefore + actualAmount, 4),
      duration,
      chargeFee,
      serviceFee,
      totalFee: round(chargeFee + serviceFee, 2)
    }
  }

  async detailByOrder(orderId: string, userId?: string) {
    const detail = await this.prisma.billingDetail.findFirst({
      where: { orderId, ...(userId ? { order: { userId } } : {}) },
      include: { order: { include: { sessions: true } }, session: { include: { pile: true } } }
    })
    if (!detail) throw new BadRequestException(`Order ${orderId} has no billing detail.`)
    return this.toDetailDto(detail)
  }

  async listByUser(userId: string) {
    const details = await this.prisma.billingDetail.findMany({
      where: { order: { userId } },
      include: { order: { include: { sessions: true } }, session: { include: { pile: true } } },
      orderBy: { generatedAt: 'desc' }
    })
    return details.map((detail) => this.toDetailDto(detail))
  }

  async detailById(detailId: string, userId?: string) {
    const detail = await this.prisma.billingDetail.findFirst({
      where: { id: detailId, ...(userId ? { order: { userId } } : {}) },
      include: { order: { include: { sessions: true } }, session: { include: { pile: true } } }
    })
    if (!detail) throw new BadRequestException(`Detail ${detailId} not found.`)
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

  private actualAmount(requestedAmount: number, session: ChargingSession & { pile: { power: number } }, stopTime: Date) {
    if (session.actualAmount && session.actualAmount > 0) return session.actualAmount
    const elapsedHours = Math.max(0, (stopTime.getTime() - session.startTime.getTime()) / 3_600_000)
    const delivered = elapsedHours * session.pile.power
    return round(Math.max(0, Math.min(requestedAmount, delivered)), 4)
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
    order: { id: string; queueNo: string; userId: string; sessions?: Array<{ startTime: Date; stopTime: Date | null }> }
    session: { id: string; pileId: string; startTime: Date; stopTime: Date | null; pile: { id: string } }
  }) {
    return {
      detailId: detail.id,
      orderId: detail.order.id,
      sessionId: detail.session.id,
      queueNo: detail.order.queueNo,
      userId: detail.order.userId,
      pileId: detail.session.pileId,
      generatedAt: detail.generatedAt,
      startTime: detail.order.sessions?.reduce(
        (earliest, item) => item.startTime < earliest ? item.startTime : earliest,
        detail.session.startTime
      ) ?? detail.session.startTime,
      stopTime: detail.order.sessions?.reduce<Date | null>(
        (latest, item) => item.stopTime && (!latest || item.stopTime > latest) ? item.stopTime : latest,
        detail.session.stopTime
      ) ?? detail.session.stopTime,
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
