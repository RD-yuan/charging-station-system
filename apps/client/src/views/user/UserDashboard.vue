<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
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
  assignedPileId: null as string | null,
  aheadCount: 0,
  estimatedWaitTime: 0,
  chargeMode: 'FAST' as 'FAST' | 'SLOW' | undefined,
  requestedAmount: 30 as number | undefined,
  recoverable: false
})

const details = ref<Array<Record<string, unknown>>>([])
const toast = ref<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)
let currentOrderTimer: ReturnType<typeof setInterval> | null = null
let currentOrderRefreshInFlight = false

const hasValidOrder = computed(() => Boolean(queueStatus.orderId && queueStatus.orderId !== '未生成'))
const canModify = computed(() => hasValidOrder.value && queueStatus.status === 'WAITING')
const displayStatus = computed(() => queueStatus.recoverable ? '故障中断，等待自动恢复' : queueStatus.status)
const displayPile = computed(() => {
  if (queueStatus.assignedPileId) return `${queueStatus.assignedPileId} 号充电桩`
  if (queueStatus.status === 'WAITING') return '等候区'
  return queueStatus.queueArea || '--'
})

onMounted(() => {
  void restoreDashboard()
  currentOrderTimer = setInterval(() => void refreshCurrentOrder(), 2000)
})

onUnmounted(() => {
  if (currentOrderTimer) clearInterval(currentOrderTimer)
})

async function restoreDashboard() {
  try {
    const [currentOrder, history] = await Promise.all([
      apiRequest<Partial<typeof queueStatus> | null>('/user/charging/current', {}, 'user'),
      apiRequest<Array<Record<string, unknown>>>('/user/details', {}, 'user')
    ])
    if (currentOrder) applyQueueData(currentOrder)
    details.value = history
  } catch (error) {
    showError(error, '加载用户数据失败')
  }
}

async function refreshCurrentOrder() {
  if (currentOrderRefreshInFlight) return
  currentOrderRefreshInFlight = true
  try {
    const currentOrder = await apiRequest<Partial<typeof queueStatus> | null>(
      '/user/charging/current',
      {},
      'user'
    )
    if (currentOrder) applyQueueData(currentOrder)
  } catch {
    // Background refresh stays quiet; explicit actions surface their own errors.
  } finally {
    currentOrderRefreshInFlight = false
  }
}

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
  try {
    if (!(await confirmWaitingStatus())) return
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
    await refreshCurrentOrder()
    showModifyError(error, '修改模式失败')
  }
}

async function modifyAmount() {
  if (!hasOrder()) return
  try {
    if (!(await confirmWaitingStatus())) return
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
    await refreshCurrentOrder()
    showModifyError(error, '修改电量失败')
  }
}

async function confirmWaitingStatus() {
  const data = await apiRequest<Partial<typeof queueStatus>>(
    `/user/charging/${queueStatus.orderId}/queue`,
    {},
    'user'
  )
  applyQueueData(data)
  if (data.status === 'WAITING') return true

  showToast('error', `订单当前状态为 ${data.status ?? '未知'}，只有 WAITING 状态可以修改`)
  return false
}

function showModifyError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('Only WAITING orders can be modified')) {
    showToast('error', `订单已更新为 ${queueStatus.status}，只有 WAITING 状态可以修改`)
    return
  }
  showError(error, fallback)
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
  WAITING: 'bg-amber-50 text-amber-800 border-amber-200',
  IN_PILE_QUEUE: 'bg-blue-50 text-blue-800 border-blue-200',
  CHARGING: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  FINISHED: 'bg-slate-100 text-slate-700 border-slate-200',
  CANCELED: 'bg-rose-50 text-rose-700 border-rose-200',
  ABORTED: 'bg-rose-50 text-rose-700 border-rose-200'
}
</script>

