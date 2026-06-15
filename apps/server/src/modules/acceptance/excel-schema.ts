export interface AcceptanceEvent {
  rowIndex: number
  rawTime: string
  time: Date
  raw: string
  parsed: EventTuple | null
}

export interface EventTuple {
  action: 'A' | 'B' | 'C' | string
  target: string
  flag: string
  value: string
}

export interface PileSnapshotSlot {
  vehicle: string | null
  deliveredEnergy: number
  currentFee: number
}

export interface PileSnapshot {
  pileId: string
  /** 3 个席位：slot[0]=队首(充电中), slot[1]=第1个排队, slot[2]=第2个排队 */
  slots: PileSnapshotSlot[]
}

export interface WaitingSnapshotEntry {
  vehicle: string
  mode: 'F' | 'T'
  amount: number
}

export interface RowSnapshot {
  rowIndex: number
  time: Date
  piles: PileSnapshot[]
  waiting: WaitingSnapshotEntry[]
}

export interface ExpectedCell {
  rowIndex: number
  col: number
  expected: string
  actual: string | null
  pass: boolean | null
  diff: string | null
}

export interface AcceptanceReportRow {
  rowIndex: number
  time: string
  event: string
  actionLabel: string
  apiCalled: string
  apiStatus: 'OK' | 'ERROR' | 'SKIPPED'
  apiMessage: string
  pilesActual: string
  waitingActual: string
  expectedSamples: ExpectedCell[]
}

export interface AcceptanceReport {
  startedAt: string
  finishedAt: string
  totalEvents: number
  executedEvents: number
  skippedEvents: number
  erroredEvents: number
  rows: AcceptanceReportRow[]
  summary: {
    expectedCells: number
    passedCells: number
    failedCells: number
    passRate: string
  }
}

export const WAITING_COLUMN = 8
export const TIME_COLUMN = 1
export const EVENT_COLUMN = 2

export const FAST_COLUMNS = [3, 4]
export const SLOW_COLUMNS = [5, 6, 7]

export interface PileMapping {
  colToPileId: Map<number, string>
  tagToPileId: Map<string, string>
  pileIdToCol: Map<string, number>
}

export function buildPileMapping(
  actualPiles: Array<{ id: string; pileType: 'FAST' | 'SLOW' }>
): PileMapping {
  const fast = actualPiles
    .filter((p) => p.pileType === 'FAST')
    .sort((a, b) => a.id.localeCompare(b.id))
  const slow = actualPiles
    .filter((p) => p.pileType === 'SLOW')
    .sort((a, b) => a.id.localeCompare(b.id))

  const colToPileId = new Map<number, string>()
  const tagToPileId = new Map<string, string>()
  const pileIdToCol = new Map<string, number>()

  fast.forEach((pile, index) => {
    if (index >= FAST_COLUMNS.length) return
    colToPileId.set(FAST_COLUMNS[index], pile.id)
    pileIdToCol.set(pile.id, FAST_COLUMNS[index])
    tagToPileId.set(`F${index + 1}`, pile.id)
  })
  slow.forEach((pile, index) => {
    if (index >= SLOW_COLUMNS.length) return
    colToPileId.set(SLOW_COLUMNS[index], pile.id)
    pileIdToCol.set(pile.id, SLOW_COLUMNS[index])
    tagToPileId.set(`T${index + 1}`, pile.id)
  })

  return { colToPileId, tagToPileId, pileIdToCol }
}
