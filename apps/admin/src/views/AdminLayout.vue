<script setup lang="ts">
import { ref, onMounted } from 'vue' // 👈 1. 别忘了导入 onMounted
onMounted
import Sidebar from '../components/Sidebar.vue'
import LoginView from './LoginView.vue'
import DashboardView from './DashboardView.vue'
import MonitorView from './MonitorView.vue'
import ReportView from './ReportView.vue'
import WebSocketView from './WebSocketView.vue'
import ElectronView from './ElectronView.vue'

// Session Admin State
const adminName = ref<string | null>(null)
const currentTab = ref('dashboard')
onMounted(() => {
  document.title = '智能充电桩 - 调度与计费管理后台'
})
// Mock Static Data representing active charging piles
const piles = ref([
  {
    id: 'F01',
    type: 'FAST' as const,
    physicalState: 'ON' as const,
    workingState: 'CHARGING' as const,
    lastActive: '10:05',
    totalEnergy: 142.5,
    queue: [
      { id: 'c1', queueNo: 'F1', progress: 45, userId: 'user_01', amount: 35 },
      { id: 'c2', queueNo: 'F2', progress: 0, userId: 'user_03', amount: 48 }
    ]
  },
  {
    id: 'F02',
    type: 'FAST' as const,
    physicalState: 'ON' as const,
    workingState: 'IDLE' as const,
    lastActive: '09:50',
    totalEnergy: 98.2,
    queue: []
  },
  {
    id: 'T01',
    type: 'SLOW' as const,
    physicalState: 'ON' as const,
    workingState: 'CHARGING' as const,
    lastActive: '10:10',
    totalEnergy: 64.0,
    queue: [
      { id: 'c3', queueNo: 'T1', progress: 12, userId: 'user_02', amount: 20 },
      { id: 'c4', queueNo: 'T2', progress: 0, userId: 'user_04', amount: 18 }
    ]
  },
  {
    id: 'T02',
    type: 'SLOW' as const,
    physicalState: 'ON' as const,
    workingState: 'IDLE' as const,
    lastActive: '08:15',
    totalEnergy: 32.8,
    queue: []
  }
])

// Mock Static Waiting Queue
const waitingQueue = ref([
  { orderId: 'o101', userId: 'user_05', mode: 'FAST' as const, amount: 40, queueNo: 'F3', timestamp: '10:08:12' },
  { orderId: 'o102', userId: 'user_06', mode: 'SLOW' as const, amount: 25, queueNo: 'T3', timestamp: '10:09:45' },
  { orderId: 'o103', userId: 'user_07', mode: 'FAST' as const, amount: 30, queueNo: 'F4', timestamp: '10:10:02' }
])

// Mock Static Billing details
const billingHistory = ref([
  { id: 'BILL-20260609-001', pileId: 'F01', userId: 'user_08', energy: 32.5, duration: 25, feeCharge: 32.5, feeService: 26.0, feeTotal: 58.5, timestamp: '10:01:14' },
  { id: 'BILL-20260609-002', pileId: 'T02', userId: 'user_09', energy: 15.0, duration: 60, feeCharge: 10.5, feeService: 12.0, feeTotal: 22.5, timestamp: '09:48:32' },
  { id: 'BILL-20260609-003', pileId: 'F02', userId: 'user_10', energy: 45.0, duration: 40, feeCharge: 45.0, feeService: 36.0, feeTotal: 81.0, timestamp: '09:20:05' }
])

// Mock Socket log messages
const socketLogs = ref([
  { id: 'log1', direction: 'SYSTEM' as const, message: 'WebSocket 监听服务已成功绑定于 0.0.0.0:3000/ws/station 通道。', timestamp: '10:00:00' },
  { id: 'log2', direction: 'INCOMING' as const, message: '收到设备 F01 发送的主动上行状态帧: {"pileId":"F01","chargeRate":30,"workingMode":"FAST_CHARGING"}', timestamp: '10:05:01' },
  { id: 'log3', direction: 'OUTGOING' as const, message: '向排队子系统推送最适合叫号队列变更广播: {"action":"QUEUE_REPAIR","count":3}', timestamp: '10:08:14' }
])

// Simulated action functions
const handleTogglePower = (pileId: string) => {
  const target = piles.value.find(p => p.id === pileId)
  if (!target) return

  const originalState = target.physicalState
  target.physicalState = originalState === 'ON' ? 'OFF' : 'ON'
  if (target.physicalState === 'OFF') {
    target.workingState = 'IDLE'
  }

  // Record socket logs
  socketLogs.value.unshift({
    id: 'log_' + Date.now(),
    direction: 'OUTGOING',
    message: `管理员执行关闭指令。向集群发送广播: {"action":"POWER_STATE","pileId":"${pileId}","state":"${target.physicalState}"}`,
    timestamp: new Date().toLocaleTimeString()
  })
}

