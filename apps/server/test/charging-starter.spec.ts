import { OrderStatus, PhysicalState, WorkingState } from '@prisma/client'
import { ClockService } from '../src/common/clock.service'
import { ChargingStarterService } from '../src/modules/charging/charging-starter.service'

describe('ChargingStarterService', () => {
  it('automatically starts the head order on an idle pile', async () => {
    const head = {
      id: 'order-1',
      status: OrderStatus.IN_PILE_QUEUE,
      assignedPileId: 'F01',
      assignedPile: {
        id: 'F01',
        physicalState: PhysicalState.ON,
        workingState: WorkingState.IDLE
      }
    }
    const findFirst = jest.fn()
      .mockResolvedValueOnce(head)
      .mockResolvedValueOnce(head)
      .mockResolvedValueOnce(head)
    const refreshPile = jest.fn()
    const service = new ChargingStarterService(
      {
        chargingPile: {
          findUnique: jest.fn(async () => ({
            id: 'F01',
            physicalState: PhysicalState.ON,
            workingState: WorkingState.IDLE
          }))
        },
        chargingOrder: { findFirst },
        $transaction: jest.fn(async (operation) => operation({
          chargingPile: { updateMany: jest.fn(async () => ({ count: 1 })) },
          chargingOrder: { updateMany: jest.fn(async () => ({ count: 1 })) },
          chargingSession: { create: jest.fn(async () => ({ id: 'session-1' })) }
        }))
      } as never,
      { refreshPile } as never,
      new ClockService()
    )

    const started = await service.autoStartPileHeads(['F01'])

    expect(started).toEqual([{
      orderId: 'order-1',
      sessionId: 'session-1',
      status: OrderStatus.CHARGING,
      pileId: 'F01'
    }])
    expect(refreshPile).toHaveBeenCalledWith('F01')
  })

  it('does not automatically start an order on a busy pile', async () => {
    const findFirst = jest.fn()
    const service = new ChargingStarterService(
      {
        chargingPile: {
          findUnique: jest.fn(async () => ({
            id: 'F01',
            physicalState: PhysicalState.ON,
            workingState: WorkingState.CHARGING
          }))
        },
        chargingOrder: { findFirst }
      } as never,
      {} as never,
      new ClockService()
    )

    await expect(service.autoStartPileHeads(['F01'])).resolves.toEqual([])
    expect(findFirst).not.toHaveBeenCalled()
  })
})
