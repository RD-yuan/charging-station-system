import { BillingPeriod } from '@prisma/client'
import { BillingService } from '../src/modules/billing/billing.service'

interface ActualAmountTestSession {
  startTime: Date
  actualAmount: number | null
  pile: { power: number }
}

interface BillingServicePrivate {
  actualAmount: (requestedAmount: number, session: ActualAmountTestSession, stopTime: Date) => number
}

describe('BillingService', () => {
  it('splits charge fee across peak and flat time slices', () => {
    const service = new BillingService({} as never, {} as never)
    const fee = service.calculateChargeFee(
      new Date(2026, 0, 1, 10, 30, 0),
      new Date(2026, 0, 1, 15, 30, 0),
      50,
      [
        { period: BillingPeriod.PEAK, startMinute: 10 * 60, endMinute: 15 * 60, price: 1.0, serviceFeeRate: 0.8, version: 1 },
        { period: BillingPeriod.FLAT, startMinute: 15 * 60, endMinute: 18 * 60, price: 0.7, serviceFeeRate: 0.8, version: 1 }
      ]
    )

    expect(fee).toBe(48.5)
  })

  it('matches valley rules that cross midnight', () => {
    const service = new BillingService({} as never, {} as never)
    const fee = service.calculateChargeFee(
      new Date(2026, 0, 1, 23, 30, 0),
      new Date(2026, 0, 2, 0, 30, 0),
      10,
      [
        { period: BillingPeriod.VALLEY, startMinute: 23 * 60, endMinute: 7 * 60, price: 0.4, serviceFeeRate: 0.8, version: 1 }
      ]
    )

    expect(fee).toBe(4)
  })

  it('calculates actual amount from elapsed time instead of requested amount', () => {
    const service = new BillingService({} as never, {} as never)
    const startTime = new Date(2026, 0, 1, 10, 0, 0)
    const session: ActualAmountTestSession = {
      startTime,
      actualAmount: null,
      pile: { power: 30 }
    }
    const actualAmount = (service as unknown as BillingServicePrivate).actualAmount(30, session, new Date(2026, 0, 1, 10, 30, 0))

    expect(actualAmount).toBe(15)
  })

  it('does not bill the full request when charging stops immediately', () => {
    const service = new BillingService({} as never, {} as never)
    const startTime = new Date(2026, 0, 1, 10, 0, 0)
    const session: ActualAmountTestSession = {
      startTime,
      actualAmount: null,
      pile: { power: 30 }
    }
    const actualAmount = (service as unknown as BillingServicePrivate).actualAmount(30, session, startTime)

    expect(actualAmount).toBe(0)
  })
})
