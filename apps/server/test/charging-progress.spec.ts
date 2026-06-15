import { calculateChargingProgress } from '../src/modules/charging/charging-progress'

describe('calculateChargingProgress', () => {
  it('calculates live progress from elapsed time and pile power', () => {
    const metrics = calculateChargingProgress({
      requestedAmount: 30,
      power: 30,
      startedAt: new Date('2026-06-15T10:00:00.000Z'),
      now: new Date('2026-06-15T10:06:00.000Z')
    })

    expect(metrics).toEqual({ deliveredEnergy: 3, progress: 10 })
  })

  it('uses the final billed amount for an interrupted order', () => {
    const metrics = calculateChargingProgress({
      requestedAmount: 20,
      power: 30,
      startedAt: new Date('2026-06-15T10:00:00.000Z'),
      actualAmount: 5,
      now: new Date('2026-06-15T12:00:00.000Z')
    })

    expect(metrics).toEqual({ deliveredEnergy: 5, progress: 25 })
  })
})