<template>
  <div class="space-y-6">
    <div class="view-header">
      <div>
        <h2 class="view-title">充电服务中心</h2>
        <p class="view-subtitle">欢迎回来，<span class="font-mono text-orange-600">{{ username }}</span></p>
      </div>
      <div
        v-if="toast"
        class="px-4 py-2 rounded-lg text-xs font-medium border"
        role="status"
        aria-live="polite"
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
      <section class="panel p-6">
        <h3 class="text-sm font-semibold text-slate-900 uppercase mb-5">提交充电请求</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-slate-500 mb-2">充电模式</label>
            <div class="flex gap-2">
              <button
                type="button"
                class="flex-1 min-h-11 py-2.5 rounded-lg text-xs font-semibold border transition-colors"
                :class="requestForm.chargeMode === 'FAST' ? 'bg-orange-500 text-white border-orange-500' : 'bg-slate-50 text-slate-600 border-slate-200'"
                @click="requestForm.chargeMode = 'FAST'"
              >
                快充 FAST
              </button>
              <button
                type="button"
                class="flex-1 min-h-11 py-2.5 rounded-lg text-xs font-semibold border transition-colors"
                :class="requestForm.chargeMode === 'SLOW' ? 'bg-orange-500 text-white border-orange-500' : 'bg-slate-50 text-slate-600 border-slate-200'"
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
              class="form-control font-mono"
            />
          </div>
          <p
            class="text-[11px] rounded-lg px-3 py-2 border"
            :class="canModify ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-slate-500 bg-slate-50 border-slate-200'"
          >
            {{ canModify
              ? '当前为等候区（WAITING），可修改充电模式与请求电量。'
              : hasValidOrder
                ? '订单已进入充电桩队列或正在充电，无法修改模式/电量；如需变更请先取消后重新排队。'
                : '提交充电请求后，在等候区状态下可修改模式与电量。' }}
          </p>
          <div class="flex flex-wrap gap-2 pt-1">
            <button class="btn-primary text-xs" @click="submitRequest">提交请求</button>
            <button class="btn-secondary text-xs" @click="queryQueue">查询排队</button>
            <button
              class="min-h-11 px-4 py-2.5 text-xs font-semibold rounded-lg border transition-colors"
              :class="canModify ? 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'"
              :disabled="!canModify"
              @click="modifyMode"
            >
              修改模式
            </button>
            <button
              class="min-h-11 px-4 py-2.5 text-xs font-semibold rounded-lg border transition-colors"
              :class="canModify ? 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'"
              :disabled="!canModify"
              @click="modifyAmount"
            >
              修改电量
            </button>
          </div>
        </div>
      </section>

      <section class="panel p-6">
        <h3 class="text-sm font-semibold text-slate-900 uppercase mb-5">当前订单</h3>
        <div class="grid grid-cols-2 gap-3 mb-5">
          <div class="panel-muted p-3">
            <p class="text-[10px] text-slate-500 uppercase">排队号</p>
            <p class="text-lg font-bold font-mono text-slate-900 mt-1">{{ queueStatus.queueNo }}</p>
          </div>
          <div class="panel-muted p-3">
            <p class="text-[10px] text-slate-500 uppercase">状态</p>
            <span class="inline-block mt-1 px-2 py-1 rounded-lg text-[10px] font-bold border" :class="statusColor[queueStatus.status] ?? statusColor.WAITING">
              {{ displayStatus }}
            </span>
          </div>
          <div class="panel-muted p-3">
            <p class="text-[10px] text-slate-500 uppercase">充电桩</p>
            <p class="text-sm font-bold font-mono text-slate-900 mt-1">{{ displayPile }}</p>
          </div>
          <div class="panel-muted p-3">
            <p class="text-[10px] text-slate-500 uppercase">预计等待</p>
            <p class="text-sm font-bold font-mono text-slate-900 mt-1">{{ queueStatus.estimatedWaitTime }} 分钟</p>
          </div>
        </div>
        <div v-if="queueStatus.recoverable" class="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          该订单因充电桩故障暂停。管理员恢复充电桩后，系统会将订单放回原桩队首并自动继续充电。
        </div>
        <div class="flex flex-wrap gap-2">
          <button class="btn-primary text-xs" @click="stopCharging">结束充电</button>
          <button class="btn-danger text-xs" @click="cancelCharging">取消充电</button>
        </div>
      </section>
    </div>

    <section class="panel p-6">
      <h3 class="text-sm font-semibold text-slate-900 uppercase mb-5">充电详单</h3>
      <div v-if="details.length === 0" class="text-sm text-slate-500 py-8 text-center border border-dashed border-slate-200 rounded-lg">
        暂无详单记录
      </div>
      <div v-else class="overflow-x-auto">
        <table class="data-table">
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
