<script setup lang="ts">
import { ref } from 'vue'
import { apiRequest } from '../api/http'

interface ExpectedCell {
  rowIndex: number
  col: number
  expected: string
  actual: string | null
  pass: boolean | null
  diff: string | null
}

interface ReportRow {
  rowIndex: number
  time: string
  event: string
  actionLabel: string
  apiCalled: string
  apiStatus: 'OK' | 'ERROR' | 'SKIPPED'
  apiMessage: string
  pilesActual: string
  waitingActual: string
  expectedSamples: ExpectedCell[]
}

interface Report {
  startedAt: string
  finishedAt: string
  totalEvents: number
  executedEvents: number
  skippedEvents: number
  erroredEvents: number
  rows: ReportRow[]
  summary: {
    expectedCells: number
    passedCells: number
    failedCells: number
    passRate: string
  }
}

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  `${location.protocol}//${location.hostname}:3000/api`
const selectedFile = ref<File | null>(null)
const running = ref(false)
const error = ref('')
const report = ref<Report | null>(null)
const downloadUrl = ref<string>('')
const downloadBlob = ref<Blob | null>(null)
const downloadFilename = ref<string>('验收结果.xlsx')
const stopAtLimit = ref(true)
const filterMode = ref<'all' | 'fail' | 'sample'>('all')

function onFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  selectedFile.value = target.files?.[0] ?? null
}

async function runTests() {
  error.value = ''
  report.value = null
  if (downloadUrl.value) {
    URL.revokeObjectURL(downloadUrl.value)
    downloadUrl.value = ''
  }
  running.value = true
  try {
    const token = localStorage.getItem('admin_access_token') ?? ''
    const formData = new FormData()
    if (selectedFile.value) {
      formData.append('file', selectedFile.value)
    }
    formData.append('stopAtLimit', stopAtLimit.value ? 'true' : 'false')

    const response = await fetch(`${API_BASE_URL}/admin/acceptance/run`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: formData
    })
    if (!response.ok) {
      const text = await response.text()
      let message = text
      try {
        const json = JSON.parse(text)
        message = Array.isArray(json.message) ? json.message.join('；') : json.message ?? text
      } catch {
        // keep raw
      }
      throw new Error(message || `HTTP ${response.status}`)
    }

    const payload = (await response.json()) as {
      report: Report
      filename: string
      excelBase64: string
    }
    report.value = payload.report
    const binary = atob(payload.excelBase64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    downloadBlob.value = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
    downloadUrl.value = URL.createObjectURL(downloadBlob.value)
    downloadFilename.value = payload.filename
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    running.value = false
  }
}

const demoLoading = ref(false)
const demoStatus = ref('点击按钮在现有订单上触发扩展调度策略，对比总完工时间')

async function runSingleOptimalDemo() {
  demoLoading.value = true
  demoStatus.value = '正在执行单次最优调度完整演示（清场→创建场景→调度→对比）...'
  try {
    const res = await apiRequest<{
      strategy: string
      scenario: string
      expected: Array<{ vehicle: string; pile: string; finishTime: number }>
      actual: Array<{ vehicle: string; pile: string; finishTime: number }>
      expectedTotal: number
      actualTotal: number
      pass: boolean
    }>('/admin/acceptance/demo-single-optimal', { method: 'POST' }, 'admin')
    const exp = res.expected.map((e) => `${e.vehicle}→${e.pile}(${e.finishTime}h)`).join(', ')
    const act = res.actual.map((a) => `${a.vehicle}→${a.pile}(${a.finishTime}h)`).join(', ')
    demoStatus.value = `[a] ${res.pass ? '✓ 通过' : '✗ 差异'} | 期望总完工 ${res.expectedTotal.toFixed(2)}h | 实际 ${res.actualTotal.toFixed(2)}h
       期望: ${exp}
       实际: ${act}`
  } catch (err) {
    demoStatus.value = `失败：${err instanceof Error ? err.message : String(err)}`
  } finally {
    demoLoading.value = false
  }
}

async function runBatchOptimalDemo() {
  demoLoading.value = true
  demoStatus.value = '正在执行批量最优调度完整演示（25 辆车场景）...'
  try {
    const res = await apiRequest<{
      strategy: string
      scenario: string
      expected: Array<{ vehicle: string; pile: string; finishTime: number; inWaiting?: boolean }>
      actual: Array<{ vehicle: string; pile: string; finishTime: number; inWaiting?: boolean }>
      expectedTotal: number
      actualTotal: number
      pass: boolean
    }>('/admin/acceptance/demo-batch-optimal', { method: 'POST' }, 'admin')
    const expAssigned = res.expected.filter((e) => !e.inWaiting)
    const actAssigned = res.actual.filter((a) => !a.inWaiting)
    const expWaiting = res.expected.filter((e) => e.inWaiting).map((e) => e.vehicle).join(',')
    const actWaiting = res.actual.filter((a) => a.inWaiting).map((a) => a.vehicle).join(',')
    demoStatus.value = `[b] ${res.pass ? '✓ 通过' : '✗ 差异'} | 派出 ${actAssigned.length}/${expAssigned.length} | 期望总完工 ${res.expectedTotal.toFixed(2)}h | 实际 ${res.actualTotal.toFixed(2)}h
       期望等候区(10): ${expWaiting}
       实际等候区(${res.actual.filter((a) => a.inWaiting).length}): ${actWaiting}`
  } catch (err) {
    demoStatus.value = `失败：${err instanceof Error ? err.message : String(err)}`
  } finally {
    demoLoading.value = false
  }
}

