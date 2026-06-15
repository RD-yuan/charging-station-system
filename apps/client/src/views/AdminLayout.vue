<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Sidebar from '../components/Sidebar.vue'
import DashboardView from './DashboardView.vue'
import MonitorView from './MonitorView.vue'
import ReportView from './ReportView.vue'
import WebSocketView from './WebSocketView.vue'
import { apiRequest, wsUrl } from '../api/http'

type ChargeMode = 'FAST' | 'SLOW'
type PhysicalState = 'ON' | 'OFF'
type WorkingState = 'IDLE' | 'CHARGING' | 'FAULT'
type SocketDirection = 'INCOMING' | 'OUTGOING' | 'SYSTEM'
type ReportTimeType = 'DAY' | 'WEEK' | 'MONTH'

interface QueueCar {
  id: string
  queueNo: string
  status: 'IN_PILE_QUEUE' | 'CHARGING'
  progress: number
  userId: string
  amount: number
  deliveredAmount?: number
}

interface Pile {
  id: string
  type: ChargeMode
  physicalState: PhysicalState
  workingState: WorkingState
  power: number
  lastActive: string
  totalEnergy: number
  queue: QueueCar[]
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
const reportTimeType = ref<ReportTimeType>('DAY')
const affectedOrderIds = ref<Set<string>>(new Set())
const faultedPileId = ref<string | null>(null)
const clockSpeed = ref(1)
const clockSpeeds = [0.5, 1, 2, 5, 10, 20, 50]
let socket: WebSocket | null = null

onMounted(() => {
  document.title = '智能充电桩 - 调度与计费管理后台'
  adminName.value = localStorage.getItem('admin_name') ?? '超级管理员'
  void loadAdminData()
  void loadClockSpeed()
  connectSocket()
})

onUnmounted(() => {
  socket?.close()
})

async function loadAdminData() {
  await Promise.all([loadPiles(), loadWaitingQueue(), loadReports()])
}

async function loadPiles() {
  const data = await apiRequest<Array<any>>('/admin/piles')
  piles.value = data.map((pile) => ({
    id: pile.id,
    type: pile.type,
    physicalState: pile.physicalState,
    workingState: pile.workingState,
    power: Number(pile.power ?? 0),
    lastActive: new Date().toLocaleTimeString(),
    totalEnergy: Number(pile.totalEnergy ?? pile.totalChargeAmount ?? 0),
    queue: (pile.queue ?? []).map((car: any) => ({
      id: car.id ?? car.orderId,
      queueNo: car.queueNo,
      status: car.status,
      progress: Number(car.progress ?? 0),
      userId: car.username ?? car.userId,
      amount: Number(car.amount ?? car.requestedAmount ?? 0),
      deliveredAmount: Number(car.deliveredAmount ?? 0)
    }))
  }))
}

async function loadWaitingQueue() {
  waitingQueue.value = await apiRequest<WaitingQueueItem[]>('/admin/waiting-queue')
}

async function loadReports() {
  const reports = await apiRequest<Array<any>>(`/admin/reports?timeType=${reportTimeType.value}`)
  billingHistory.value = reports.map((item) => ({
    id: `REPORT-${item.timeType}-${item.pileId}`,
    pileId: item.pileId,
    userId: '汇总',
    count: Number(item.totalChargeCount ?? 0),
    energy: Number(item.totalChargeAmount ?? 0),
    duration: Number(item.totalChargeDuration ?? 0),
    feeCharge: Number(item.totalChargeFee ?? 0),
    feeService: Number(item.totalServiceFee ?? 0),
    feeTotal: Number(item.totalFee ?? 0),
    timestamp: item.timeType
  }))
}

function connectSocket() {
  socket?.close()
  socket = new WebSocket(wsUrl())
  socket.onopen = () => addSocketLog('SYSTEM', `WebSocket 已连接：${wsUrl()}`)
  socket.onerror = () => addSocketLog('SYSTEM', 'WebSocket 连接异常，请检查 NestJS 服务。')
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
        }))
      }
      if (message.event === 'fault_event') {
        faultedPileId.value = message.data.pileId ?? null
        if (message.data.affectedOrders) {
          const ids: string[] = message.data.affectedOrders.map((o: any) => o.orderId)
          affectedOrderIds.value = new Set(ids)
        }
        void loadPiles()
        void loadWaitingQueue()
        void loadReports()
      }
      if (['pile_metrics_update', 'dispatch_result', 'charging_started'].includes(message.event)) {
        if (message.event === 'dispatch_result') {
          affectedOrderIds.value = new Set()
          faultedPileId.value = null
        }
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
  const target = piles.value.find((p) => p.id === pileId)
  if (!target) return
  const endpoint = target.physicalState === 'ON' ? 'power-off' : 'power-on'
  await apiRequest(`/admin/piles/${pileId}/${endpoint}`, { method: 'POST', body: '{}' })
  addSocketLog('OUTGOING', `管理员切换充电桩电源：${pileId}`)
  await loadPiles()
}

