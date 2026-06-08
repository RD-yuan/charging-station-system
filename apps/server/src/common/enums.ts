export enum ChargeMode {
  FAST = 'FAST',
  SLOW = 'SLOW'
}

export enum OrderStatus {
  WAITING = 'WAITING',
  IN_PILE_QUEUE = 'IN_PILE_QUEUE',
  CHARGING = 'CHARGING',
  FINISHED = 'FINISHED',
  CANCELED = 'CANCELED',
  ABORTED = 'ABORTED'
}

export enum PhysicalState {
  ON = 'ON',
  OFF = 'OFF'
}

export enum WorkingState {
  IDLE = 'IDLE',
  CHARGING = 'CHARGING',
  FAULT = 'FAULT'
}

export enum DispatchStrategyType {
  PRIORITY = 'PRIORITY',
  TIME_ORDER = 'TIME_ORDER'
}
