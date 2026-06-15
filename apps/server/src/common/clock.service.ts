import { Injectable } from '@nestjs/common'

@Injectable()
export class ClockService {
  private frozen = false
  private frozenAt: number = 0

  now(): Date {
    return this.frozen ? new Date(this.frozenAt) : new Date()
  }

  millis(): number {
    return this.frozen ? this.frozenAt : Date.now()
  }

  freeze(at: Date) {
    this.frozenAt = at.getTime()
    this.frozen = true
  }

  advanceTo(at: Date) {
    this.frozenAt = at.getTime()
    this.frozen = true
  }

  thaw() {
    this.frozen = false
    this.frozenAt = 0
  }

  isFrozen() {
    return this.frozen
  }
}
