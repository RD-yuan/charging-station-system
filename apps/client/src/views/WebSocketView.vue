<script setup lang="ts">
import { ref, watch } from 'vue'

interface LogEntry {
  id: string
  direction: 'INCOMING' | 'OUTGOING' | 'SYSTEM'
  message: string
  timestamp: string
}

defineProps<{
  socketLogs: Array<LogEntry>
}>()

const emit = defineEmits(['simulate-broadcast'])

const isConnected = ref(true)
const selectedPile = ref('F01')
const selectedEvent = ref('PILE_STATUS_CHANGE')
const customMsg = ref('{"pileId":"F01","status":"CHARGING"}')

// Update custom placeholder message depending on type selection
watch(selectedEvent, (newType) => {
  if (newType === 'PILE_STATUS_CHANGE') {
    customMsg.value = `{"pileId":"${selectedPile.value}","status":"CHARGING"}`
  } else if (newType === 'QUEUE_CHANGE') {
    customMsg.value = `{"mode":"FAST","queueLength":2,"queueNo":"F3"}`
  } else if (newType === 'FAULT_UPDATE') {
    customMsg.value = `{"pileId":"${selectedPile.value}","faultCode":"E103","reSchedule":true}`
  }
})

watch(selectedPile, (newPile) => {
  if (selectedEvent.value === 'PILE_STATUS_CHANGE') {
    customMsg.value = `{"pileId":"${newPile}","status":"CHARGING"}`
  } else if (selectedEvent.value === 'FAULT_UPDATE') {
    customMsg.value = `{"pileId":"${newPile}","faultCode":"E103","reSchedule":true}`
  }
})

const handleSend = () => {
  if (!customMsg.value.trim()) return

  let payload = {}
  try {
    payload = JSON.parse(customMsg.value)
  } catch {
    alert('JSON 格式不正确，请修复后再发送仿真广播！')
    return
  }

  emit('simulate-broadcast', {
    type: selectedEvent.value,
    payload
  })
}
</script>

<template>
  <div class="space-y-6 font-sans">
    <!-- View Header -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5">
      <div>
        <h2 class="text-xl font-bold text-slate-900 tracking-tight">WebSocket 协同调试台 (Socket Console)</h2>
        <p class="text-xs text-slate-500 mt-1">模拟硬件网关上行心跳包、推送业务状态，测试并发车队的多链路重度负载协同</p>
      </div>

      <div class="flex items-center gap-2">
        <span class="text-xs font-mono font-medium text-slate-500">模拟器信道状态:</span>
        <button 
          @click="isConnected = !isConnected"
          :class="`px-3 py-1 rounded-lg text-[10px] font-bold font-mono border transition-all ${
            isConnected 
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
              : 'bg-rose-50 text-rose-700 border-rose-200'
          }`"
        >
          {{ isConnected ? '● CONNECTED' : '○ DISCONNECTED' }}
        </button>
      </div>
    </div>

    <!-- Active body partition -->
    <div class="grid grid-cols-1 lg:grid-cols-5 gap-6">
      
      <!-- Emulator control configurations -->
      <div class="lg:col-span-2 space-y-4 bg-white p-5 border border-slate-200 rounded-xl shadow-sm">
        <h3 class="text-sm font-bold text-slate-900">发送自定义业务仿真广播</h3>
        <p class="text-[10px] text-slate-400 mt-0.5">当后端尚未进行全面集成或者调试断开时，可直接在这里注入事件测试客户端表现</p>

        <div class="space-y-4 pt-2">
          <!-- Selection 1 -->
          <div>
            <label class="block text-[10px] font-bold uppercase text-slate-400 font-mono mb-1.5">相关充电桩 ID</label>
            <select 
              v-model="selectedPile"
              class="w-full bg-white border border-slate-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 font-mono text-slate-700"
            >
              <option value="F01">F01 号桩 (Fast)</option>
              <option value="F02">F02 号桩 (Fast)</option>
              <option value="T01">T01 号桩 (Slow)</option>
              <option value="T02">T02 号桩 (Slow)</option>
            </select>
          </div>

          <!-- Selection 2 -->
          <div>
            <label class="block text-[10px] font-bold uppercase text-slate-400 font-mono mb-1.5">仿真事件类型 (Type)</label>
            <select 
              v-model="selectedEvent"
              class="w-full bg-white border border-slate-200 text-xs rounded-lg px-3 py-2 id-event-sel focus:outline-none focus:ring-2 focus:ring-emerald-500/20 font-mono text-slate-700"
            >
              <option value="PILE_STATUS_CHANGE">PILE_STATUS_CHANGE (桩工作态变动)</option>
              <option value="QUEUE_CHANGE">QUEUE_CHANGE (等候区排队变动)</option>
              <option value="FAULT_UPDATE">FAULT_UPDATE (突发电器故障上报)</option>
            </select>
          </div>

          <!-- Content textbox -->
          <div>
            <label class="block text-[10px] font-bold uppercase text-slate-400 font-mono mb-1.5">事件参数主体 (Payload JSON)</label>
            <textarea 
              v-model="customMsg"
              rows="4"
              class="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 leading-relaxed"
            ></textarea>
          </div>

          <!-- Fire Trigger Button -->
          <button 
            @click="handleSend"
            :disabled="!isConnected"
            class="w-full py-2.5 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 transition-all flex items-center justify-center gap-1.5 border border-emerald-600 outline-none cursor-pointer"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-send"><line x1="22" x2="11" y1="2" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            发送仿真调试信道消息
          </button>
        </div>
      </div>

      <!-- Log Terminal visualization -->
      <div class="lg:col-span-3 flex flex-col bg-slate-950 rounded-xl border border-slate-800 shadow-2xl h-[420px] overflow-hidden" id="socket-log-terminal">
        <div class="p-3 bg-slate-900 border-b border-slate-800/80 flex items-center justify-between shrink-0">
          <div class="flex items-center gap-2">
            <span class="p-1 rounded bg-slate-800 text-emerald-400 font-bold shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-terminal"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>
            </span>
            <span class="text-xs font-mono font-bold text-slate-100">事件日志流监视控制台 (Live Log Frame)</span>
          </div>
          <span class="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
        </div>

        <div class="flex-1 p-4 font-mono overflow-y-auto text-xs space-y-2">
          <div v-if="socketLogs.length === 0" class="text-slate-600 text-center py-20 italic">
            连接建立成功。待模拟或接收到实时业务套接字信息后将在此追加显示。
          </div>
          
          <div 
            v-for="log in socketLogs" 
            :key="log.id"
            :class="`p-2 rounded flex flex-col gap-1 leading-relaxed ${
              log.direction === 'INCOMING' 
                ? 'bg-blue-950/40 text-blue-300 border border-blue-900/40' 
                : log.direction === 'OUTGOING'
                ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-900/40'
                : 'bg-slate-900 text-slate-400 border border-slate-800'
            }`"
          >
            <div class="flex items-center justify-between text-[10px] text-slate-500 font-semibold">
              <span class="font-sans">
                {{ log.direction === 'INCOMING' ? '📥 [收信]' : log.direction === 'OUTGOING' ? '📤 [发信]' : '⚙️ [系统]' }}
              </span>
              <span>{{ log.timestamp }}</span>
            </div>
            <div class="break-all whitespace-pre-wrap">{{ log.message }}</div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>
