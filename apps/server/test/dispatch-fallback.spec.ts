import { ChargeMode, OrderStatus, WorkingState } from '@prisma/client'
import { localBasicDispatch, localTimeOrderDispatch } from '../src/modules/dispatch/dispatch.service'

describe('local dispatch fallback', () => {
  it('respects the configured pile queue capacity', () => {
    const assignments = localBasicDispatch(
      [order('o1', 'F1'), order('o2', 'F2')],
      [pile('F01', 1)]
    )

    expect(assignments.map((item) => item.order_id)).toEqual(['o1'])
  })

  it('restores original queue number order during time-order rescheduling', () => {
    const assignments = localTimeOrderDispatch(
      [order('o2', 'F2'), order('o1', 'F1')],
      [pile('F01', 2)]
    )

    expect(assignments.map((item) => item.queue_no)).toEqual(['F1', 'F2'])
  })
})

function order(order_id: string, queue_no: string) {
  return {
    order_id,
    queue_no,
    charge_mode: ChargeMode.FAST,
    requested_amount: 10,
    status: OrderStatus.WAITING
  }
}

function pile(pile_id: string, queue_capacity: number) {
  return {
    pile_id,
    pile_type: ChargeMode.FAST,
    power: 30,
    working_state: WorkingState.IDLE,
    queue_capacity,
    queued_orders: []
  }
}
