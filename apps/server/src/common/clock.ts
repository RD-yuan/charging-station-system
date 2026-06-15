// 全局虚拟时钟：可调节流速以加速演示
let clockSpeed = 1.0
let baseRealMs = Date.now()
let baseVirtualMs = Date.now()

export function getClockSpeed(): number {
  return clockSpeed
}

export function setClockSpeed(speed: number) {
  baseVirtualMs = virtualNowMs()
  baseRealMs = Date.now()
  clockSpeed = Math.max(0.1, Math.min(100, speed))
}

export function virtualNowMs(): number {
  return baseVirtualMs + (Date.now() - baseRealMs) * clockSpeed
}

export function virtualNow(): Date {
  return new Date(virtualNowMs())
}

export function virtualElapsedMs(since: Date): number {
  return Math.max(0, virtualNowMs() - since.getTime())
}

export function virtualElapsedHours(since: Date): number {
  return virtualElapsedMs(since) / 3_600_000
}
