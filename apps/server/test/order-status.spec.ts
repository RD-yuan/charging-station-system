import { OrderStatus } from '../src/common/enums'

describe('OrderStatus', () => {
  it('keeps the agreed status enum stable', () => {
    expect(Object.values(OrderStatus)).toEqual([
      'WAITING',
      'IN_PILE_QUEUE',
      'CHARGING',
      'FINISHED',
      'CANCELED',
      'ABORTED'
    ])
  })
})
