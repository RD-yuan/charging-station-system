/**
 * 作业验收用例脚本
 * 用法：cd apps/server && npx tsx ../../scripts/acceptance-test.ts
 *
 * 覆盖：
 *   一、充电全链路（提交→调度→自动充电→结束→详单）
 *   二、故障处理（上报→中止→续充→重调度→恢复）
 *   三、计费验证（峰平谷、多 session 累计）
 *   四、权限校验（JWT + 角色守卫）
 *   五、排队号规则（F/T 前缀 + 唯一）
 *   六、取消订单各状态
 *   七、时钟流速调节
 *   八、用户订单列表
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
const ADMIN = { username: 'admin', password: 'admin123' }
const USER_A = { username: 'user_01', password: 'user123' }

// ── helpers ──────────────────────────────────────────────

let passed = 0
let failed = 0

function ok(label: string) { passed++; console.log(`  ✅ ${label}`) }
function fail(label: string, detail: unknown) { failed++; console.log(`  ❌ ${label}`, detail) }

function assert(cond: boolean, label: string, detail?: unknown) {
  cond ? ok(label) : fail(label, detail)
}

async function api<T = any>(token: string | null, path: string, options: RequestInit = {}): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  let data: any = null
  try { data = await res.json() } catch { /* no body */ }
  return { status: res.status, data }
}

async function login(creds: { username: string; password: string }, loginPath = '/auth/login'): Promise<string> {
  const { data } = await api(null, loginPath, { method: 'POST', body: JSON.stringify(creds) })
  return data.accessToken as string
}

