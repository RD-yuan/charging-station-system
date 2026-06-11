<script setup lang="ts">
import { ref } from 'vue'

interface QueueCar {
  id: string
  queueNo: string
  progress: number
  userId: string
  amount: number
}

interface Pile {
  id: string
  type: 'FAST' | 'SLOW'
  physicalState: 'ON' | 'OFF'
  workingState: 'IDLE' | 'CHARGING' | 'FAULT'
  lastActive: string
  totalEnergy: number
  queue: Array<QueueCar>
}

const props = defineProps<{
  piles: Array<Pile>
}>()

const emit = defineEmits([
  'toggle-power',
  'report-fault',
  'recover-pile',
  'trigger-reschedule'
])

const activePivotPileId = ref<string | null>(null)
const selectedRescheduleStrategy = ref<string>('TIME_ORDER')

const selectPile = (id: string) => {
  activePivotPileId.value = activePivotPileId.value === id ? null : id
}

const handleReschedule = (pileId: string) => {
  emit('trigger-reschedule', {
    pileId,
    strategy: selectedRescheduleStrategy.value
  })
}
</script>

<template>
  <div class="space-y-6 font-sans">
    <!-- View Header -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5">
      <div>
        <h2 class="text-xl font-bold text-slate-900 tracking-tight">电桩状态监控 (Piles & Queues Monitor)</h2>
        <p class="text-xs text-slate-500 mt-1">支持管理员启停充电桩、单独上报故障、修改故障车辆重调度重组策略</p>
      </div>
      <div class="flex items-center gap-3">
        <label class="text-xs font-semibold text-slate-600 font-mono shrink-0">重调度策略配置:</label>
        <select 
          v-model="selectedRescheduleStrategy"
          class="bg-white border border-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-700 font-medium"
        >
          <option value="TIME_ORDER">按原登记排队号顺序重排 (推荐)</option>
          <option value="PRIORITY_QUEUE">高优先级紧急车队最前列排定</option>
        </select>
      </div>
    </div>

    <!-- Piles Layout Loop -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div 
        v-for="pile in piles" 
        :key="pile.id"
        :id="`pile-card-${pile.id}`"
        :class="`bg-white rounded-xl border transition-all duration-300 overflow-hidden ${
          pile.workingState === 'FAULT'
            ? 'border-rose-300 shadow-rose-100/50 shadow-md'
            : activePivotPileId === pile.id
            ? 'border-emerald-500 ring-2 ring-emerald-500/10'
            : 'border-slate-200 hover:border-slate-300'
        }`"
      >
        <!-- Header status banner -->
        <div class="p-4 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <span :class="`text-xs font-bold px-2 py-0.5 rounded-full ${pile.type === 'FAST' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`">
              {{ pile.type === 'FAST' ? '快充桩' : '慢充桩' }}
            </span>
            <span class="font-mono font-bold text-slate-900 text-sm">{{ pile.id }} 号桩</span>
          </div>

          <!-- Working & Physical state badges -->
          <div class="flex items-center gap-2">
            <span v-if="pile.physicalState === 'OFF'" class="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-slate-200 text-slate-600 border border-slate-300/60">
              已关机 (OFF)
            </span>
            <span v-else-if="pile.workingState === 'FAULT'" class="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200 animate-pulse">
              故障崩溃 (FAULT)
            </span>
            <span v-else-if="pile.workingState === 'CHARGING'" class="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
              工作中 (CHARGING)
            </span>
            <span v-else class="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-sky-100 text-sky-800 border border-sky-200">
              空闲 (IDLE)
            </span>
          </div>
        </div>

        <!-- Inner pile details -->
        <div class="p-5 space-y-4">
          <div class="grid grid-cols-2 gap-4 text-xs font-mono">
            <div>
              <p class="text-[10px] text-slate-400 font-sans font-medium uppercase">物理功率级别</p>
              <p class="text-slate-900 font-bold mt-1 text-sm">
                {{ pile.type === 'FAST' ? '30 kW' : '7 kW' }}
              </p>
            </div>
            <div>
              <p class="text-[10px] text-slate-400 font-sans font-medium uppercase">累计充电量</p>
              <p class="text-slate-900 font-semibold mt-1">
                {{ pile.totalEnergy.toFixed(1) }} kWh
              </p>
            </div>
          </div>

          <!-- Active Pile Queue Visualizer -->
          <div class="pt-2">
            <p class="text-[11px] font-bold text-slate-700 mb-2">排队队列 (车位列表)</p>
            
            <div v-if="pile.physicalState === 'OFF'" class="bg-slate-50 text-slate-400 text-center py-5 rounded-lg border border-slate-100 text-xs font-mono">
              充电桩已关闭物理电源，不接受队列车辆。
            </div>
            <div v-else-if="pile.workingState === 'FAULT'" class="bg-rose-50/50 text-rose-600 text-center py-5 rounded-lg border border-rose-100 text-xs leading-relaxed font-sans px-4">
              <p class="font-bold">⚠️ 该桩检测到紧急电器故障</p>
              <p class="text-[10px] text-rose-500 mt-1">当前队列中 {{ pile.queue.length }} 辆车受到影响，请立即重调度派车！</p>
            </div>
            <div v-else-if="pile.queue.length === 0" class="bg-slate-50 text-slate-400 text-center py-5 rounded-lg border border-slate-100 text-xs font-mono">
              当前车位空闲，无车辆入队列中。
            </div>
            <div v-else class="space-y-2">
              <div 
                v-for="(car, idx) in pile.queue" 
                :key="car.id"
                :class="`p-3 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono ${
                  idx === 0 
                    ? 'bg-emerald-50/40 border-emerald-100/80 shadow-xs' 
                    : 'bg-slate-50/50 border-slate-150'
                }`"
              >
                <div>
                  <div class="flex items-center gap-1.5">
                    <span :class="`px-1.5 py-0.2 rounded text-[10px] font-bold ${idx === 0 ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`">
                      {{ idx === 0 ? '首车' : `等候` }}
                    </span>
                    <span class="font-bold text-slate-900">{{ car.queueNo }}</span>
                    <span class="text-slate-400 font-sans">({{ car.userId }})</span>
                  </div>
                  <div class="mt-1 text-[10px] text-slate-500 font-sans">
                     请求电量及车辆总空间: {{ car.amount }} kWh
                  </div>
                </div>

                <!-- Live progress meter for first car -->
                <div v-if="idx === 0 && pile.workingState === 'CHARGING'" class="w-full sm:w-32">
                  <div class="flex justify-between text-[9px] text-slate-500 mb-0.5">
                    <span>充能百分比</span>
                    <span class="text-emerald-600 font-bold">{{ Math.round(car.progress) }}%</span>
                  </div>
                  <div class="w-full bg-slate-200/80 rounded-full h-1.5 overflow-hidden">
                    <div class="bg-emerald-500 h-1.5 rounded-full transition-all duration-300" :style="`width: ${car.progress}%`"></div>
                  </div>
                </div>
                <div v-else class="text-[10px] text-slate-400 font-sans font-medium">
                  等待充能信号...
                </div>
              </div>
            </div>
          </div>

          <!-- Admin Control Button Action Bar -->
          <div class="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
            <!-- Toggle Power -->
            <button
              @click="emit('toggle-power', pile.id)"
              :class="`px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-wide transition-all border outline-none cursor-pointer ${
                pile.physicalState === 'ON'
                  ? 'bg-rose-50 text-rose-700 border-rose-100 hover:bg-rose-100/60'
                  : 'bg-slate-900 text-slate-100 border-slate-950 hover:bg-slate-800'
              }`"
            >
              {{ pile.physicalState === 'ON' ? '关闭电源 (Off)' : '开启电源 (On)' }}
            </button>

            <!-- Fault Simulator -->
            <button
              v-if="pile.physicalState === 'ON' && pile.workingState !== 'FAULT'"
              @click="emit('report-fault', pile.id)"
              class="px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-wide bg-rose-600 text-white border border-rose-700 hover:bg-rose-500 outline-none cursor-pointer"
            >
              上报硬件故障
            </button>

            <!-- Fault Recovery -->
            <button
              v-if="pile.workingState === 'FAULT'"
              @click="emit('recover-pile', pile.id)"
              class="px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-wide bg-emerald-500 text-slate-950 border border-emerald-600 hover:bg-emerald-400 outline-none cursor-pointer"
            >
              故障电器恢复
            </button>

            <!-- Manual Reschedule (Only shown during fault state and are items wait in queue) -->
            <button
              v-if="pile.workingState === 'FAULT' && pile.queue.length > 0"
              @click="handleReschedule(pile.id)"
              class="ml-auto px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-wide bg-amber-500 text-slate-950 hover:bg-amber-400 outline-none border border-amber-600 cursor-pointer animate-bounce"
            >
              立刻触发新调度 ({{ selectedRescheduleStrategy === 'TIME_ORDER' ? '按排队重排' : '紧急车优先' }})
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