const handleReportFault = (pileId: string) => {
  const target = piles.value.find(p => p.id === pileId)
  if (!target) return

  target.workingState = 'FAULT'

  socketLogs.value.unshift({
    id: 'log_' + Date.now(),
    direction: 'SYSTEM',
    message: `⚠️ 检测到硬件故障上报！充电桩 ID: ${pileId} [物理电源: ON, 工作态變更: FAULT]`,
    timestamp: new Date().toLocaleTimeString()
  })
}

const handleRecoverPile = (pileId: string) => {
  const target = piles.value.find(p => p.id === pileId)
  if (!target) return

  target.workingState = 'IDLE'

  socketLogs.value.unshift({
    id: 'log_' + Date.now(),
    direction: 'SYSTEM',
    message: `✅ 硬件故障解除。充电桩 ID: ${pileId} 工作状态恢复为空闲(IDLE)。`,
    timestamp: new Date().toLocaleTimeString()
  })
}

const handleTriggerReschedule = ({ pileId, strategy }: { pileId: string; strategy: string }) => {
  const target = piles.value.find(p => p.id === pileId)
  if (!target || target.workingState !== 'FAULT') return

  // Move affected queue back to general waiting queues
  const affected = [...target.queue]
  target.queue = []

  // Simulate pushing back depending on selection strategy
  affected.forEach((car, index) => {
    waitingQueue.value.unshift({
      orderId: 'o_' + car.id,
      userId: car.userId,
      mode: target.type,
      amount: car.amount,
      queueNo: car.queueNo,
      timestamp: new Date().toLocaleTimeString()
    })
  })

  socketLogs.value.unshift({
    id: 'log_resched_' + Date.now(),
    direction: 'OUTGOING',
    message: `🚀 [重调度触发成功]! 选用算法策略: ${strategy}. 冲突桩 ID: ${pileId}。已安全撤离 ${affected.length} 辆车并重组叫号。`,
    timestamp: new Date().toLocaleTimeString()
  })

  alert(`🚨 受到故障充电桩 ${pileId} 影响的 ${affected.length} 部车辆已安全转移！系统采用“${strategy === 'TIME_ORDER' ? '按原排队号排定' : '高优先叫号'}”算法，已被安全分派至其他排队队列中。`)
}

const handleSimulateBroadcast = ({ type, payload }: { type: string; payload: any }) => {
  socketLogs.value.unshift({
    id: 'log_broad_' + Date.now(),
    direction: 'INCOMING',
    message: `🔌 [模拟广播注入] ${type}: ${JSON.stringify(payload)}`,
    timestamp: new Date().toLocaleTimeString()
  })
}

// Session logins
const onLoginSuccess = (name: string) => {
  adminName.value = name
}

const onLogout = () => {
  adminName.value = null
  currentTab.value = 'dashboard'
}
</script>

<template>
  <!-- 主入口状态分级切换，防止暗黑登录页与亮白后台容器样式交叉污染 -->
  <div v-if="!adminName" class="w-full min-h-screen">
    <LoginView @login-success="onLoginSuccess" />
  </div>

  <div v-else class="min-h-screen bg-slate-100 flex font-sans" id="root-portal">
    <!-- 侧边导航栏 -->
    <Sidebar :currentTab="currentTab" :adminName="adminName" @update:currentTab="currentTab = $event" @logout="onLogout" />

    <!-- 管理员控制台工作区 -->
    <main class="flex-1 overflow-y-auto p-6 md:p-8 bg-slate-50">
      <div class="max-w-7xl mx-auto space-y-6">
        <DashboardView v-if="currentTab === 'dashboard'" :piles="piles" :waitingQueue="waitingQueue" />
        <MonitorView v-else-if="currentTab === 'monitor'" :piles="piles" @toggle-power="handleTogglePower" @report-fault="handleReportFault" @recover-pile="handleRecoverPile" @trigger-reschedule="handleTriggerReschedule" />
        <ReportView v-else-if="currentTab === 'reports'" :billingHistory="billingHistory" />
        <WebSocketView v-else-if="currentTab === 'websocket'" :socketLogs="socketLogs" @simulate-broadcast="handleSimulateBroadcast" />
        <ElectronView v-else-if="currentTab === 'electron'" />
      </div>
    </main>
  </div>
</template>
