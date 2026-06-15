/**
 * 42 条验收测试用例 —— 全自动脚本
 *
 * 用法: cd apps/server && npx tsx ../../scripts/acceptance-42.ts
 *
 * 时间比例 1:10，每个事件间隔 5 虚拟分钟（= 30 真实秒 @ 10× 时钟）
 * 快速模式: --fast 参数下间隔 1 秒（适合快速验证）
 */

import { config } from 'dotenv'
import { existsSync } from 'fs'
import { resolve } from 'path'

for (const envPath of [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../.env'),
  resolve(__dirname, '../apps/server/.env'),
  resolve(__dirname, '../.env'),
]) {
  if (existsSync(envPath)) config({ path: envPath, override: false })
}

const BASE = process.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api'
const FAST_MODE = process.argv.includes('--fast')
const EVENT_INTERVAL_MS = FAST_MODE ? 1000 : 30_000
const CLOCK_SPEED = 10 // 1:10 比例尺

// ── 42 条事件定义 ──────────────────────────────────────────

interface TestEvent {
  vmTime: string   // 虚拟时刻 "6:00"
  action: 'apply' | 'fault' | 'recover' | 'cancel' | 'modify'
  car?: string     // 车辆编号 V1, V2 ...
  mode?: 'FAST' | 'SLOW'
  amount?: number
  pileId?: string  // 故障/恢复的目标桩
}

const EVENTS: TestEvent[] = [
  { vmTime: '6:00', action: 'apply', car: 'V1', mode: 'SLOW', amount: 40 },
  { vmTime: '6:05', action: 'apply', car: 'V2', mode: 'SLOW', amount: 30 },
  { vmTime: '6:10', action: 'apply', car: 'V3', mode: 'FAST', amount: 100 },
  { vmTime: '6:15', action: 'apply', car: 'V4', mode: 'FAST', amount: 120 },
  { vmTime: '6:20', action: 'cancel', car: 'V2' },                    // V2 取消 (WAITING状态)
  { vmTime: '6:25', action: 'apply', car: 'V5', mode: 'SLOW', amount: 20 },
  { vmTime: '6:30', action: 'apply', car: 'V6', mode: 'SLOW', amount: 20 },
  { vmTime: '6:35', action: 'apply', car: 'V7', mode: 'FAST', amount: 110 },
  { vmTime: '6:40', action: 'apply', car: 'V8', mode: 'SLOW', amount: 20 },
  { vmTime: '6:45', action: 'apply', car: 'V9', mode: 'FAST', amount: 105 },
  { vmTime: '6:50', action: 'apply', car: 'V10', mode: 'SLOW', amount: 10 },
  { vmTime: '6:55', action: 'apply', car: 'V11', mode: 'FAST', amount: 110 },
  { vmTime: '7:00', action: 'apply', car: 'V12', mode: 'FAST', amount: 90 },
  { vmTime: '7:05', action: 'apply', car: 'V13', mode: 'FAST', amount: 110 },
  { vmTime: '7:10', action: 'apply', car: 'V14', mode: 'FAST', amount: 95 },
  { vmTime: '7:15', action: 'apply', car: 'V15', mode: 'SLOW', amount: 10 },
  { vmTime: '7:20', action: 'apply', car: 'V16', mode: 'FAST', amount: 60 },
  { vmTime: '7:25', action: 'apply', car: 'V17', mode: 'SLOW', amount: 10 },
  { vmTime: '7:30', action: 'apply', car: 'V18', mode: 'SLOW', amount: 7.5 },
  { vmTime: '7:35', action: 'apply', car: 'V19', mode: 'FAST', amount: 75 },
  { vmTime: '7:40', action: 'apply', car: 'V20', mode: 'FAST', amount: 95 },
  { vmTime: '7:45', action: 'apply', car: 'V21', mode: 'FAST', amount: 95 },
  { vmTime: '7:50', action: 'apply', car: 'V22', mode: 'FAST', amount: 70 },
  { vmTime: '7:55', action: 'apply', car: 'V23', mode: 'FAST', amount: 80 },
  { vmTime: '8:00', action: 'apply', car: 'V24', mode: 'SLOW', amount: 5 },
  { vmTime: '8:15', action: 'apply', car: 'V25', mode: 'SLOW', amount: 15 },
  { vmTime: '8:20', action: 'fault', pileId: 'T01' },                 // 慢充1故障
  { vmTime: '8:25', action: 'apply', car: 'V26', mode: 'SLOW', amount: 20 },
  { vmTime: '8:30', action: 'apply', car: 'V27', mode: 'SLOW', amount: 25 },
  { vmTime: '8:45', action: 'fault', pileId: 'F01' },                 // 快充1故障
  { vmTime: '9:00', action: 'apply', car: 'V28', mode: 'FAST', amount: 30 },
  { vmTime: '9:10', action: 'cancel', car: 'V1' },                    // V1 结束充电
  { vmTime: '9:15', action: 'recover', pileId: 'T01' },               // 慢充1恢复
  { vmTime: '9:20', action: 'cancel', car: 'V27' },                   // V27 取消
  { vmTime: '9:25', action: 'modify', car: 'V21', amount: 35 },       // 修改 V21
  { vmTime: '9:30', action: 'cancel', car: 'V19' },                   // V19 取消
  { vmTime: '9:35', action: 'cancel', car: 'V28' },                   // V28 取消
  { vmTime: '9:40', action: 'modify', car: 'V23', amount: 40 },       // 修改 V23
  { vmTime: '9:55', action: 'apply', car: 'V29', mode: 'SLOW', amount: 30 },
  { vmTime: '10:05', action: 'modify', car: 'V14', amount: 30 },      // 修改 V14
  { vmTime: '10:10', action: 'apply', car: 'V30', mode: 'SLOW', amount: 10 },
  { vmTime: '10:50', action: 'recover', pileId: 'F01' },               // 快充1恢复
]

