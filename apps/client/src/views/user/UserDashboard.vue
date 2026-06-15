<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { apiRequest } from '../../api/http'

type ChargeMode = 'FAST' | 'SLOW'
type OrderStatus = 'WAITING' | 'IN_PILE_QUEUE' | 'CHARGING' | 'FINISHED' | 'CANCELED' | 'ABORTED'

interface OrderDetail {
  detailId: string
  orderId: string
  sessionId: string | null
  queueNo: string
  status: OrderStatus
  pileId: string | null
  generatedAt: string
  startTime: string | null
  stopTime: string | null
  actualAmount: number
  duration: number
  chargeFee: number
  serviceFee: number
  totalFee: number
}

interface UserOrder {
  orderId: string
  queueNo: string
  status: OrderStatus
  chargeMode: ChargeMode
  requestedAmount: number
  assignedPileId: string | null
  pileId: string | null
  queueArea: string
  submitTime: string
  startedAt: string | null
  finishedAt: string | null
  detail: OrderDetail | null
}

interface QueueStatus {
  orderId: string
  queueNo: string
  status: OrderStatus
  queueArea: string
  aheadCount: number
  estimatedWaitTime: number
  chargeMode?: ChargeMode
  requestedAmount?: number
  assignedPileId?: string | null
}

const userId = localStorage.getItem('user_id') ?? ''
const username = localStorage.getItem('username') ?? ''

const requestForm = reactive({
  chargeMode: 'FAST' as ChargeMode,
  requestedAmount: 30
})

const orders = ref<UserOrder[]>([])
const selectedOrderId = ref<string | null>(null)
const queueStatus = ref<QueueStatus | null>(null)
const loading = ref(false)
const toast = ref<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)

const openStatuses: OrderStatus[] = ['WAITING', 'IN_PILE_QUEUE', 'CHARGING']
const activeOrder = computed(() => orders.value.find((order) => openStatuses.includes(order.status)) ?? null)
const selectedOrder = computed(() => {
  return orders.value.find((order) => order.orderId === selectedOrderId.value) ?? activeOrder.value ?? orders.value[0] ?? null
})
const canModify = computed(() => selectedOrder.value?.status === 'WAITING')
const canStop = computed(() => selectedOrder.value?.status === 'CHARGING')
const canCancel = computed(() => {
  const status = selectedOrder.value?.status
  return status === 'WAITING' || status === 'IN_PILE_QUEUE'
})
const details = computed(() => orders.value.map((order) => order.detail).filter(Boolean) as OrderDetail[])

onMounted(() => {
  void loadOrders(true)
})

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

async function loadOrders(silent = false) {
  if (!userId) return
  loading.value = true
  try {
    orders.value = await apiRequest<UserOrder[]>('/user/charging/orders', {}, 'user')
    if (!selectedOrderId.value || !orders.value.some((order) => order.orderId === selectedOrderId.value)) {
      selectedOrderId.value = activeOrder.value?.orderId ?? orders.value[0]?.orderId ?? null
    }
    if (!silent) showToast('info', '订单列表已刷新')
  } catch (error) {
    showError(error, '加载订单失败')
  } finally {
    loading.value = false
  }
}