async function handleReportFault(pileId: string) {
  await apiRequest(`/admin/piles/${pileId}/fault`, { method: 'POST', body: '{}' })
  addSocketLog('OUTGOING', `管理员上报硬件故障：${pileId}`)
  await loadPiles()
}

async function handleRecoverPile(pileId: string) {
  await apiRequest(`/admin/piles/${pileId}/recover`, { method: 'POST', body: '{}' })
  addSocketLog('OUTGOING', `管理员恢复故障充电桩：${pileId}`)
  await loadPiles()
}

async function handleTriggerReschedule({ pileId, strategy }: { pileId: string; strategy: string }) {
  await apiRequest(`/admin/piles/${pileId}/reschedule`, {
    method: 'POST',
    body: JSON.stringify({ strategyType: strategy })
  })
  addSocketLog('OUTGOING', `管理员触发重调度：${pileId} / ${strategy}`)
  await loadAdminData()
}

async function handleReportTimeTypeChange(timeType: ReportTimeType) {
  reportTimeType.value = timeType
  await loadReports()
}

async function handleSingleOptimization({ spotsCount, mode }: { spotsCount: number; mode: string }) {
  await apiRequest('/admin/optimization/single', {
    method: 'POST',
    body: JSON.stringify({ spotsCount, mode })
  })
  addSocketLog('OUTGOING', `单次最优调度: ${mode} ${spotsCount}辆`)
  await loadAdminData()
}

async function handleBatchOptimization({ spotsCount }: { spotsCount: number }) {
  await apiRequest('/admin/optimization/batch', {
    method: 'POST',
    body: JSON.stringify({ spotsCount })
  })
  addSocketLog('OUTGOING', `批量最优调度: ${spotsCount}辆`)
  await loadAdminData()
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

async function loadClockSpeed() {
  try {
    const data = await apiRequest<{ speed: number }>('/admin/clock-speed')
    clockSpeed.value = data.speed
  } catch {
    clockSpeed.value = 1
  }
}

async function setClockSpeedAction(speed: number) {
  clockSpeed.value = speed
  try {
    await apiRequest('/admin/clock-speed', { method: 'POST', body: JSON.stringify({ speed }) })
  } catch {
    // 静默失败
  }
}
</script>

<template>
  <div class="min-h-screen bg-slate-100 flex font-sans" id="root-portal">
    <Sidebar
      :currentTab="currentTab"
      :adminName="adminName"
      @update:currentTab="currentTab = $event"
      @logout="onLogout"
    />

    <main class="flex-1 overflow-y-auto p-6 md:p-8 bg-slate-50">
      <!-- 时钟流速控制条 -->
      <div class="max-w-7xl mx-auto mb-4 bg-white border border-slate-200 rounded-lg px-4 py-2 flex items-center gap-3">
        <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0">系统时钟</span>
        <div class="flex gap-1">
          <button
            v-for="s in clockSpeeds"
            :key="s"
            @click="setClockSpeedAction(s)"
            :class="`px-2 py-0.5 rounded text-[10px] font-bold font-mono border transition-all ${
              clockSpeed === s
                ? 'bg-emerald-500 text-slate-950 border-emerald-500'
                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
            }`"
          >
            {{ s }}×
          </button>
        </div>
        <span class="text-[10px] text-slate-400 ml-auto">当前 {{ clockSpeed }}× 流速</span>
      </div>
      <div class="max-w-7xl mx-auto space-y-6">
        <DashboardView v-if="currentTab === 'dashboard'" :piles="piles" :waitingQueue="waitingQueue" :clockSpeed="clockSpeed" />
        <MonitorView
          v-else-if="currentTab === 'monitor'"
          :piles="piles"
          :affectedOrderIds="affectedOrderIds"
          :faultedPileId="faultedPileId"
          @toggle-power="handleTogglePower"
          @report-fault="handleReportFault"
          @recover-pile="handleRecoverPile"
          @trigger-reschedule="handleTriggerReschedule"
          @single-optimization="handleSingleOptimization"
          @batch-optimization="handleBatchOptimization"
        />
        <ReportView
          v-else-if="currentTab === 'reports'"
          :billingHistory="billingHistory"
          :timeType="reportTimeType"
          @change-time-type="handleReportTimeTypeChange"
        />
        <WebSocketView v-else-if="currentTab === 'websocket'" :socketLogs="socketLogs" @simulate-broadcast="handleSimulateBroadcast" />
      </div>
    </main>
  </div>
</template>