// ── 车辆 → 用户映射 ─────────────────────────────────────────

const CAR_USERS: Record<string, { username: string; password: string; token: string | null }> = {}

async function getCarToken(car: string): Promise<string> {
  if (CAR_USERS[car]?.token) return CAR_USERS[car].token!

  const username = `car_${car.toLowerCase()}`
  // 先尝试登录（重复执行时用户已存在）
  let loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'test123' }),
  })
  // 首次执行时用户不存在，先注册再登录
  if (loginRes.status === 401) {
    await fetch(`${BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'test123', batteryCapacity: 60 }),
    })
    loginRes = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'test123' }),
    })
  }
  const loginData = await loginRes.json() as any
  CAR_USERS[car] = { username, password: 'test123', token: loginData.accessToken ?? null }
  return CAR_USERS[car].token!
}

// ── API helpers ──────────────────────────────────────────────

async function api(token: string, path: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  })
  const data = await res.json().catch(() => null)
  return { status: res.status, data }
}

async function adminApi(path: string, options: RequestInit = {}) {
  const token = CAR_USERS['admin']?.token ?? ''
  return api(token, path, options)
}

// ── 事件执行 ─────────────────────────────────────────────────

interface CarOrder {
  car: string
  orderId: string
  queueNo: string
  mode: string
  amount: number
}

const carOrders = new Map<string, CarOrder>() // car → order info

async function executeEvent(ev: TestEvent, idx: number) {
  const label = `[${String(idx + 1).padStart(2, '0')}/42] ${ev.vmTime}`
  let result = ''

  try {
    switch (ev.action) {
      case 'apply': {
        const token = await getCarToken(ev.car!)
        const res = await api(token, '/user/charging/request', {
          method: 'POST',
          body: JSON.stringify({ chargeMode: ev.mode, requestedAmount: ev.amount }),
        })
        if (res.data?.orderId) {
          carOrders.set(ev.car!, { car: ev.car!, orderId: res.data.orderId, queueNo: res.data.queueNo, mode: ev.mode!, amount: ev.amount! })
          result = `✅ 申请 ${ev.car} ${ev.mode} ${ev.amount}kWh → ${res.data.queueNo}`
        } else {
          result = `❌ 申请失败: ${JSON.stringify(res.data)}`
        }
        break
      }
      case 'cancel': {
        const order = carOrders.get(ev.car!)
        if (!order) { result = `⚠ 未找到 ${ev.car} 的订单`; break }
        const token = await getCarToken(ev.car!)
        const res = await api(token, `/user/charging/${order.orderId}/cancel`, {
          method: 'POST',
          body: JSON.stringify({ reason: ev.car === 'V1' ? 'USER_STOP' : 'USER_CANCEL' }),
        })
        result = `✅ 取消 ${ev.car} (${order.queueNo}) → ${res.data?.status ?? res.status}`
        break
      }
      case 'fault': {
        const res = await adminApi(`/admin/piles/${ev.pileId}/fault`, { method: 'POST', body: '{}' })
        result = `✅ 故障 ${ev.pileId} → affected=${res.data?.affectedCount}, continuation=${res.data?.continuationOrderId ?? '无'}`
        break
      }
      case 'recover': {
        const res = await adminApi(`/admin/piles/${ev.pileId}/recover`, { method: 'POST', body: '{}' })
        result = `✅ 恢复 ${ev.pileId} → ${res.status}`
        break
      }
      case 'modify': {
        const order = carOrders.get(ev.car!)
        if (!order) { result = `⚠ 未找到 ${ev.car} 的订单`; break }
        const token = await getCarToken(ev.car!)
        const res = await api(token, `/user/charging/${order.orderId}/amount`, {
          method: 'PUT',
          body: JSON.stringify({ newAmount: ev.amount }),
        })
        result = `✅ 修改 ${ev.car} (${order.queueNo}) 电量 → ${ev.amount}kWh`
        break
      }
    }
  } catch (err: any) {
    result = `❌ 异常: ${err.message}`
  }

  console.log(`  ${label}  ${result}`)
}

// ── 状态查询 ─────────────────────────────────────────────────

async function printState(label: string) {
  const [pilesRes, waitingRes] = await Promise.all([
    adminApi('/admin/piles'),
    adminApi('/admin/waiting-queue'),
  ])

  console.log(`\n─── ${label} ───`)

  // 充电桩
  if (Array.isArray(pilesRes.data)) {
    for (const pile of pilesRes.data as any[]) {
      const queue = (pile.queue ?? []) as any[]
      const cars = queue.map((q: any) =>
        `${q.queueNo}(${q.status === 'CHARGING' ? '充' : '排'}${q.progress}%)`
      ).join(', ')
      console.log(`  ${pile.id} [${pile.workingState}] 队列(${queue.length}): ${cars || '空'}`)
    }
  }

  // 等候区
  if (Array.isArray(waitingRes.data)) {
    const waiting = waitingRes.data as any[]
    const cars = waiting.map((w: any) => `${w.queueNo}(${w.mode}${w.amount}kWh)`).join(', ')
    console.log(`  等候区(${waiting.length}): ${cars || '空'}`)
  }
}

// ── main ─────────────────────────────────────────────────────

async function main() {
  console.log('\n🧪 42 条验收测试用例 —— 全自动执行')
  console.log('═'.repeat(70))

  // 登录 admin
  const adminLoginRes = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  const adminData = await adminLoginRes.json() as any
  CAR_USERS['admin'] = { username: 'admin', password: 'admin123', token: adminData.accessToken ?? null }
  console.log(`  Admin 登录: ${adminData.accessToken ? '✅' : '❌'}`)

  // 清理上次运行残留的活跃订单
  const allUsers = new Set(EVENTS.filter(e => e.car).map(e => e.car!))
  let cleaned = 0
  for (const car of allUsers) {
    try {
      const token = await getCarToken(car)
      const ordersRes = await api(token, '/user/charging/orders')
      if (Array.isArray(ordersRes.data)) {
        for (const order of ordersRes.data as any[]) {
          if (['WAITING', 'IN_PILE_QUEUE', 'CHARGING'].includes(order.status)) {
            await api(token, `/user/charging/${order.orderId}/cancel`, {
              method: 'POST',
              body: JSON.stringify({ reason: 'TEST_CLEANUP' }),
            })
            cleaned++
          }
        }
      }
    } catch { /* skip */ }
  }
  console.log(`  清理残留订单: ${cleaned} 条`)

  // 设置时钟 10×
  await adminApi('/admin/clock-speed', { method: 'POST', body: JSON.stringify({ speed: CLOCK_SPEED }) })
  console.log(`  时钟流速: ${CLOCK_SPEED}× | 事件间隔: ${EVENT_INTERVAL_MS}ms${FAST_MODE ? ' (快速模式)' : ''}\n`)

  const startReal = Date.now()

  for (let i = 0; i < EVENTS.length; i++) {
    await executeEvent(EVENTS[i], i)

    // 每 10 个事件打印一次状态
    if ((i + 1) % 10 === 0 || i === EVENTS.length - 1) {
      await printState(`事件 ${i + 1}/42  @ ${EVENTS[i].vmTime}`)
    }

    // 等待间隔（真实时间，对应 5 虚拟分钟 @ 10×）
    if (i < EVENTS.length - 1) {
      await sleep(EVENT_INTERVAL_MS)
    }
  }

  const elapsedReal = (Date.now() - startReal) / 1000
  console.log(`\n═`.repeat(70))
  console.log(`  全部 42 条事件完成 | 真实耗时 ${elapsedReal.toFixed(1)}s | 虚拟跨度 6:00 → 10:50\n`)
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

main().catch(console.error)
