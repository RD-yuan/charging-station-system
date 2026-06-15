import ExcelJS from 'exceljs'
import {
  AcceptanceEvent,
  AcceptanceReport,
  AcceptanceReportRow,
  EventTuple,
  ExpectedCell,
  FAST_COLUMNS,
  PileMapping,
  RowSnapshot,
  SLOW_COLUMNS,
  TIME_COLUMN,
  EVENT_COLUMN,
  WAITING_COLUMN
} from './excel-schema'

const BASE_DATE = new Date('2026-06-15T00:00:00Z')

function parseTimeOnBase(raw: string): Date | null {
  if (!raw) return null
  const trimmed = String(raw).trim()
  // 宽松匹配：在字符串任意位置找 HH:MM(:SS)?
  const match = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(trimmed)
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  const s = match[3] ? Number(match[3]) : 0
  if (h > 23 || m > 59 || s > 59) return null
  let hour = h
  if (/pm/i.test(trimmed) && h < 12) hour = h + 12
  if (/am/i.test(trimmed) && h === 12) hour = 0
  const d = new Date(BASE_DATE.getTime())
  d.setUTCHours(0, 0, 0, 0)
  d.setHours(hour, m, s, 0)
  return d
}

/**
 * 从 ExcelJS 单元格直接拿时间。
 * ExcelJS 把时间单元格返回成 Date 对象（1899-12-30 epoch），其内部 UTC 值就是原始时间。
 * 例：单元格里写 "06:00:00"，ExcelJS 返回 Date，其 UTC = 1899-12-30 06:00:00。
 * 我们取出 UTC 时分秒，作为 BASE_DATE 上的本地时间。
 */
function extractCellTime(cell: ExcelJS.Cell): Date | null {
  const value = cell.value

  if (value instanceof Date) {
    const h = value.getUTCHours()
    const m = value.getUTCMinutes()
    const s = value.getUTCSeconds()
    const d = new Date(BASE_DATE.getTime())
    d.setUTCHours(0, 0, 0, 0)
    d.setHours(h, m, s, 0)
    return d
  }

  if (typeof value === 'number') {
    // ExcelJS 偶尔返回时间小数（0.25 = 6 AM），转成秒
    const totalSec = Math.round(value * 86400)
    const h = Math.floor(totalSec / 3600) % 24
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    const d = new Date(BASE_DATE.getTime())
    d.setUTCHours(0, 0, 0, 0)
    d.setHours(h, m, s, 0)
    return d
  }

  // 字符串兜底
  return parseTimeOnBase(safeCellText(cell))
}

function parseEventTuple(raw: string): EventTuple | null {
  const trimmed = raw.trim()
  const match = /^\(\s*([A-Za-z]+)\s*,\s*([A-Za-z0-9_]+)\s*,\s*([A-Za-z]+)\s*,\s*([0-9.]+)\s*\)$/.exec(trimmed)
  if (!match) return null
  return {
    action: match[1].toUpperCase(),
    target: match[2].toUpperCase(),
    flag: match[3].toUpperCase(),
    value: match[4]
  }
}

function safeCellText(cell: ExcelJS.Cell): string {
  try {
    const text = cell.text
    if (text != null) return String(text).trim()
  } catch {
    // fall through to value-based extraction
  }
  const value = cell.value
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray((value as any).richText)) {
      return (value as any).richText.map((r: any) => r.text ?? '').join('').trim()
    }
    if ('result' in value) {
      const result = (value as any).result
      return result == null ? '' : String(result).trim()
    }
    if ('text' in value && (value as any).text != null) return String((value as any).text).trim()
  }
  return ''
}

export async function parseAcceptanceEvents(buffer: Buffer): Promise<{
  events: AcceptanceEvent[]
  workbook: ExcelJS.Workbook
  sheet: ExcelJS.Worksheet
}> {
  const workbook = new ExcelJS.Workbook()
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
  await workbook.xlsx.load(arrayBuffer as unknown as ExcelJS.Buffer)

  const sheets = workbook.worksheets
  const sheet =
    sheets.find((w) => w.name === '测试用例') ??
    sheets.find((w) => w.name.includes('测试用例')) ??
    sheets.find((w) => w.name !== '测试说明' && /测试/.test(w.name)) ??
    sheets[1] ??
    sheets[0]
  if (!sheet) throw new Error('测试用例 Excel 中找不到「测试用例」sheet。')

  const events: AcceptanceEvent[] = []
  let lastKey = ''
  sheet.eachRow((row, rowIndex) => {
    if (rowIndex < 3) return
    const timeCell = safeCellText(row.getCell(TIME_COLUMN))
    const eventCell = safeCellText(row.getCell(EVENT_COLUMN))
    if (!timeCell || !eventCell) return
    if (eventCell.includes('注') || eventCell === '调度结束') return
    // 跳过合并单元格的从属行
    const key = `${timeCell}|${eventCell}`
    if (key === lastKey) return
    lastKey = key
    // 关键：直接从 cell.value 取 Date，避免 toString 后再解析时丢精度/被时区干扰
    const time = extractCellTime(row.getCell(TIME_COLUMN)) ?? parseTimeOnBase(timeCell) ?? new Date(BASE_DATE)
    const parsed = parseEventTuple(eventCell)
    events.push({ rowIndex, rawTime: timeCell, time, raw: eventCell, parsed })
  })
  return { events, workbook, sheet }
}

