import { BillingPeriod } from '@prisma/client'
import { ClockService } from '../src/common/clock.service'
import { BillingService } from '../src/modules/billing/billing.service'

describe('BillingService', () => {
  it('splits charge fee across peak and flat time slices', () => {
    const service = new BillingService({} as never, {} as never, {} as never)
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
    const service = new BillingService({} as never, {} as never, {} as never)
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

  it('does not bill the full requested amount when charging stops immediately', () => {
    const service = new BillingService({} as never, {} as never, {} as never)
    const startTime = new Date(2026, 0, 1, 10, 0, 0)
    const amount = (service as any).actualAmount(
      30,
      { startTime, actualAmount: null, pile: { power: 30 } },
      startTime
    )

    expect(amount).toBe(0)
  })

  it('records a fault segment without creating the final billing detail', async () => {
    const now = new Date()
    const billingDetailCreate = jest.fn()
    const service = new BillingService(
      {
        chargingOrder: {
          findUnique: jest.fn(async () => ({
            id: 'order-1',
            chargeMode: 'FAST',
            requestedAmount: 30,
            sessions: [{
              id: 'session-1',
              orderId: 'order-1',
              pileId: 'F01',
              startTime: now,
              actualAmount: null,
              sessionStatus: 'ACTIVE',
              pile: { power: 30 }
            }]
          }))
        },
        chargingSession: {
          aggregate: jest.fn(async () => ({ _sum: { actualAmount: 5 } }))
        },
        billingRule: {
          findFirst: jest.fn(async () => null),
          findMany: jest.fn(async () => [])
        },
        $transaction: jest.fn(async (operation) => operation({
          chargingSession: { update: jest.fn() },
          chargingOrder: { update: jest.fn() },
          chargingPile: { update: jest.fn() },
          billingDetail: { create: billingDetailCreate }
        }))
      } as never,
      { refreshMode: jest.fn(), refreshPile: jest.fn() } as never,
      new ClockService()
    )

    const result = await service.interruptForFault('order-1')

    expect(result).toEqual(expect.objectContaining({
      status: 'ABORTED',
      recoverable: true,
      actualAmount: 5
    }))
    expect(billingDetailCreate).not.toHaveBeenCalled()
  })
})
