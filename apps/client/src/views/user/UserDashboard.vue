<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { apiRequest } from '../../api/http'

const userId = localStorage.getItem('user_id') ?? ''
const username = localStorage.getItem('username') ?? ''

const requestForm = reactive({
  chargeMode: 'FAST' as 'FAST' | 'SLOW',
  requestedAmount: 30
})

const queueStatus = reactive({
  orderId: '未生成',
  queueNo: '--',
  status: 'WAITING',
  queueArea: '--',
  aheadCount: 0,
  estimatedWaitTime: 0,
  chargeMode: 'FAST' as 'FAST' | 'SLOW' | undefined,
  requestedAmount: 30 as number | undefined
})

const details = ref<Array<Record<string, unknown>>>([])
const toast = ref<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)

const hasValidOrder = computed(() => Boolean(queueStatus.orderId && queueStatus.orderId !== '未生成'))
const canModify = computed(() => hasValidOrder.value && queueStatus.status === 'WAITING')

function showToast(type: 'success' | 'error' | 'info', text: string) {
  toast.value = { type, text }
  setTimeout(() => {
    toast.value = null
  }, 3200)
}

function showError(error: unknown, fallback: string) {
  const message = error instanceof Error && error.message ? error.message : fallback
  showToast('error', message)
}

function applyQueueData(data: Partial<typeof queueStatus>) {
  Object.assign(queueStatus, data)
  if (data.chargeMode) requestForm.chargeMode = data.chargeMode
  if (typeof data.requestedAmount === 'number') requestForm.requestedAmount = data.requestedAmount
}

function hasOrder() {
  if (!hasValidOrder.value) {
    showToast('error', '请先提交充电请求')
    return false
  }
  return true
}

async function submitRequest() {
  if (!userId) {
    showToast('error', '会话已失效，请重新登录')
    return
  }
  try {
    const data = await apiRequest<Partial<typeof queueStatus>>(
      '/user/charging/request',
      {
        method: 'POST',
        body: JSON.stringify({
          userId,
          ...requestForm
        })
      },
      'user'
    )
    applyQueueData(data)
    showToast('success', '充电请求已提交，等候区状态下可修改模式与电量')
  } catch (error) {
    showError(error, '提交充电请求失败')
  }
}

async function queryQueue() {
  if (!hasOrder()) return
  try {
    const data = await apiRequest<Partial<typeof queueStatus>>(
      `/user/charging/${queueStatus.orderId}/queue`,
      {},
      'user'
    )
    applyQueueData(data)
    showToast('info', '已刷新排队状态')
  } catch (error) {
    showError(error, '查询排队失败')
  }
}

async function modifyMode() {
  if (!hasOrder()) return
  if (!canModify.value) {
    showToast('error', '仅 WAITING 状态可修改模式，已进入充电桩队列后请取消后重新排队')
    return
  }
  try {
    const data = await apiRequest<Partial<typeof queueStatus>>(
      `/user/charging/${queueStatus.orderId}/mode`,
      {
        method: 'PUT',
        body: JSON.stringify({ newMode: requestForm.chargeMode })
      },
      'user'
    )
    applyQueueData(data)
    showToast('success', '充电模式已修改')
  } catch (error) {
    showError(error, '修改模式失败')
  }
}

async function modifyAmount() {
  if (!hasOrder()) return
  if (!canModify.value) {
    showToast('error', '仅 WAITING 状态可修改电量，已进入充电桩队列后请取消后重新排队')
    return
  }
  try {
    const data = await apiRequest<Partial<typeof queueStatus>>(
      `/user/charging/${queueStatus.orderId}/amount`,
      {
        method: 'PUT',
        body: JSON.stringify({ newAmount: requestForm.requestedAmount })
      },
      'user'
    )
    applyQueueData(data)
    showToast('success', '请求电量已修改')
  } catch (error) {
    showError(error, '修改电量失败')
  }
}

