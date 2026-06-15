import { ClockService } from '../src/common/clock.service'
import { QueueCacheService } from '../src/modules/queue/queue-cache.service'

describe('QueueCacheService', () => {
  it('broadcasts the complete waiting area when one charge mode changes', async () => {
    const fastOrder = waitingOrder('fast', 'F1', 'FAST')
    const slowOrder = waitingOrder('slow', 'T1', 'SLOW')
    const findMany = jest.fn()
      .mockResolvedValueOnce([fastOrder])
      .mockResolvedValueOnce([fastOrder, slowOrder])
    const setJson = jest.fn()
    const broadcast = jest.fn()
    const service = new QueueCacheService(
      { chargingOrder: { findMany } } as never,
      { setJson } as never,
      { broadcast } as never,
      new ClockService()
    )

    await service.refreshMode('FAST')

    expect(setJson).toHaveBeenCalledWith('waiting:FAST', expect.any(Array))
    expect(broadcast).toHaveBeenCalledWith(
      'waiting_queue_changed',
      expect.arrayContaining([
        expect.objectContaining({ orderId: 'fast' }),
        expect.objectContaining({ orderId: 'slow' })
      ])
    )
  })
})

function waitingOrder(id: string, queueNo: string, chargeMode: 'FAST' | 'SLOW') {
  return {
    id,
    queueNo,
    chargeMode,
    requestedAmount: 20,
    userId: `user-${id}`,
    submitTime: new Date('2026-06-15T00:00:00.000Z'),
    user: { username: `user-${id}` }
  }
}
