<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  piles: Array<{
    id: string
    type: 'FAST' | 'SLOW'
    physicalState: 'ON' | 'OFF'
    workingState: 'IDLE' | 'CHARGING' | 'FAULT'
    lastActive: string
    totalEnergy: number
    currentCarId?: string
    currentCarProgress?: number
  }>
  waitingQueue: Array<{
    orderId: string
    userId: string
    mode: 'FAST' | 'SLOW'
    amount: number
    queueNo: string
    timestamp: string
  }>
}>()

// Dynamic System Clock: Starts at 10:11 and simulates 1:10 rate (1 real second = 10 sim seconds)
const simTime = ref('10:11:00')
let hour = 10
let minute = 11
let second = 0
let clockInterval: any = null

onMounted(() => {
  clockInterval = setInterval(() => {
    second += 10
    if (second >= 60) {
      minute += Math.floor(second / 60)
      second %= 60
    }
    if (minute >= 60) {
      hour += Math.floor(minute / 60)
      minute %= 60
    }
    if (hour >= 24) {
      hour %= 24
    }
    const hStr = String(hour).padStart(2, '0')
    const mStr = String(minute).padStart(2, '0')
    const sStr = String(second).padStart(2, '0')
    simTime.value = `${hStr}:${mStr}:${sStr}`
  }, 1000)
})

onUnmounted(() => {
  if (clockInterval) clearInterval(clockInterval)
})

// Compute overview stats
const activePilesCount = computed(() => {
  return props.piles.filter(p => p.physicalState === 'ON').length
})

const chargingPilesCount = computed(() => {
  return props.piles.filter(p => p.workingState === 'CHARGING').length
})

const totalWaitingCount = computed(() => {
  return props.waitingQueue.length
})

const faultPilesCount = computed(() => {
  return props.piles.filter(p => p.workingState === 'FAULT').length
})

const fastPilesCount = computed(() => {
  return props.piles.filter(p => p.type === 'FAST').length
})

const slowPilesCount = computed(() => {
  return props.piles.filter(p => p.type === 'SLOW').length
})
</script>