async function startCharging() {
  if (!hasOrder()) return
  try {
    const data = await apiRequest<{ status: string }>(
      `/user/charging/${queueStatus.orderId}/start`,
      { method: 'POST', body: '{}' },
      'user'
    )
    queueStatus.status = data.status
    showToast('success', '开始充电')
  } catch (error) {
    showError(error, '开始充电失败')
  }
}

async function stopCharging() {
  if (!hasOrder()) return
  try {
    const data = await apiRequest<Record<string, unknown>>(
      `/user/charging/${queueStatus.orderId}/stop`,
      { method: 'POST', body: '{}' },
      'user'
    )
    queueStatus.status = 'FINISHED'
    details.value.unshift(data)
    showToast('success', '充电结束，已生成详单')
  } catch (error) {
    showError(error, '结束充电失败')
  }
}

async function cancelCharging() {
  if (!hasOrder()) return
  try {
    const data = await apiRequest<Record<string, unknown>>(
      `/user/charging/${queueStatus.orderId}/cancel`,
      {
        method: 'POST',
        body: JSON.stringify({
          reason: queueStatus.status === 'CHARGING' ? 'USER_STOP' : 'USER_CANCEL'
        })
      },
      'user'
    )
    if (data.detailId) {
      queueStatus.status = 'FINISHED'
      details.value.unshift(data)
    } else {
      applyQueueData(data as Partial<typeof queueStatus>)
    }
    showToast('info', '取消流程已触发')
  } catch (error) {
    showError(error, '取消充电失败')
  }
}

