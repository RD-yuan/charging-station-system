import { ChargeMode, OrderStatus, PhysicalState, WorkingState } from '@prisma/client'
import { ClockService } from '../src/common/clock.service'
import { PileService } from '../src/modules/pile/pile.service'

describe('fault recovery', () => {
  it('restores the interrupted order and automatically resumes charging', async () => {
    const updateMany = jest.fn()
    const autoStartPileHeads = jest.fn(async () => [{
      orderId: 'order-1',
      sessionId: 'session-2',
      status: OrderStatus.CHARGING,
      pileId: 'F01'
    }])
    const triggerRecoveryReschedule = jest.fn()
    const triggerBasic = jest.fn()
    const pile = {
      id: 'F01',
      pileType: ChargeMode.FAST,
      physicalState: PhysicalState.ON,
      workingState: WorkingState.FAULT,
      updatedAt: new Date()
    }
    const service = new PileService(
      {
        chargingPile: {
          findUniqueOrThrow: jest.fn()
            .mockResolvedValueOnce(pile)
            .mockResolvedValueOnce({ ...pile, workingState: WorkingState.CHARGING })
        },
        chargingOrder: {
          findMany: jest.fn(async () => [{
            id: 'order-1',
            detail: null,
            pileQueueEnteredAt: new Date(),
            submitTime: new Date()
          }])
        },
        $transaction: jest.fn(async (operation) => operation({
          billingDetail: { deleteMany: jest.fn() },
          chargingOrder: { updateMany },
          chargingPile: { update: jest.fn() }
        }))
      } as never,
      { triggerRecoveryReschedule, triggerBasic } as never,
      {} as never,
      { refreshPile: jest.fn() } as never,
      {} as never,
      { autoStartPileHeads } as never,
      new ClockService()
    )

    const result = await service.recover('F01')

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: OrderStatus.IN_PILE_QUEUE, finishedAt: null }
    }))
    expect(autoStartPileHeads).toHaveBeenCalledWith(['F01'])
    expect(triggerRecoveryReschedule).toHaveBeenCalledWith('F01')
    expect(triggerBasic).toHaveBeenCalledWith(ChargeMode.FAST, true)
    expect(result.restoredOrderIds).toEqual(['order-1'])
    expect(result.resumed[0].status).toBe(OrderStatus.CHARGING)
  })
})
