interface ChargingProgressInput {
  requestedAmount: number
  power: number
  startedAt?: Date | null
  actualAmount?: number | null
  previousAmount?: number | null
  now?: Date
}

export interface ChargingProgress {
  deliveredEnergy: number
  progress: number
}

export function calculateChargingProgress(input: ChargingProgressInput): ChargingProgress {
  const requestedAmount = Math.max(0, input.requestedAmount)
  const elapsedHours = input.startedAt
    ? Math.max(0, ((input.now ?? new Date()).getTime() - input.startedAt.getTime()) / 3_600_000)
    : 0
  const calculatedEnergy = Math.max(0, input.previousAmount ?? 0)
    + elapsedHours * Math.max(0, input.power)
  const deliveredEnergy = clamp(
    input.actualAmount ?? calculatedEnergy,
    0,
    requestedAmount
  )
  const progress = requestedAmount > 0 ? (deliveredEnergy / requestedAmount) * 100 : 0

  return {
    deliveredEnergy: round(deliveredEnergy, 4),
    progress: round(clamp(progress, 0, 100), 1)
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function round(value: number, digits: number) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
