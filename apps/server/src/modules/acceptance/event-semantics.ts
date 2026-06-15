import { AcceptanceEvent, EventTuple, PileMapping } from './excel-schema'

export const VEHICLE_USERNAME_PREFIX = 'accept_v_'
export const VEHICLE_PASSWORD = 'accept123'

export function vehicleUsername(id: string): string {
  return `${VEHICLE_USERNAME_PREFIX}${id.toLowerCase()}`
}

/**
 * 把事件元组里的 F1/T1 这种"逻辑编号"翻译成 DB 里真实的桩 ID。
 * Excel 里写 F1 表示"1 号快充桩"，但 DB 里可能是 F1 / F01 / pile-fast-1 等。
 * 通过 PileMapping 在 run 起始时建立好的映射查找。
 */
export function resolvePileId(tag: string, mapping: PileMapping): string | null {
  const match = /^([FT])(\d+)$/.exec(tag.toUpperCase())
  if (!match) return null
  const logicalTag = `${match[1]}${match[2]}`
  return mapping.tagToPileId.get(logicalTag) ?? null
}

export function chargeModeFromFlag(flag: string): 'FAST' | 'SLOW' | null {
  if (flag === 'F') return 'FAST'
  if (flag === 'T') return 'SLOW'
  return null
}

export function actionLabel(ev: EventTuple, mapping?: PileMapping): string {
  if (ev.action === 'A') {
    if (ev.value === '0') return `取消订单 ${ev.target}`
    const modeText = ev.flag === 'F' ? '快充' : ev.flag === 'T' ? '慢充' : '未知模式'
    return `到达 ${ev.target} ${modeText} ${ev.value}度`
  }
  if (ev.action === 'B') {
    const pile = (mapping ? resolvePileId(ev.target, mapping) : null) ?? ev.target
    return ev.value === '0' ? `桩故障 ${pile}` : `桩恢复 ${pile}`
  }
  if (ev.action === 'C') {
    const amountText = ev.value === '-1' ? '电量不变' : `${ev.value}度`
    let modeText = '类型不变'
    if (ev.flag === 'F') modeText = '改快充'
    else if (ev.flag === 'T') modeText = '改慢充'
    return `变更请求 ${ev.target} ${modeText} ${amountText}`
  }
  return `未知事件 ${ev.action}`
}
