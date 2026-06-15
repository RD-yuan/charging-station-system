import { ChargeMode, OrderStatus, PhysicalState, WorkingState } from '@prisma/client'
import { ClockService } from '../src/common/clock.service'
import { DispatchService } from '../src/modules/dispatch/dispatch.service'

describe('DispatchService automatic charging', () => {
  it('keeps initial basic dispatch manual unless the caller requests automatic start', async () => {
    const autoStartPileHeads = jest.fn(async () => [])
    const order = {
      id: 'order-1',
      queueNo: 'F1',
      chargeMode: ChargeMode.FAST,
      requestedAmount: 10,
      status: OrderStatus.WAITING
    }
    const pile = {
      id: 'F01',
      pileType: ChargeMode.FAST,
      power: 30,
      physicalState: PhysicalState.ON,
      workingState: WorkingState.IDLE,
      orders: []
    }
    const service = new DispatchService(
      {
        post: jest.fn(async () => ({
          assignments: [{ order_id: order.id, queue_no: order.queueNo, pile_id: pile.id }]
        }))
      } as never,
      {
        chargingOrder: {
          findMany: jest.fn(async () => [order]),
          findUnique: jest.fn(async () => order),
          count: jest.fn(async () => 0),
          update: jest.fn(async () => ({ ...order, status: OrderStatus.IN_PILE_QUEUE }))
        },
        chargingPile: {
          findMany: jest.fn(async () => [pile]),
          findUnique: jest.fn(async () => pile)
        }
      } as never,
      {
        refreshMode: jest.fn(),
        refreshPile: jest.fn()
      } as never,
      { broadcast: jest.fn() } as never,
      { get: jest.fn(() => '2') } as never,
      { autoStartPileHeads } as never,
      new ClockService()
    )

    await service.triggerBasic(ChargeMode.FAST)
    expect(autoStartPileHeads).not.toHaveBeenCalled()

    await service.triggerBasic(ChargeMode.FAST, true)
    expect(autoStartPileHeads).toHaveBeenCalledWith(['F01'])
  })
})