<template>
  <div class="space-y-6 font-sans">
    <!-- Header banner -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5">
      <div>
        <h2 class="text-xl font-bold text-slate-900 tracking-tight">控制台概览 (Dashboard)</h2>
        <p class="text-xs text-slate-500 mt-1">充电桩实时负载状态与基础调度信息系统</p>
      </div>
      <div class="flex items-center gap-2 text-xs font-mono bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
        <span class="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
        <span class="text-slate-600 font-medium">系统时钟: {{ simTime }} (演示速率 1:10)</span>
      </div>
    </div>

    <!-- Info Metrics Grid -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <!-- Direct metrics 1 -->
      <div class="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm flex items-center justify-between">
        <div>
          <p class="text-[11px] font-bold uppercase tracking-wider text-slate-400">电桩开启数 (ON)</p>
          <h3 class="text-2xl font-bold text-slate-950 mt-1 font-mono">
            {{ activePilesCount }} <span class="text-sm font-normal text-slate-500">/ {{ piles.length }}</span>
          </h3>
          <p class="text-[10px] text-slate-500 mt-1.5 flex items-center gap-1">
            <span>快充 {{ fastPilesCount }} 个</span>
            <span class="text-slate-300">|</span>
            <span>慢充 {{ slowPilesCount }} 个</span>
          </p>
        </div>
        <div class="rounded-xl p-3 bg-emerald-500/10 text-emerald-600 font-bold">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zap"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        </div>
      </div>

      <!-- Direct metrics 2 -->
      <div class="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm flex items-center justify-between">
        <div>
          <p class="text-[11px] font-bold uppercase tracking-wider text-slate-400">正在充电中 (CHARGING)</p>
          <h3 class="text-2xl font-bold text-slate-950 mt-1 font-mono">
            {{ chargingPilesCount }} <span class="text-sm font-normal text-slate-500">/ {{ activePilesCount }}</span>
          </h3>
          <p class="text-[10px] text-emerald-600 font-semibold mt-1.5">
            整体设备负载率: {{ Math.round((chargingPilesCount / (activePilesCount || 1)) * 100) }}%
          </p>
        </div>
        <div class="rounded-xl p-3 bg-blue-500/10 text-blue-600 font-bold">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-battery-charging"><path d="M15 7h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1"/><path d="M6 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M11 7h2"/><polyline points="10 12 12 10 12 14 14 12"/></svg>
        </div>
      </div>

      <!-- Direct metrics 3 -->
      <div class="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm flex items-center justify-between">
        <div>
          <p class="text-[11px] font-bold uppercase tracking-wider text-slate-400">等候区派单 (WAITING)</p>
          <h3 class="text-2xl font-bold text-slate-950 mt-1 font-mono">
            {{ totalWaitingCount }} <span class="text-sm font-normal text-slate-500">部</span>
          </h3>
          <p class="text-[10px] text-slate-500 mt-1.5">
            等待系统基础调度方案分派车位
          </p>
        </div>
        <div class="rounded-xl p-3 bg-amber-500/10 text-amber-600 font-bold">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-users"><circle cx="16" cy="21" r="1"/><circle cx="8" cy="21" r="1"/><path d="M17 11V7a5 5 0 0 0-10 0v4"/><polygon points="23 21 1 21 3 11 21 11 23 21"/></svg>
        </div>
      </div>

      <!-- Direct metrics 4 -->
      <div class="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm flex items-center justify-between">
        <div>
          <p class="text-[11px] font-bold uppercase tracking-wider text-slate-400">故障桩体 (FAULT)</p>
          <h3 class="text-2xl font-semibold mt-1 font-mono" :class="faultPilesCount > 0 ? 'text-rose-600 font-bold' : 'text-slate-950'">
            {{ faultPilesCount }} <span class="text-sm font-normal text-slate-500">处</span>
          </h3>
          <p class="text-[10px] mt-1.5" :class="faultPilesCount > 0 ? 'text-rose-500 font-medium' : 'text-slate-500'">
            {{ faultPilesCount > 0 ? '触发重调度机制' : '全网充电桩运行正常' }}
          </p>
        </div>
        <div class="rounded-xl p-3 bg-red-500/10 text-red-600 font-bold">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-shield-alert"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12" y1="16" y2="16"/></svg>
        </div>
      </div>
    </div>

    <!-- Active Wait List Layout -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Waiting Queue List -->
      <div class="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm">
        <div class="p-5 border-b border-slate-200/80 flex items-center justify-between">
          <div>
            <h3 class="text-sm font-bold text-slate-900">等候区派单车辆 (Waiting Queue)</h3>
            <p class="text-[10px] text-slate-400 mt-0.5">未获得充电桩位，在等候区待调度的车辆列表</p>
          </div>
          <span class="text-xs font-mono font-bold bg-slate-100 px-2.5 py-1 rounded text-slate-600 border border-slate-200">
            共 {{ totalWaitingCount }} 辆车
          </span>
        </div>

        <div class="divide-y divide-slate-100 overflow-x-auto">
          <table class="w-full text-left text-xs" id="dashboard-waiting-table">
            <thead>
              <tr class="bg-slate-50/50 text-slate-500 font-semibold tracking-wider border-b border-slate-100">
                <th class="px-6 py-3.5">排队号码</th>
                <th class="px-6 py-3.5">充电类型</th>
                <th class="px-6 py-3.5">请求电量</th>
                <th class="px-6 py-3.5">用户账号</th>
                <th class="px-6 py-3.5">报到时间</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-slate-700">
              <tr v-if="waitingQueue.length === 0">
                <td colspan="5" class="px-6 py-12 text-center text-slate-400 font-mono text-xs">
                  等候区暂时无车，所有车辆已被分配至充电桩。
                </td>
              </tr>
              <tr v-for="car in waitingQueue" :key="car.orderId" class="hover:bg-slate-50/40 transition-colors">
                <td class="px-6 py-4 font-mono font-bold text-slate-950">
                  <span :class="`px-2 py-0.5 rounded text-[11px] ${car.mode === 'FAST' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-blue-100 text-blue-700 border border-blue-200'}`">
                    {{ car.queueNo }}
                  </span>
                </td>
                <td class="px-6 py-4">
                  <span class="font-medium">{{ car.mode === 'FAST' ? '快充 (F)' : '慢充 (T)' }}</span>
                </td>
                <td class="px-6 py-4 font-mono font-medium text-slate-900">{{ car.amount }} kWh</td>
                <td class="px-6 py-4 text-slate-500 font-mono">{{ car.userId }}</td>
                <td class="px-6 py-4 text-slate-400 font-mono">{{ car.timestamp }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Quick Pile Capacity Widget -->
      <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col justify-between">
        <div>
          <h3 class="text-sm font-bold text-slate-900">计费时段状态提示</h3>
          <p class="text-[10px] text-slate-400 mt-0.5 mb-4">当前系统计费时段分布（按峰平谷规则计费）</p>

          <div class="space-y-3.5">
            <div class="flex justify-between items-center bg-rose-50 p-2.5 rounded-lg border border-rose-200/50">
              <div>
                <p class="text-xs font-bold text-rose-700">高峰时段 (Peak)</p>
                <p class="text-[10px] text-rose-500 font-mono">10:00-15:00 / 18:00-21:00</p>
              </div>
              <span class="text-xs font-mono font-bold text-rose-700">1.0 元/度</span>
            </div>

            <div class="flex justify-between items-center bg-amber-50 p-2.5 rounded-lg border border-amber-200/50">
              <div>
                <p class="text-xs font-bold text-amber-700">平时时段 (Flat)</p>
                <p class="text-[10px] text-amber-500 font-mono">07:00-10:00 / 15:00-18:00 / 21:00-23:00</p>
              </div>
              <span class="text-xs font-mono font-bold text-amber-700">0.7 元/度</span>
            </div>

            <div class="flex justify-between items-center bg-sky-50 p-2.5 rounded-lg border border-sky-200/50">
              <div>
                <p class="text-xs font-bold text-sky-700">谷时时段 (Valley)</p>
                <p class="text-[10px] text-sky-500 font-mono">23:00-07:00 (次日)</p>
              </div>
              <span class="text-xs font-mono font-bold text-sky-700">0.4 元/度</span>
            </div>
          </div>
        </div>

        <div class="mt-5 pt-4 border-t border-slate-100 flex items-start gap-2 text-[10px] text-slate-400 leading-relaxed font-mono">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-info shrink-0 text-slate-400 mt-0.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          统一服务费规则：任意时段固定计收 <strong class="text-slate-600">0.8元/度</strong> 服务费，与充电费累加计算。
        </div>
      </div>
    </div>
  </div>
</template>
