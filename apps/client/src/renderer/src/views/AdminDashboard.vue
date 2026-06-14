<template>
  <div class="page-grid">
    <section class="panel full">
      <h2>充电桩状态</h2>
      <el-table :data="piles" border>
        <el-table-column prop="pileId" label="桩编号" />
        <el-table-column prop="pileType" label="类型" />
        <el-table-column prop="physicalState" label="物理状态" />
        <el-table-column prop="workingState" label="工作状态" />
        <el-table-column prop="totalChargeCount" label="累计次数" />
        <el-table-column prop="totalChargeAmount" label="累计电量" />
        <el-table-column label="操作" width="260">
          <template #default="{ row }">
            <el-button size="small" @click="powerOn(row.pileId)">启动</el-button>
            <el-button size="small" @click="powerOff(row.pileId)">关闭</el-button>
            <el-button size="small" type="danger" @click="reportFault(row.pileId)">故障</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="panel">
      <h2>故障重调度</h2>
      <el-form label-width="96px">
        <el-form-item label="故障桩">
          <el-input v-model="faultPileId" />
        </el-form-item>
        <el-form-item label="策略">
          <el-radio-group v-model="strategyType">
            <el-radio-button label="PRIORITY">优先级调度</el-radio-button>
            <el-radio-button label="TIME_ORDER">时间顺序调度</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="executeReschedule">执行重调度</el-button>
          <el-button @click="recoverPile">恢复故障桩</el-button>
        </el-form-item>
      </el-form>
    </section>

    <section class="panel">
      <h2>报表展示</h2>
      <el-select v-model="reportType" style="width: 160px">
        <el-option label="日" value="DAY" />
        <el-option label="周" value="WEEK" />
        <el-option label="月" value="MONTH" />
      </el-select>
      <el-table :data="reports" border style="margin-top: 12px">
        <el-table-column prop="pileId" label="桩编号" />
        <el-table-column prop="totalChargeCount" label="次数" />
        <el-table-column prop="totalFee" label="总费用" />
      </el-table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { http } from '@/api/http'

const piles = ref<Array<Record<string, unknown>>>([])

const faultPileId = ref('F01')
const strategyType = ref('PRIORITY')
const reportType = ref('DAY')
const reports = ref<Array<Record<string, unknown>>>([])

onMounted(() => {
  void loadPiles()
  void loadReports()
})

watch(reportType, () => {
  void loadReports()
})

async function loadPiles() {
  const { data } = await http.get('/admin/piles')
  piles.value = data
}

async function loadReports() {
  const { data } = await http.get('/admin/reports', { params: { timeType: reportType.value } })
  reports.value = data
}

async function powerOn(pileId: string) {
  await http.post(`/admin/piles/${pileId}/power-on`)
  await loadPiles()
  ElMessage.success(`${pileId} 已启动`)
}

async function powerOff(pileId: string) {
  await http.post(`/admin/piles/${pileId}/power-off`)
  await loadPiles()
  ElMessage.warning(`${pileId} 已关闭`)
}

async function reportFault(pileId: string) {
  faultPileId.value = pileId
  await http.post(`/admin/piles/${pileId}/fault`)
  await loadPiles()
  ElMessage.error(`${pileId} 故障已上报`)
}

async function executeReschedule() {
  await http.post(`/admin/piles/${faultPileId.value}/reschedule`, {
    strategyType: strategyType.value
  })
  await loadPiles()
  ElMessage.success(`已执行 ${strategyType.value} 重调度`)
}

async function recoverPile() {
  await http.post(`/admin/piles/${faultPileId.value}/recover`)
  await loadPiles()
  ElMessage.success(`${faultPileId.value} 已恢复`)
}
</script>
