<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Sidebar from '../components/Sidebar.vue'
import DashboardView from './DashboardView.vue'
import MonitorView from './MonitorView.vue'
import ReportView from './ReportView.vue'
import WebSocketView from './WebSocketView.vue'
import AcceptanceView from './AcceptanceView.vue'
import { apiRequest, wsUrl } from '../api/http'

type ChargeMode = 'FAST' | 'SLOW'
type PhysicalState = 'ON' | 'OFF'
type WorkingState = 'IDLE' | 'CHARGING' | 'FAULT'
type SocketDirection = 'INCOMING' | 'OUTGOING' | 'SYSTEM'

interface QueueCar {
  id: string
  queueNo: string
  status: 'IN_PILE_QUEUE' | 'CHARGING' | 'ABORTED'
  progress: number
  deliveredEnergy: number
  interrupted: boolean
  userId: string
  amount: number
}

interface Pile {
  id: string
  type: ChargeMode
  power: number
  physicalState: PhysicalState
  workingState: WorkingState
  lastActive: string
  totalEnergy: number
  queue: QueueCar[]
  interruptedOrder: QueueCar | null
}

interface WaitingQueueItem {
  orderId: string
  userId: string
  mode: ChargeMode
  amount: number
  queueNo: string
  timestamp: string
}

interface BillingDetail {
  id: string
  pileId: string
  userId: string
  count: number
  energy: number
  duration: number
  feeCharge: number
  feeService: number
  feeTotal: number
  timestamp: string
}

interface SocketLog {
  id: string
  direction: SocketDirection
  message: string
  timestamp: string
}

const router = useRouter()
const adminName = ref<string | null>(null)
const currentTab = ref('dashboard')
const piles = ref<Pile[]>([])
const waitingQueue = ref<WaitingQueueItem[]>([])
const billingHistory = ref<BillingDetail[]>([])
const socketLogs = ref<SocketLog[]>([])
const reportTimeType = ref<'DAY' | 'WEEK' | 'MONTH'>('DAY')
const adminError = ref('')
let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let pileRefreshTimer: ReturnType<typeof setInterval> | null = null
let pileRefreshInFlight = false
let isUnmounted = false

onMounted(() => {
  document.title = '智能充电桩 - 调度与计费管理后台'
  adminName.value = localStorage.getItem('admin_name') ?? '超级管理员'
  void loadAdminData()
  connectSocket()
  pileRefreshTimer = setInterval(() => void refreshPilesQuietly(), 2000)
})

onUnmounted(() => {
  isUnmounted = true
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (pileRefreshTimer) clearInterval(pileRefreshTimer)
  socket?.close()
})

async function loadAdminData() {
  await runAdminOperation(async () => {
    await Promise.all([loadPiles(), loadWaitingQueue(), loadReports()])
  })
}

async function loadPiles() {
  const data = await apiRequest<Array<any>>('/admin/piles')
  piles.value = data.map((pile) => ({
    id: pile.id,
    type: pile.type,
    power: Number(pile.power ?? 0),
    physicalState: pile.physicalState,
    workingState: pile.workingState,
    lastActive: new Date().toLocaleTimeString(),
    totalEnergy: Number(pile.totalEnergy ?? pile.totalChargeAmount ?? 0),
    queue: (pile.queue ?? []).map(mapQueueCar),
    interruptedOrder: pile.interruptedOrder ? mapQueueCar(pile.interruptedOrder) : null
  }))
}

function mapQueueCar(car: any): QueueCar {
  return {
    id: car.id ?? car.orderId,
    queueNo: car.queueNo,
    status: car.status,
    progress: Number(car.progress ?? 0),
    deliveredEnergy: Number(car.deliveredEnergy ?? 0),
    interrupted: Boolean(car.interrupted),
    userId: car.username ?? car.userId,
    amount: Number(car.amount ?? car.requestedAmount ?? 0)
  }
}

async function refreshPilesQuietly() {
  if (pileRefreshInFlight || isUnmounted) return
  pileRefreshInFlight = true
  try {
    await loadPiles()
  } catch {
    // The visible operation error and WebSocket status already report connection failures.
  } finally {
    pileRefreshInFlight = false
  }
}

async function loadWaitingQueue() {
  const data = await apiRequest<Array<any>>('/admin/waiting-queue')
  waitingQueue.value = data.map((item) => ({
    orderId: item.orderId,
    userId: item.username ?? item.userId,
    mode: item.mode,
    amount: Number(item.amount ?? 0),
    queueNo: item.queueNo,
    timestamp: formatTime(item.timestamp)
  }))
}

async function loadReports() {
  const reports = await apiRequest<Array<any>>(`/admin/reports?timeType=${reportTimeType.value}`)
  billingHistory.value = reports.map((item) => ({
    id: `REPORT-${item.timeType}-${item.pileId}`,
    pileId: item.pileId,
    userId: '汇总',
    count: Number(item.totalChargeCount ?? 0),
    energy: Number(item.totalChargeAmount ?? 0),
    duration: Math.round(Number(item.totalChargeDuration ?? 0) * 60),
    feeCharge: Number(item.totalChargeFee ?? 0),
    feeService: Number(item.totalServiceFee ?? 0),
    feeTotal: Number(item.totalFee ?? 0),
    timestamp: item.timeType
  }))
}