const statusColor: Record<string, string> = {
  WAITING: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  IN_PILE_QUEUE: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  CHARGING: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  FINISHED: 'bg-slate-500/10 text-slate-300 border-slate-500/20',
  CANCELED: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  ABORTED: 'bg-rose-500/10 text-rose-400 border-rose-500/20'
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-4">
      <div>
        <h2 class="text-2xl font-bold text-slate-900 tracking-tight">充电服务中心</h2>
        <p class="text-sm text-slate-500 mt-1">欢迎回来，<span class="font-mono text-emerald-600">{{ username }}</span></p>
      </div>
      <div
        v-if="toast"
        class="px-4 py-2 rounded-xl text-xs font-medium border"
        :class="{
          'bg-emerald-500/10 text-emerald-600 border-emerald-500/20': toast.type === 'success',
          'bg-rose-500/10 text-rose-600 border-rose-500/20': toast.type === 'error',
          'bg-blue-500/10 text-blue-600 border-blue-500/20': toast.type === 'info'
        }"
      >
        {{ toast.text }}
      </div>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <section class="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h3 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-5">提交充电请求</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-slate-500 mb-2">充电模式</label>
            <div class="flex gap-2">
              <button
                type="button"
                class="flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all"
                :class="requestForm.chargeMode === 'FAST' ? 'bg-emerald-500 text-slate-950 border-emerald-500' : 'bg-slate-50 text-slate-600 border-slate-200'"
                @click="requestForm.chargeMode = 'FAST'"
              >
                快充 FAST
              </button>
              <button
                type="button"
                class="flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all"
                :class="requestForm.chargeMode === 'SLOW' ? 'bg-emerald-500 text-slate-950 border-emerald-500' : 'bg-slate-50 text-slate-600 border-slate-200'"
                @click="requestForm.chargeMode = 'SLOW'"
              >
                慢充 SLOW
              </button>
            </div>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-500 mb-2">请求电量 (kWh)</label>
            <input
              v-model.number="requestForm.requestedAmount"
              type="number"
              min="1"
              step="5"
              class="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-mono focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10"
            />
          </div>
          <p
            class="text-[11px] rounded-xl px-3 py-2 border"
            :class="canModify ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-slate-500 bg-slate-50 border-slate-200'"
          >
            {{ canModify
              ? '当前为等候区（WAITING），可修改充电模式与请求电量。'
              : hasValidOrder
                ? '订单已进入充电桩队列或正在充电，无法修改模式/电量；如需变更请先取消后重新排队。'
                : '提交充电请求后，在等候区状态下可修改模式与电量。' }}
          </p>
          <div class="flex flex-wrap gap-2 pt-1">
            <button class="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-xl" @click="submitRequest">提交请求</button>
            <button class="px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-xl" @click="queryQueue">查询排队</button>
            <button
              class="px-4 py-2.5 text-xs font-bold rounded-xl border transition-all"
              :class="canModify ? 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'"
              :disabled="!canModify"
              @click="modifyMode"
            >
              修改模式
            </button>
            <button
              class="px-4 py-2.5 text-xs font-bold rounded-xl border transition-all"
              :class="canModify ? 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'"
              :disabled="!canModify"
              @click="modifyAmount"
            >
              修改电量
            </button>
          </div>
        </div>
      </section>

      <section class="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h3 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-5">当前订单</h3>
        <div class="grid grid-cols-2 gap-3 mb-5">
          <div class="bg-slate-50 rounded-xl p-3 border border-slate-100">
            <p class="text-[10px] text-slate-500 uppercase">排队号</p>
            <p class="text-lg font-bold font-mono text-slate-900 mt-1">{{ queueStatus.queueNo }}</p>
          </div>
          <div class="bg-slate-50 rounded-xl p-3 border border-slate-100">
            <p class="text-[10px] text-slate-500 uppercase">状态</p>
            <span class="inline-block mt-1 px-2 py-1 rounded-lg text-[10px] font-bold border" :class="statusColor[queueStatus.status] ?? statusColor.WAITING">
              {{ queueStatus.status }}
            </span>
          </div>
          <div class="bg-slate-50 rounded-xl p-3 border border-slate-100">
            <p class="text-[10px] text-slate-500 uppercase">区域</p>
            <p class="text-sm font-bold font-mono text-slate-900 mt-1">{{ queueStatus.queueArea }}</p>
          </div>
          <div class="bg-slate-50 rounded-xl p-3 border border-slate-100">
            <p class="text-[10px] text-slate-500 uppercase">预计等待</p>
            <p class="text-sm font-bold font-mono text-slate-900 mt-1">{{ queueStatus.estimatedWaitTime }} 分钟</p>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <button class="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl" @click="startCharging">开始充电</button>
          <button class="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-xl" @click="stopCharging">结束充电</button>
          <button class="px-4 py-2.5 bg-rose-500 hover:bg-rose-400 text-white text-xs font-bold rounded-xl" @click="cancelCharging">取消充电</button>
        </div>
      </section>
    </div>

    <section class="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
      <h3 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-5">充电详单</h3>
      <div v-if="details.length === 0" class="text-sm text-slate-500 py-8 text-center border border-dashed border-slate-200 rounded-xl">
        暂无详单记录
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead>
            <tr class="border-b border-slate-200 text-slate-500 uppercase tracking-wider">
              <th class="py-3 pr-4">详单编号</th>
              <th class="py-3 pr-4">充电桩</th>
              <th class="py-3 pr-4">电量</th>
              <th class="py-3 pr-4">时长</th>
              <th class="py-3 pr-4">充电费</th>
              <th class="py-3 pr-4">服务费</th>
              <th class="py-3">总费用</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in details" :key="String(row.detailId ?? index)" class="border-b border-slate-100 hover:bg-slate-50">
              <td class="py-3 pr-4 font-mono">{{ row.detailId }}</td>
              <td class="py-3 pr-4 font-mono">{{ row.pileId }}</td>
              <td class="py-3 pr-4">{{ row.actualAmount }}</td>
              <td class="py-3 pr-4">{{ row.duration }}</td>
              <td class="py-3 pr-4">{{ row.chargeFee }}</td>
              <td class="py-3 pr-4">{{ row.serviceFee }}</td>
              <td class="py-3 font-bold text-emerald-600">{{ row.totalFee }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
