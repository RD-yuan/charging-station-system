import { ChargeMode, OrderStatus, WorkingState } from '@prisma/client'
import type { SchedulerAssignment, SchedulerOrder, SchedulerPile } from '../src/modules/dispatch/dispatch.service'
import { batchOptimalDispatch, singleOptimalDispatch, totalFinishTime } from '../src/modules/dispatch/optimal-dispatch.strategy'

describe('optimal dispatch strategy', () => {
  it('finds the batch optimum instead of greedily filling the fast pile', () => {
    const orders = [
      order('o1', 'B1', 1, ChargeMode.SLOW),
      order('o2', 'B2', 1, ChargeMode.SLOW),
      order('o3', 'B3', 1, ChargeMode.SLOW),
      order('o4', 'B4', 2, ChargeMode.SLOW)
    ]
    const assignments = batchOptimalDispatch(orders, [
      pile('F01', ChargeMode.FAST, 30, 3),
      pile('T01', ChargeMode.SLOW, 10, 3)
    ])

    expect(assignments).toHaveLength(4)
    expect(totalFinishTime(assignments)).toBeCloseTo(0.3333, 4)
    expect(amountsByPile(assignments, orders).get('F01')).toEqual([1, 1, 2])
    expect(amountsByPile(assignments, orders).get('T01')).toEqual([1])
  })

  it('finds the single-dispatch optimum when piles already have different workloads', () => {
    const orders = [
      order('o1', 'F1', 1),
      order('o2', 'F2', 1),
      order('o3', 'F3', 1),
      order('o4', 'F4', 2),
      order('o5', 'F5', 2)
    ]
    const assignments = singleOptimalDispatch(orders, [
      pile('F01', ChargeMode.FAST, 1, 4, [order('base', 'F0', 5, ChargeMode.FAST, OrderStatus.CHARGING)]),
      pile('F02', ChargeMode.FAST, 1, 3)
    ])

    expect(assignments).toHaveLength(5)
    expect(totalFinishTime(assignments)).toBe(21)
    expect(amountsByPile(assignments, orders).get('F01')).toEqual([1, 2])
    expect(amountsByPile(assignments, orders).get('F02')).toEqual([1, 1, 2])
  })
})

function amountsByPile(assignments: SchedulerAssignment[], orders: SchedulerOrder[]) {
  const amountByOrder = new Map(orders.map((item) => [item.order_id, item.requested_amount]))
  const result = new Map<string, number[]>()
  for (const assignment of assignments) {
    const pileId = assignment.pile_id ?? assignment.pileId
    const orderId = assignment.order_id ?? assignment.orderId
    if (!pileId || !orderId) continue
    const amounts = result.get(pileId) ?? []
    amounts.push(amountByOrder.get(orderId) ?? 0)
    result.set(pileId, amounts)
  }
  return result
}

function order(
  orderId: string,
  queueNo: string,
  amount: number,
  mode: ChargeMode = ChargeMode.FAST,
  status: OrderStatus = OrderStatus.WAITING
): SchedulerOrder {
  return {
    order_id: orderId,
    queue_no: queueNo,
    charge_mode: mode,
    requested_amount: amount,
    status
  }
}

function pile(
  pileId: string,
  type: ChargeMode,
  power: number,
  capacity: number,
  queuedOrders: SchedulerOrder[] = []
): SchedulerPile {
  return {
    pile_id: pileId,
    pile_type: type,
    power,
    working_state: WorkingState.IDLE,
    queue_capacity: capacity,
    queued_orders: queuedOrders
  }
}