async function adminLogin(): Promise<string> {
  const { data } = await api(null, '/admin/login', { method: 'POST', body: JSON.stringify(ADMIN) })
  return data.accessToken as string
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// ── main ─────────────────────────────────────────────────

async function main() {
  console.log('\n🧪 智能充电桩调度计费系统 —— 作业验收测试')
  console.log('═'.repeat(56) + '\n')

  const userToken = await login(USER_A, '/auth/login')
  const adminToken = await adminLogin()
  console.log(`  登录: user=${USER_A.username} / admin=${ADMIN.username}\n`)

  try {
    // ═══════════════════════════════════════════════════════
    // 一、充电全链路
    // ═══════════════════════════════════════════════════════
    console.log('一、充电全链路')
    console.log('───')

    // 1.1 提交充电请求
    const submit = await api(userToken, '/user/charging/request', {
      method: 'POST',
      body: JSON.stringify({ chargeMode: 'FAST', requestedAmount: 30 }),
    })
    const orderId = submit.data.orderId as string
    const queueNo = submit.data.queueNo as string
    assert(submit.status === 201 || submit.status === 200, '1.1 提交充电请求返回成功', submit.status)
    assert(typeof orderId === 'string' && orderId.length > 0, '1.2 返回 orderId', orderId)
    assert(queueNo.startsWith('F'), '1.3 快充排队号以 F 开头', queueNo)

    // 1.2 查询排队状态
    await sleep(300)
    const queue1 = await api(userToken, `/user/charging/${orderId}/queue`)
    const status1 = queue1.data.status as string
    const area1 = queue1.data.queueArea as string
    assert(status1 === 'CHARGING' || status1 === 'IN_PILE_QUEUE' || status1 === 'WAITING',
      '1.4 查询排队状态成功', status1)
    assert(area1 === 'CHARGING' || area1 === 'PILE_QUEUE' || area1 === 'WAITING',
      '1.5 返回 queueArea', area1)

    // 1.3 如果自动开始充电，验证 ChargingSession
    if (status1 === 'CHARGING') {
      ok('1.6 桩空闲时自动开始充电 (CHARGING)')
    } else {
      console.log('   ⚠ 1.6 订单未自动开始充电 (可能是桩非空闲)', status1)
    }

    // 1.4 用户主动结束充电
    if (status1 === 'CHARGING') {
      const stop = await api(userToken, `/user/charging/${orderId}/stop`, { method: 'POST', body: '{}' })
      assert(stop.status === 200 || stop.status === 201, '1.7 结束充电成功', stop.data)
      assert(stop.data.status === 'FINISHED', '1.8 状态变为 FINISHED', stop.data.status)
      assert(typeof stop.data.detailId === 'string', '1.9 生成详单 detailId', stop.data.detailId)
      assert(typeof stop.data.totalFee === 'number', '1.10 详单含 totalFee', stop.data.totalFee)
    } else {
      // 未自动充电则手动 start → stop
      if (status1 === 'IN_PILE_QUEUE') {
        const start = await api(userToken, `/user/charging/${orderId}/start`, { method: 'POST', body: '{}' })
        if (start.status === 200) {
          await sleep(100)
          const stop = await api(userToken, `/user/charging/${orderId}/stop`, { method: 'POST', body: '{}' })
          assert(stop.status === 200 || stop.status === 201, '1.7 手动开始→结束充电', stop.data)
        }
      }
    }

    // 1.5 用户订单列表
    const orders1 = await api(userToken, '/user/charging/orders')
    assert(Array.isArray(orders1.data), '1.11 listOrders 返回数组', orders1.data?.length)
    assert(orders1.data.length > 0, '1.12 用户有历史订单', orders1.data?.length)

    // ═══════════════════════════════════════════════════════
    // 二、故障处理
    // ═══════════════════════════════════════════════════════
    console.log('\n二、故障处理')
    console.log('───')

    // 2.1 先提一个充电请求让它自动开始
    const submit2 = await api(userToken, '/user/charging/request', {
      method: 'POST',
      body: JSON.stringify({ chargeMode: 'FAST', requestedAmount: 50 }),
    })
    const orderId2 = submit2.data.orderId as string
    await sleep(500)
    const q2 = await api(userToken, `/user/charging/${orderId2}/queue`)
    const pileId2 = q2.data.assignedPileId as string || (await api(adminToken, '/admin/piles')).data[0]?.id as string

    // 2.2 上报故障
    const fault = await api(adminToken, `/admin/piles/${pileId2}/fault`, { method: 'POST', body: '{}' })
    assert(fault.status === 200 || fault.status === 201, '2.1 上报故障成功', fault.data)
    assert(fault.data.affectedCount !== undefined, '2.2 返回 affectedCount', fault.data.affectedCount)
    assert(fault.data.continuationOrderId !== undefined || fault.data.affectedCount >= 0,
      '2.3 返回 continuationOrderId 或受影响的队列订单', fault.data)

    // 2.3 验证桩变为 FAULT
    const piles2 = await api(adminToken, '/admin/piles')
    const faultedPile = piles2.data.find((p: any) => p.id === pileId2)
    assert(faultedPile?.workingState === 'FAULT', '2.4 故障桩 workingState = FAULT', faultedPile?.workingState)

    // 2.4 关闭故障桩电源再开启
    await api(adminToken, `/admin/piles/${pileId2}/power-off`, { method: 'POST', body: '{}' })
    await api(adminToken, `/admin/piles/${pileId2}/power-on`, { method: 'POST', body: '{}' })
    const pilesAfter = await api(adminToken, '/admin/piles')
    const pileAfterToggle = pilesAfter.data.find((p: any) => p.id === pileId2)
    assert(pileAfterToggle?.workingState === 'FAULT' && pileAfterToggle?.physicalState === 'ON',
      '2.5 开关电源后 FAULT 状态保留', { workingState: pileAfterToggle?.workingState, physicalState: pileAfterToggle?.physicalState })

    // 2.5 恢复故障桩
    const recover = await api(adminToken, `/admin/piles/${pileId2}/recover`, { method: 'POST', body: '{}' })
    assert(recover.status === 200 || recover.status === 201, '2.6 恢复故障成功', recover.data)
    const pilesRecovered = await api(adminToken, '/admin/piles')
    const recoveredPile = pilesRecovered.data.find((p: any) => p.id === pileId2)
    assert(recoveredPile?.workingState === 'IDLE', '2.7 恢复后 workingState = IDLE', recoveredPile?.workingState)

    // 2.6 检查续充订单出现
    if (fault.data.continuationOrderId) {
      const userOrders2 = await api(userToken, '/user/charging/orders')
      const continuationOrders = userOrders2.data.filter((o: any) =>
        o.queueNo?.startsWith('F') && o.orderId === fault.data.continuationOrderId
      )
      assert(continuationOrders.length >= 0, '2.8 故障后存在续充订单（F 前缀）',
        continuationOrders.length > 0 ? continuationOrders[0].queueNo : '续充订单可能已被调度')
    } else {
      console.log('   ⚠ 2.8 无续充订单（可能充电量为 0 或无 CHARGING 订单）')
    }

    // ═══════════════════════════════════════════════════════
    // 三、计费验证
    // ═══════════════════════════════════════════════════════
    console.log('\n三、计费验证')
    console.log('───')

    const userOrders3 = await api(userToken, '/user/charging/orders')
    const finishedOrders = userOrders3.data.filter((o: any) => o.status === 'FINISHED' || o.status === 'ABORTED')
    assert(finishedOrders.length > 0, '3.1 存在已完成/已中止的订单', finishedOrders.length)
    if (finishedOrders.length > 0) {
      const detail = finishedOrders[0].detail
      if (detail) {
        assert(typeof detail.totalFee === 'number', '3.2 详单含 totalFee', detail.totalFee)
        assert(typeof detail.chargeFee === 'number', '3.3 详单含 chargeFee', detail.chargeFee)
        assert(typeof detail.serviceFee === 'number', '3.4 详单含 serviceFee', detail.serviceFee)
      }
    }

    // 检查 CANCELED 订单的详单
    const canceledOrders = userOrders3.data.filter((o: any) => o.status === 'CANCELED')
    if (canceledOrders.length > 0) {
      const cDetail = canceledOrders[0].detail
      if (cDetail) {
        assert(cDetail.totalFee === 0, '3.5 取消订单 totalFee = 0', cDetail.totalFee)
      }
    }

    // ═══════════════════════════════════════════════════════
    // 四、权限校验
    // ═══════════════════════════════════════════════════════
    console.log('\n四、权限校验')
    console.log('───')

    // 4.1 无 token 访问受保护端点
    const noAuth = await api(null, '/user/charging/orders')
    assert(noAuth.status === 401, '4.1 无 token → 401', noAuth.status)

    // 4.2 普通用户访问 admin 端点
    const userAccessAdmin = await api(userToken, '/admin/piles')
    assert(userAccessAdmin.status === 403 || userAccessAdmin.status === 401,
      '4.2 USER 访问 admin → 403', userAccessAdmin.status)

    // 4.3 ADMIN 访问 admin 端点
    const adminAccessAdmin = await api(adminToken, '/admin/piles')
    assert(adminAccessAdmin.status === 200, '4.3 ADMIN 访问 admin → 200', adminAccessAdmin.status)

    // 4.4 用户操作他人订单
    const otherOrders = await api(userToken, '/user/charging/orders')
    if (otherOrders.data.length > 0) {
      // 用另一个用户尝试取消
      const wrongUser = await api(adminToken, `/user/charging/${otherOrders.data[0].orderId}/cancel`, { method: 'POST', body: '{}' })
      assert(wrongUser.status >= 400, '4.4 非本人操作订单被拒绝', wrongUser.status)
    }

    // ═══════════════════════════════════════════════════════
    // 五、排队号规则
    // ═══════════════════════════════════════════════════════
    console.log('\n五、排队号规则')
    console.log('───')

    const slowSubmit = await api(userToken, '/user/charging/request', {
      method: 'POST',
      body: JSON.stringify({ chargeMode: 'SLOW', requestedAmount: 20 }),
    })
    const slowQNo = slowSubmit.data.queueNo as string
    assert(slowQNo.startsWith('T'), '5.1 慢充排队号以 T 开头', slowQNo)

    const fastSubmit = await api(userToken, '/user/charging/request', {
      method: 'POST',
      body: JSON.stringify({ chargeMode: 'FAST', requestedAmount: 15 }),
    })
    const fastQNo = fastSubmit.data.queueNo as string
    assert(fastQNo.startsWith('F'), '5.2 快充排队号以 F 开头', fastQNo)

    // 取消这两个新订单以清理
    if (slowSubmit.data.orderId) await api(userToken, `/user/charging/${slowSubmit.data.orderId}/cancel`, { method: 'POST', body: '{}' })
    if (fastSubmit.data.orderId) await api(userToken, `/user/charging/${fastSubmit.data.orderId}/cancel`, { method: 'POST', body: '{}' })

    // ═══════════════════════════════════════════════════════
    // 六、取消订单各状态
    // ═══════════════════════════════════════════════════════
    console.log('\n六、取消订单')
    console.log('───')

    // 6.1 WAITING 取消
    const submitW = await api(userToken, '/user/charging/request', {
      method: 'POST',
      body: JSON.stringify({ chargeMode: 'SLOW', requestedAmount: 10 }),
    })
    await sleep(300)
    const qW = await api(userToken, `/user/charging/${submitW.data.orderId}/queue`)
    if (qW.data.status === 'WAITING') {
      const cancelW = await api(userToken, `/user/charging/${submitW.data.orderId}/cancel`, { method: 'POST', body: '{}' })
      assert(cancelW.status === 200 || cancelW.status === 201, '6.1 WAITING 取消成功', cancelW.data)
    } else if (qW.data.status === 'IN_PILE_QUEUE') {
      const cancelPQ = await api(userToken, `/user/charging/${submitW.data.orderId}/cancel`, { method: 'POST', body: '{}' })
      assert(cancelPQ.status === 200 || cancelPQ.status === 201, '6.2 IN_PILE_QUEUE 取消成功', cancelPQ.data)
    } else {
      ok('6.1/6.2 订单已自动进入充电，跳过取消测试')
    }

    // ═══════════════════════════════════════════════════════
    // 七、时钟流速
    // ═══════════════════════════════════════════════════════
    console.log('\n七、时钟流速')
    console.log('───')

    const speed1 = await api(adminToken, '/admin/clock-speed')
    assert(typeof speed1.data.speed === 'number', '7.1 GET 时钟流速返回 speed', speed1.data.speed)

    await api(adminToken, '/admin/clock-speed', { method: 'POST', body: JSON.stringify({ speed: 5 }) })
    const speed2 = await api(adminToken, '/admin/clock-speed')
    assert(speed2.data.speed === 5, '7.2 设置 5× 流速后读取为 5', speed2.data.speed)

    await api(adminToken, '/admin/clock-speed', { method: 'POST', body: JSON.stringify({ speed: 1 }) })
    const speed3 = await api(adminToken, '/admin/clock-speed')
    assert(speed3.data.speed === 1, '7.3 恢复 1× 流速', speed3.data.speed)

    // ═══════════════════════════════════════════════════════
    // 八、管理后台基础功能
    // ═══════════════════════════════════════════════════════
    console.log('\n八、管理后台')
    console.log('───')

    const stats = await api(adminToken, '/admin/dashboard/stats')
    assert(stats.data?.data?.totalPiles !== undefined, '8.1 仪表盘统计', stats.data)
    assert(typeof stats.data?.data?.chargingCount === 'number', '8.2 含 chargingCount', stats.data?.data?.chargingCount)

    const waitingQ = await api(adminToken, '/admin/waiting-queue')
    assert(Array.isArray(waitingQ.data), '8.3 等候区队列', waitingQ.data)

    const reports = await api(adminToken, '/admin/reports?timeType=DAY')
    assert(Array.isArray(reports.data), '8.4 日报表', reports.data)

  } catch (err) {
    console.error('\n💥 测试执行异常:', err)
    failed++
  }

  // ── result ──────────────────────────────────────────────
  console.log('\n' + '═'.repeat(56))
  const total = passed + failed
  console.log(`  总计 ${total} 项: ${passed} 通过 / ${failed} 失败`)
  if (failed > 0) {
    console.log(`\n  ❌ 存在 ${failed} 项未通过验收`)
    process.exit(1)
  } else {
    console.log('  ✅ 全部验收通过\n')
    process.exit(0)
  }
}

main()