async function resetWorld() {
  error.value = ''
  try {
    await apiRequest<{ ok: boolean; message: string }>('/admin/acceptance/reset', {
      method: 'POST',
      body: '{}'
    })
    report.value = null
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

const filteredRows = () => {
  if (!report.value) return []
  if (filterMode.value === 'fail') {
    return report.value.rows.filter((r) => r.apiStatus === 'ERROR' || r.expectedSamples.some((s) => s.pass === false))
  }
  if (filterMode.value === 'sample') {
    return report.value.rows.filter((r) => r.expectedSamples.length > 0)
  }
  return report.value.rows
}

function statusClass(status: string) {
  if (status === 'OK') return 'bg-emerald-100 text-emerald-700 border-emerald-200'
  if (status === 'ERROR') return 'bg-rose-100 text-rose-700 border-rose-200'
  return 'bg-slate-100 text-slate-600 border-slate-200'
}
</script>

<template>
  <div class="space-y-5">
    <div class="panel p-6">
      <div class="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 class="text-lg font-semibold text-slate-800">作业验收自动化测试</h2>
          <p class="text-xs text-slate-500 mt-1">
            读取 <span class="font-mono">作业验收用例.xlsx</span>，按时间线驱动真实 API 完成调度/计费/修改/故障/恢复，并把实际结果写回 Excel，与样本逐项对比。
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="resetWorld"
            :disabled="running"
            class="min-h-11 px-3 py-2 text-xs font-semibold rounded-lg border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-50 transition-colors"
          >
            清空数据
          </button>
          <button
            @click="runTests"
            :disabled="running"
            class="btn-primary"
          >
            {{ running ? '运行中…' : '运行测试用例' }}
          </button>
        </div>
      </div>

      <div class="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <label class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 flex flex-col gap-1.5">
          <span class="text-slate-600">上传用例 Excel（可选）</span>
          <input
            type="file"
            accept=".xlsx"
            @change="onFileChange"
            class="text-[11px] text-slate-700 file:mr-3 file:rounded file:border-0 file:bg-emerald-500 file:px-2 file:py-1 file:text-white"
          />
          <span class="text-[10px] text-slate-400">未上传时使用工程根目录的 作业验收用例.xlsx</span>
        </label>
        <label class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 flex items-center gap-2">
          <input type="checkbox" v-model="stopAtLimit" />
          <span>按说明停在 9:30（仅执行 6:00–9:30 事件）</span>
        </label>
        <div class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <div class="text-[11px] font-bold text-amber-900 mb-1">扩展调度演示（PS 选做）</div>
          <div class="flex gap-2">
            <button
            class="min-h-10 px-3 py-2 bg-amber-500 hover:bg-amber-400 text-white text-[11px] font-bold rounded-lg disabled:opacity-40 transition-colors"
              :disabled="demoLoading"
              @click="runSingleOptimalDemo"
            >a) 单次最优调度(FAST)</button>
            <button
            class="min-h-10 px-3 py-2 bg-orange-500 hover:bg-orange-400 text-white text-[11px] font-bold rounded-lg disabled:opacity-40 transition-colors"
              :disabled="demoLoading"
              @click="runBatchOptimalDemo"
            >b) 批量最优调度</button>
          </div>
          <p class="text-[10px] text-amber-800 mt-1">{{ demoStatus }}</p>
        </div>
        <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          <p>事件语义（5 分钟一格，E=(类型,id,充电类型,数值)）：</p>
          <p>· <code>A,V*,F/T,度</code> → 申请充电（F=快/T=慢）</p>
          <p>· <code>A,V*,O,0</code> → 取消充电</p>
          <p>· <code>B,F#/T#,O,0</code> → 桩故障；<code>,1</code> → 恢复</p>
          <p>· <code>C,V*,F/T,度|-1</code> → 改类型 + 改电量（-1=不变）</p>
          <p>· <code>C,V*,O,度|-1</code> → 仅改电量（O=类型不变）</p>
        </div>
      </div>

      <p v-if="error" class="mt-3 text-xs text-rose-600">{{ error }}</p>
    </div>

    <div v-if="report" class="panel p-6">
      <div class="flex items-center justify-between flex-wrap gap-3">
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs flex-1">
          <div class="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
            <p class="text-slate-500">总事件</p>
            <p class="text-base font-semibold text-slate-800">{{ report.totalEvents }}</p>
          </div>
          <div class="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
            <p class="text-emerald-700">成功</p>
            <p class="text-base font-semibold text-emerald-800">{{ report.executedEvents }}</p>
          </div>
          <div class="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2">
            <p class="text-rose-700">错误</p>
            <p class="text-base font-semibold text-rose-800">{{ report.erroredEvents }}</p>
          </div>
          <div class="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
            <p class="text-slate-500">跳过</p>
            <p class="text-base font-semibold text-slate-800">{{ report.skippedEvents }}</p>
          </div>
          <div class="rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-2">
            <p class="text-indigo-700">样本通过率</p>
            <p class="text-base font-semibold text-indigo-800">
              {{ report.summary.passedCells }}/{{ report.summary.expectedCells }}
              <span class="text-xs font-normal">（{{ report.summary.passRate }}）</span>
            </p>
          </div>
        </div>
        <a
          v-if="downloadUrl"
          :href="downloadUrl"
          :download="downloadFilename"
          class="min-h-11 px-3 py-2 text-xs font-semibold rounded-lg border border-emerald-500 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 inline-flex items-center"
        >
          下载结果 Excel
        </a>
      </div>

      <div class="mt-4 flex items-center gap-2 text-xs">
        <span class="text-slate-500">过滤：</span>
        <button
          @click="filterMode = 'all'"
          :class="['min-h-10 px-3 py-1 rounded-lg border text-xs font-semibold transition-colors', filterMode === 'all' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-200 text-slate-600']"
        >全部</button>
        <button
          @click="filterMode = 'sample'"
          :class="['min-h-10 px-3 py-1 rounded-lg border text-xs font-semibold transition-colors', filterMode === 'sample' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-200 text-slate-600']"
        >仅有样本</button>
        <button
          @click="filterMode = 'fail'"
          :class="['min-h-10 px-3 py-1 rounded-lg border text-xs font-semibold transition-colors', filterMode === 'fail' ? 'bg-rose-600 text-white border-rose-600' : 'bg-white border-slate-200 text-slate-600']"
        >仅失败</button>
      </div>

      <div class="mt-3 table-wrap rounded-lg border border-slate-200">
        <table class="min-w-full text-[11px]">
          <thead class="bg-slate-50 text-slate-600">
            <tr>
              <th class="px-2 py-2 text-left">时刻</th>
              <th class="px-2 py-2 text-left">事件</th>
              <th class="px-2 py-2 text-left">动作</th>
              <th class="px-2 py-2 text-left">API</th>
              <th class="px-2 py-2 text-left">状态</th>
              <th class="px-2 py-2 text-left">实际桩位/等候区</th>
              <th class="px-2 py-2 text-left">样本对比</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="row in filteredRows()" :key="row.rowIndex" class="hover:bg-slate-50">
              <td class="px-2 py-2 align-top font-mono">{{ row.time }}</td>
              <td class="px-2 py-2 align-top font-mono text-slate-700">{{ row.event }}</td>
              <td class="px-2 py-2 align-top text-slate-700">{{ row.actionLabel }}</td>
              <td class="px-2 py-2 align-top font-mono text-slate-500">{{ row.apiCalled }}<div class="text-[10px] text-slate-400 mt-0.5">{{ row.apiMessage }}</div></td>
              <td class="px-2 py-2 align-top">
                <span :class="['inline-block px-2 py-0.5 rounded border text-[10px] font-mono', statusClass(row.apiStatus)]">{{ row.apiStatus }}</span>
              </td>
              <td class="px-2 py-2 align-top font-mono text-[10px] text-slate-700">
                <div>桩：{{ row.pilesActual || '-' }}</div>
                <div class="mt-1">等候：{{ row.waitingActual || '-' }}</div>
              </td>
              <td class="px-2 py-2 align-top">
                <div v-if="row.expectedSamples.length === 0" class="text-slate-300 text-[10px]">无样本</div>
                <ul v-else class="space-y-1">
                  <li
                    v-for="(cell, idx) in row.expectedSamples"
                    :key="idx"
                    :class="[
                      'px-2 py-1 rounded border text-[10px] font-mono',
                      cell.pass === true ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : cell.pass === false ? 'border-rose-200 bg-rose-50 text-rose-700'
                      : 'border-slate-200 bg-slate-50 text-slate-500'
                    ]"
                  >
                    <div>C{{ cell.col }} {{ cell.pass === true ? '✓' : cell.pass === false ? '✗' : '?' }}</div>
                    <div>预期：{{ cell.expected }}</div>
                    <div>实际：{{ cell.actual ?? '(空)' }}</div>
                    <div v-if="cell.diff" class="text-[10px] text-slate-500 mt-0.5">{{ cell.diff }}</div>
                  </li>
                </ul>
              </td>
            </tr>
            <tr v-if="filteredRows().length === 0">
              <td colspan="7" class="px-3 py-6 text-center text-slate-400">没有符合过滤条件的行</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
