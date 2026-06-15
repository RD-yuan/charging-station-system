import { ChargeMode, OrderStatus, PhysicalState, WorkingState } from '@prisma/client'
import { ClockService } from '../src/common/clock.service'
import { PileService } from '../src/modules/pile/pile.service'

describe('PileService monitor data', () => {
  it('keeps the latest fault-interrupted order visible on a faulty pile', async () => {
    const interruptedOrder = {
      id: 'order-1',
      queueNo: 'F16',
      status: OrderStatus.ABORTED,
      userId: 'user-1',
      requestedAmount: 20,
      submitTime: new Date('2026-06-15T09:50:00.000Z'),
      startedAt: new Date('2026-06-15T10:00:00.000Z'),
      assignedPileId: 'F01',
      user: { username: 'hhx', batteryCapacity: 60 },
      detail: null,
      sessions: [{ actualAmount: 5, sessionStatus: 'ABORTED' }]
    }
    const service = new PileService(
      {
        chargingPile: {
          findMany: jest.fn(async () => [{
            id: 'F01',
            pileType: ChargeMode.FAST,
            power: 30,
            physicalState: PhysicalState.ON,
            workingState: WorkingState.FAULT,
            totalChargeCount: 1,
            totalChargeDuration: 0.2,
            totalChargeAmount: 5,
            updatedAt: new Date('2026-06-15T10:10:00.000Z'),
            orders: []
          }])
        },
        chargingOrder: { findMany: jest.fn(async () => [interruptedOrder]) }
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new ClockService()
    )

    const piles = await service.list()

    expect(piles[0].queue).toEqual([])
    expect(piles[0].interruptedOrder).toEqual(expect.objectContaining({
      orderId: 'order-1',
      status: OrderStatus.ABORTED,
      interrupted: true,
      deliveredEnergy: 5,
      progress: 25
    }))
  })
})