async function submitRequest() {
  if (!userId) {
    showToast('error', '会话已失效，请重新登录')
    return
  }
  try {
    const data = await apiRequest<QueueStatus>(
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
    queueStatus.value = data
    selectedOrderId.value = data.orderId
    await loadOrders(true)
    showToast('success', '订单已提交，服务器已接管调度')
  } catch (error) {
    showError(error, '提交充电请求失败')
  }
}

async function queryQueue() {
  const order = selectedOrder.value
  if (!order) {
    showToast('error', '暂无可查询订单')
    return
  }
  if (!openStatuses.includes(order.status)) {
    showToast('info', '该订单已结束，请查看详单')
    return
  }
  try {
    queueStatus.value = await apiRequest<QueueStatus>(
      `/user/charging/${order.orderId}/queue`,
      {},
      'user'
    )
    await loadOrders(true)
    showToast('info', '排队状态已刷新')
  } catch (error) {
    showError(error, '查询排队失败')
  }
}

async function modifyMode() {
  const order = selectedOrder.value
  if (!order || !canModify.value) {
    showToast('error', '仅 WAITING 状态可修改模式')
    return
  }
  try {
    queueStatus.value = await apiRequest<QueueStatus>(
      `/user/charging/${order.orderId}/mode`,
      {
        method: 'PUT',
        body: JSON.stringify({ newMode: requestForm.chargeMode })
      },
      'user'
    )
    await loadOrders(true)
    showToast('success', '充电模式已修改')
  } catch (error) {
    showError(error, '修改模式失败')
  }
}

async function modifyAmount() {
  const order = selectedOrder.value
  if (!order || !canModify.value) {
    showToast('error', '仅 WAITING 状态可修改电量')
    return
  }
  try {
    queueStatus.value = await apiRequest<QueueStatus>(
      `/user/charging/${order.orderId}/amount`,
      {
        method: 'PUT',
        body: JSON.stringify({ newAmount: requestForm.requestedAmount })
      },
      'user'
    )
    await loadOrders(true)
    showToast('success', '请求电量已修改')
  } catch (error) {
    showError(error, '修改电量失败')
  }
}

async function stopCharging() {
  const order = selectedOrder.value
  if (!order || !canStop.value) {
    showToast('error', '仅 CHARGING 状态可结束充电')
    return
  }
  try {
    await apiRequest<OrderDetail>(
      `/user/charging/${order.orderId}/stop`,
      { method: 'POST', body: '{}' },
      'user'
    )
    await loadOrders(true)
    showToast('success', '充电结束，已生成详单')
  } catch (error) {
    showError(error, '结束充电失败')
  }
}

async function cancelCharging() {
  const order = selectedOrder.value
  if (!order || !canCancel.value) {
    showToast('error', '仅 WAITING 或 IN_PILE_QUEUE 状态可取消订单')
    return
  }
  try {
    await apiRequest<QueueStatus>(
      `/user/charging/${order.orderId}/cancel`,
      {
        method: 'POST',
        body: JSON.stringify({ reason: 'USER_CANCEL' })
      },
      'user'
    )
    await loadOrders(true)
    showToast('info', '订单已取消')
  } catch (error) {
    showError(error, '取消订单失败')
  }
}

function selectOrder(order: UserOrder) {
  selectedOrderId.value = order.orderId
  requestForm.chargeMode = order.chargeMode
  requestForm.requestedAmount = order.requestedAmount
}

function formatTime(value?: string | null) {
  if (!value) return '--'
  return new Date(value).toLocaleString()
}

function formatNumber(value?: number | null, digits = 2) {
  if (typeof value !== 'number') return '--'
  return value.toFixed(digits)
}

const statusLabel: Record<OrderStatus, string> = {
  WAITING: '等候区',
  IN_PILE_QUEUE: '桩队列',
  CHARGING: '充电中',
  FINISHED: '已完成',
  CANCELED: '已取消',
  ABORTED: '已中止'
}

const statusColor: Record<OrderStatus, string> = {
  WAITING: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
  IN_PILE_QUEUE: 'bg-blue-500/10 text-blue-700 border-blue-500/20',
  CHARGING: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
  FINISHED: 'bg-slate-500/10 text-slate-700 border-slate-500/20',
  CANCELED: 'bg-rose-500/10 text-rose-700 border-rose-500/20',
  ABORTED: 'bg-rose-500/10 text-rose-700 border-rose-500/20'
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
        class="px-4 py-2 rounded-lg text-xs font-medium border"
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
      <section class="bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
        <h3 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-5">提交充电请求</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-slate-500 mb-2">充电模式</label>
            <div class="flex gap-2">
              <button
                type="button"
                class="flex-1 py-2.5 rounded-lg text-xs font-bold border transition-all"
                :class="requestForm.chargeMode === 'FAST' ? 'bg-emerald-500 text-slate-950 border-emerald-500' : 'bg-slate-50 text-slate-600 border-slate-200'"
                @click="requestForm.chargeMode = 'FAST'"
              >
                快充 FAST
              </button>
              <button
                type="button"
                class="flex-1 py-2.5 rounded-lg text-xs font-bold border transition-all"
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
              class="w-full bg-slate-50 border border-slate-200 rounded-lg py-3 px-4 text-sm font-mono focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10"
            />
          </div>
          <div class="flex flex-wrap gap-2 pt-1">
            <button class="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-lg" @click="submitRequest">提交请求</button>
            <button class="px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-lg" @click="() => loadOrders()">刷新订单</button>
          </div>
        </div>
      </section>

      <section class="bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
        <h3 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-5">选中订单</h3>
        <div v-if="selectedOrder" class="space-y-5">
          <div class="grid grid-cols-2 gap-3">
            <div class="bg-slate-50 rounded-lg p-3 border border-slate-100">
              <p class="text-[10px] text-slate-500 uppercase">排队号</p>
              <p class="text-lg font-bold font-mono text-slate-900 mt-1">{{ selectedOrder.queueNo }}</p>
            </div>
            <div class="bg-slate-50 rounded-lg p-3 border border-slate-100">
              <p class="text-[10px] text-slate-500 uppercase">状态</p>
              <span class="inline-block mt-1 px-2 py-1 rounded-md text-[10px] font-bold border" :class="statusColor[selectedOrder.status]">
                {{ statusLabel[selectedOrder.status] }} / {{ selectedOrder.status }}
              </span>
            </div>
            <div class="bg-slate-50 rounded-lg p-3 border border-slate-100">
              <p class="text-[10px] text-slate-500 uppercase">区域</p>
              <p class="text-sm font-bold font-mono text-slate-900 mt-1">{{ queueStatus?.queueArea ?? selectedOrder.queueArea }}</p>
            </div>
            <div class="bg-slate-50 rounded-lg p-3 border border-slate-100">
              <p class="text-[10px] text-slate-500 uppercase">充电桩</p>
              <p class="text-sm font-bold font-mono text-slate-900 mt-1">{{ selectedOrder.assignedPileId ?? '--' }}</p>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class="px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-lg" @click="queryQueue">查询排队</button>
            <button
              class="px-4 py-2.5 text-xs font-bold rounded-lg border transition-all"
              :class="canModify ? 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'"
              :disabled="!canModify"
              @click="modifyMode"
            >
              修改模式
            </button>
            <button
              class="px-4 py-2.5 text-xs font-bold rounded-lg border transition-all"
              :class="canModify ? 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'"
              :disabled="!canModify"
              @click="modifyAmount"
            >
              修改电量
            </button>
            <button
              class="px-4 py-2.5 text-xs font-bold rounded-lg"
              :class="canStop ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950' : 'bg-slate-100 text-slate-400 cursor-not-allowed'"
              :disabled="!canStop"
              @click="stopCharging"
            >
              结束充电
            </button>
            <button
              class="px-4 py-2.5 text-xs font-bold rounded-lg"
              :class="canCancel ? 'bg-rose-500 hover:bg-rose-400 text-white' : 'bg-slate-100 text-slate-400 cursor-not-allowed'"
              :disabled="!canCancel"
              @click="cancelCharging"
            >
              取消订单
            </button>
          </div>
        </div>
        <div v-else class="text-sm text-slate-500 py-10 text-center border border-dashed border-slate-200 rounded-lg">
          暂无订单
        </div>
      </section>
    </div>

    <section class="bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
      <div class="flex items-center justify-between gap-3 mb-5">
        <h3 class="text-sm font-bold text-slate-900 uppercase tracking-wider">全部订单</h3>
        <span class="text-xs text-slate-500 font-mono">{{ loading ? '加载中...' : `${orders.length} 条` }}</span>
      </div>
      <div v-if="orders.length === 0" class="text-sm text-slate-500 py-8 text-center border border-dashed border-slate-200 rounded-lg">
        暂无订单记录
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead>
            <tr class="border-b border-slate-200 text-slate-500 uppercase tracking-wider">
              <th class="py-3 pr-4">排队号</th>
              <th class="py-3 pr-4">模式</th>
              <th class="py-3 pr-4">请求电量</th>
              <th class="py-3 pr-4">状态</th>
              <th class="py-3 pr-4">充电桩</th>
              <th class="py-3 pr-4">提交时间</th>
              <th class="py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="order in orders"
              :key="order.orderId"
              class="border-b border-slate-100 hover:bg-slate-50"
              :class="selectedOrderId === order.orderId ? 'bg-emerald-50/50' : ''"
            >
              <td class="py-3 pr-4 font-mono font-bold">{{ order.queueNo }}</td>
              <td class="py-3 pr-4">{{ order.chargeMode }}</td>
              <td class="py-3 pr-4">{{ order.requestedAmount }} kWh</td>
              <td class="py-3 pr-4">
                <span class="inline-block px-2 py-1 rounded-md text-[10px] font-bold border" :class="statusColor[order.status]">
                  {{ statusLabel[order.status] }}
                </span>
              </td>
              <td class="py-3 pr-4 font-mono">{{ order.assignedPileId ?? '--' }}</td>
              <td class="py-3 pr-4 text-slate-500">{{ formatTime(order.submitTime) }}</td>
              <td class="py-3">
                <button class="px-3 py-1.5 bg-white border border-slate-200 rounded-md text-slate-700 hover:bg-slate-50 font-bold" @click="selectOrder(order)">
                  查看
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
      <h3 class="text-sm font-bold text-slate-900 uppercase tracking-wider mb-5">充电详单</h3>
      <div v-if="details.length === 0" class="text-sm text-slate-500 py-8 text-center border border-dashed border-slate-200 rounded-lg">
        暂无详单记录
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead>
            <tr class="border-b border-slate-200 text-slate-500 uppercase tracking-wider">
              <th class="py-3 pr-4">详单编号</th>
              <th class="py-3 pr-4">排队号</th>
              <th class="py-3 pr-4">状态</th>
              <th class="py-3 pr-4">充电桩</th>
              <th class="py-3 pr-4">电量</th>
              <th class="py-3 pr-4">时长</th>
              <th class="py-3 pr-4">充电费</th>
              <th class="py-3 pr-4">服务费</th>
              <th class="py-3">总费用</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in details" :key="row.detailId" class="border-b border-slate-100 hover:bg-slate-50">
              <td class="py-3 pr-4 font-mono">{{ row.detailId }}</td>
              <td class="py-3 pr-4 font-mono">{{ row.queueNo }}</td>
              <td class="py-3 pr-4">
                <span class="inline-block px-2 py-1 rounded-md text-[10px] font-bold border" :class="statusColor[row.status]">
                  {{ statusLabel[row.status] }}
                </span>
              </td>
              <td class="py-3 pr-4 font-mono">{{ row.pileId ?? '--' }}</td>
              <td class="py-3 pr-4">{{ formatNumber(row.actualAmount, 4) }} kWh</td>
              <td class="py-3 pr-4">{{ formatNumber(row.duration, 4) }} h</td>
              <td class="py-3 pr-4">{{ formatNumber(row.chargeFee) }}</td>
              <td class="py-3 pr-4">{{ formatNumber(row.serviceFee) }}</td>
              <td class="py-3 font-bold text-emerald-600">{{ formatNumber(row.totalFee) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