export async function writeSnapshotsToSheet(
  sheet: ExcelJS.Worksheet,
  snapshots: RowSnapshot[],
  mapping: PileMapping
) {
  for (const snap of snapshots) {
    for (const pile of snap.piles) {
      const col = mapping.pileIdToCol.get(pile.pileId)
      if (col == null) continue
      // 一个事件占 3 行：event_row, event_row+1, event_row+2
      // 分别对应 CHARGING_QUEUE_LEN=3 的 3 个席位
      for (let slotIdx = 0; slotIdx < 3; slotIdx++) {
        const targetRowNum = snap.rowIndex + slotIdx
        const slot = pile.slots[slotIdx]
        const cell = sheet.getRow(targetRowNum).getCell(col)
        cell.value = slot && slot.vehicle
          ? `(${slot.vehicle},${slot.deliveredEnergy.toFixed(2)},${slot.currentFee.toFixed(2)})`
          : '-'
        sheet.getRow(targetRowNum).commit()
      }
    }
    // 等候区只在 event row 显示
    const waitingCell = sheet.getRow(snap.rowIndex).getCell(WAITING_COLUMN)
    if (snap.waiting.length === 0) {
      waitingCell.value = ''
    } else {
      waitingCell.value = snap.waiting
        .map((w) => `(${w.vehicle},${w.mode},${w.amount.toFixed(2)})`)
        .join('-')
    }
    sheet.getRow(snap.rowIndex).commit()
  }
}

export async function snapshotWorkbookToBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer as ArrayBuffer)
}

export function writeExecutionLogSheet(workbook: ExcelJS.Workbook, rows: Array<{
  rowIndex: number
  time: string
  event: string
  actionLabel: string
  apiCalled: string
  apiStatus: string
  apiMessage: string
  pilesActual: string
  waitingActual: string
}>): ExcelJS.Worksheet {
  const name = '执行日志'
  const existing = workbook.getWorksheet(name)
  if (existing) workbook.removeWorksheet(existing.id)

  const sheet = workbook.addWorksheet(name)
  sheet.columns = [
    { header: 'Excel 行', key: 'rowIndex', width: 8 },
    { header: '时刻', key: 'time', width: 12 },
    { header: '事件', key: 'event', width: 22 },
    { header: '动作', key: 'actionLabel', width: 28 },
    { header: '状态', key: 'apiStatus', width: 8 },
    { header: 'API 调用', key: 'apiCalled', width: 60 },
    { header: '消息', key: 'apiMessage', width: 60 },
    { header: '实际桩位', key: 'pilesActual', width: 60 },
    { header: '实际等候区', key: 'waitingActual', width: 50 }
  ]
  for (const r of rows) {
    sheet.addRow(r)
  }
  sheet.getRow(1).font = { bold: true }
  return sheet
}

export function collectExpectedSamples(
  sheet: ExcelJS.Worksheet,
  mapping: PileMapping
): Map<number, ExpectedCell[]> {
  const byRow = new Map<number, ExpectedCell[]>()
  const allCols = [...FAST_COLUMNS, ...SLOW_COLUMNS]
  sheet.eachRow((row, rowIndex) => {
    if (rowIndex < 3) return
    const list: ExpectedCell[] = []
    for (const col of allCols) {
      if (!mapping.colToPileId.has(col)) continue
      const v = safeCellText(row.getCell(col))
      if (v && v !== '-' && /^\(.*\)$/.test(v)) {
        list.push({ rowIndex, col, expected: v, actual: null, pass: null, diff: null })
      }
    }
    const w = safeCellText(row.getCell(WAITING_COLUMN))
    if (w && /^\(.*\)$/.test(w)) {
      list.push({ rowIndex, col: WAITING_COLUMN, expected: w, actual: null, pass: null, diff: null })
    }
    if (list.length > 0) byRow.set(rowIndex, list)
  })
  return byRow
}

/**
 * 找到给定 Excel 行所属事件的快照（每个事件占 3 行，snap.rowIndex 是事件行）。
 */
