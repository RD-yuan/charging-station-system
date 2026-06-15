import { OrderStatus } from '@prisma/client'
import { virtualElapsedHours } from './clock'

export function chargingProgress(
  order: {
    status: OrderStatus
    requestedAmount: number
    sessions: Array<{ startTime: Date }>
  },
  pilePower: number
): number {
  if (order.status !== OrderStatus.CHARGING || order.requestedAmount <= 0 || pilePower <= 0) return 0
  const session = order.sessions[0]
  if (!session) return 0
  return Math.min(100, Math.round((deliveredAmount(order, pilePower) / order.requestedAmount) * 1000) / 10)
}

export function deliveredAmount(
  order: {
    status: OrderStatus
    sessions: Array<{ startTime: Date }>
  },
  pilePower: number
): number {
  if (order.status !== OrderStatus.CHARGING || pilePower <= 0) return 0
  const session = order.sessions[0]
  if (!session) return 0
  return Math.round(virtualElapsedHours(session.startTime) * pilePower * 10_000) / 10_000
}