async function handleReportTimeTypeChange(timeType: 'DAY' | 'WEEK' | 'MONTH') {
  reportTimeType.value = timeType
  await runAdminOperation(loadReports)
}

function connectSocket() {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return
  socket = new WebSocket(wsUrl())
  socket.onopen = () => addSocketLog('SYSTEM', `WebSocket 已连接：${wsUrl()}`)
  socket.onerror = () => addSocketLog('SYSTEM', 'WebSocket 连接异常，请检查 NestJS 服务。')
  socket.onclose = () => {
    socket = null
    if (isUnmounted) return
    addSocketLog('SYSTEM', 'WebSocket 已断开，2 秒后自动重连。')
    reconnectTimer = setTimeout(connectSocket, 2000)
  }
  socket.onmessage = (event) => {
    addSocketLog('INCOMING', event.data)
    try {
      const message = JSON.parse(event.data)
      if (message.event === 'waiting_queue_changed') {
        waitingQueue.value = (message.data ?? []).map((item: any) => ({
          orderId: item.orderId,
          userId: item.userAccount ?? item.userId,
          mode: item.type,
          amount: item.targetKwh,
          queueNo: item.queueNo ?? item.carId,
          timestamp: item.checkInTime
            ? formatTime(item.checkInTime)
            : '--'
        }))
      }
      if (['pile_metrics_update', 'dispatch_result', 'fault_event'].includes(message.event)) {
        void loadPiles()
        void loadWaitingQueue()
        void loadReports()
      }
    } catch {
      // Keep raw socket log visible even if a custom frame is not JSON.
    }
  }
}

async function handleTogglePower(pileId: string) {
  await runAdminOperation(async () => {
    const target = piles.value.find((p) => p.id === pileId)
    if (!target) return
    const endpoint = target.physicalState === 'ON' ? 'power-off' : 'power-on'
    await apiRequest(`/admin/piles/${pileId}/${endpoint}`, { method: 'POST', body: '{}' })
    addSocketLog('OUTGOING', `管理员切换充电桩电源：${pileId}`)
    await loadPiles()
  })
}

async function handleReportFault(pileId: string) {
  await runAdminOperation(async () => {
    await apiRequest(`/admin/piles/${pileId}/fault`, { method: 'POST', body: '{}' })
    addSocketLog('OUTGOING', `管理员上报硬件故障：${pileId}`)
    await loadPiles()
  })
}

async function handleRecoverPile(pileId: string) {
  await runAdminOperation(async () => {
    await apiRequest(`/admin/piles/${pileId}/recover`, { method: 'POST', body: '{}' })
    addSocketLog('OUTGOING', `管理员恢复故障充电桩：${pileId}`)
    await loadPiles()
  })
}

async function handleTriggerReschedule({ pileId, strategy }: { pileId: string; strategy: string }) {
  await runAdminOperation(async () => {
    await apiRequest(`/admin/piles/${pileId}/reschedule`, {
      method: 'POST',
      body: JSON.stringify({ strategyType: strategy })
    })
    addSocketLog('OUTGOING', `管理员触发重调度：${pileId} / ${strategy}`)
    await Promise.all([loadPiles(), loadWaitingQueue(), loadReports()])
  })
}

const handleSimulateBroadcast = ({ type, payload }: { type: string; payload: unknown }) => {
  addSocketLog('INCOMING', `[模拟广播注入] ${type}: ${JSON.stringify(payload)}`)
}

const onLogout = () => {
  adminName.value = null
  currentTab.value = 'dashboard'
  localStorage.removeItem('admin_access_token')
  localStorage.removeItem('admin_name')
  socket?.close()
  void router.push({ path: '/auth', query: { mode: 'admin' } })
}

function addSocketLog(direction: SocketDirection, message: string) {
  socketLogs.value.unshift({
    id: 'log_' + Date.now() + Math.random(),
    direction,
    message,
    timestamp: new Date().toLocaleTimeString()
  })
}

function formatTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString()
}

async function runAdminOperation(operation: () => Promise<void>) {
  adminError.value = ''
  try {
    await operation()
  } catch (error) {
    adminError.value = error instanceof Error ? error.message : '管理端操作失败'
  }
}
</script>

<template>
  <div class="app-shell font-sans" id="root-portal">
    <Sidebar
      :currentTab="currentTab"
      :adminName="adminName"
      @update:currentTab="currentTab = $event"
      @logout="onLogout"
    />

    <main class="app-main">
      <div class="shell-container">
        <div v-if="adminError" class="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {{ adminError }}
        </div>
        <DashboardView v-if="currentTab === 'dashboard'" :piles="piles" :waitingQueue="waitingQueue" />
        <MonitorView
          v-else-if="currentTab === 'monitor'"
          :piles="piles"
          @toggle-power="handleTogglePower"
          @report-fault="handleReportFault"
          @recover-pile="handleRecoverPile"
          @trigger-reschedule="handleTriggerReschedule"
        />
        <ReportView
          v-else-if="currentTab === 'reports'"
          :billingHistory="billingHistory"
          :timeType="reportTimeType"
          @change-time-type="handleReportTimeTypeChange"
        />
        <WebSocketView v-else-if="currentTab === 'websocket'" :socketLogs="socketLogs" @simulate-broadcast="handleSimulateBroadcast" />
        <AcceptanceView v-else-if="currentTab === 'acceptance'" />
      </div>
    </main>
  </div>
</template>