function findSnapshotForRow(rowIndex: number, actual: Map<number, RowSnapshot>): RowSnapshot | null {
  // 事件行号是 3, 6, 9, ... 也就是 3 的倍数。给定任意行，事件行 = (rowIndex / 3) * 3（向下取整到 3 的倍数）
  const eventRow = Math.max(3, Math.floor(rowIndex / 3) * 3)
  return actual.get(eventRow) ?? null
}

export function compareExpectedVsActual(
  expected: Map<number, ExpectedCell[]>,
  actual: Map<number, RowSnapshot>,
  reportRows: AcceptanceReportRow[],
  mapping: PileMapping
): AcceptanceReport {
  let passedCells = 0
  let failedCells = 0

  for (const [rowIndex, cells] of expected) {
    const snap = findSnapshotForRow(rowIndex, actual)
    for (const cell of cells) {
      if (!snap) {
        cell.actual = null
        cell.pass = false
        cell.diff = '无对应实际快照'
        failedCells++
        continue
      }
      const actualStr = formatActualForCell(cell.col, cell.rowIndex, snap, mapping)
      cell.actual = actualStr
      cell.pass = actualStr === cell.expected
      if (cell.pass) {
        passedCells++
      } else {
        failedCells++
        cell.diff = explainDiff(cell.expected, actualStr, cell.col)
      }
    }
    // 把样本关联到所属事件行的报告行
    const eventRow = Math.max(3, Math.floor(rowIndex / 3) * 3)
    const reportRow = reportRows.find((r) => r.rowIndex === eventRow)
    if (reportRow) reportRow.expectedSamples.push(...cells)
  }

  const totalCells = passedCells + failedCells
  return {
    startedAt: '',
    finishedAt: '',
    totalEvents: reportRows.length,
    executedEvents: reportRows.filter((r) => r.apiStatus === 'OK').length,
    skippedEvents: reportRows.filter((r) => r.apiStatus === 'SKIPPED').length,
    erroredEvents: reportRows.filter((r) => r.apiStatus === 'ERROR').length,
    rows: reportRows,
    summary: {
      expectedCells: totalCells,
      passedCells,
      failedCells,
      passRate: totalCells === 0 ? 'n/a' : `${((passedCells / totalCells) * 100).toFixed(1)}%`
    }
  }
}

function formatActualForCell(col: number, rowIndex: number, snap: RowSnapshot, mapping: PileMapping): string {
  if (col === WAITING_COLUMN) {
    if (snap.waiting.length === 0) return ''
    return snap.waiting.map((w) => `(${w.vehicle},${w.mode},${w.amount.toFixed(2)})`).join('-')
  }
  const pileId = mapping.colToPileId.get(col)
  if (!pileId) return ''
  const pile = snap.piles.find((p) => p.pileId === pileId)
  if (!pile) return '-'
  // 期望样本所在的 Excel 行决定 slot index：事件行=slot 0, +1=slot 1, +2=slot 2
  const slotIdx = rowIndex - snap.rowIndex
  const slot = pile.slots[slotIdx]
  if (!slot || !slot.vehicle) return '-'
  return `(${slot.vehicle},${slot.deliveredEnergy.toFixed(2)},${slot.currentFee.toFixed(2)})`
}

function explainDiff(expected: string, actual: string | null, col: number): string {
  if (!actual) return '实际无值'
  if (col === WAITING_COLUMN) {
    return `等候区不匹配：预期=${expected}；实际=${actual}`
  }
  const exp = parseTupleValues(expected)
  const act = parseTupleValues(actual)
  if (!exp || !act) return `预期=${expected}；实际=${actual}`
  const diffs: string[] = []
  if (exp[0] !== act[0]) diffs.push(`车号 预期${exp[0]} 实际${act[0]}`)
  const expEnergy = Number(exp[1])
  const actEnergy = Number(act[1])
  if (Math.abs(expEnergy - actEnergy) > 0.05) {
    diffs.push(`电量 预期${expEnergy.toFixed(2)} 实际${actEnergy.toFixed(2)} (Δ${(actEnergy - expEnergy).toFixed(2)})`)
  }
  const expFee = Number(exp[2])
  const actFee = Number(act[2])
  if (Math.abs(expFee - actFee) > 0.05) {
    diffs.push(`费用 预期${expFee.toFixed(2)} 实际${actFee.toFixed(2)} (Δ${(actFee - expFee).toFixed(2)})`)
  }
  return diffs.length > 0 ? diffs.join('；') : `预期=${expected}；实际=${actual}`
}

function parseTupleValues(raw: string): [string, string, string] | null {
  const match = /\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,)]+)\s*\)/.exec(raw)
  if (!match) return null
  return [match[1].trim(), match[2].trim(), match[3].trim()]
}
