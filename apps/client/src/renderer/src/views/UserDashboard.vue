<template>
  <div class="page-grid">
    <section class="panel">
      <h2>提交充电请求</h2>
      <el-form label-width="96px">
        <el-form-item label="充电模式">
          <el-radio-group v-model="requestForm.chargeMode">
            <el-radio-button label="FAST">快充</el-radio-button>
            <el-radio-button label="SLOW">慢充</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="请求电量">
          <el-input-number v-model="requestForm.requestedAmount" :min="1" :step="5" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="submitRequest">提交请求</el-button>
          <el-button @click="queryQueue">查询排队</el-button>
        </el-form-item>
      </el-form>
    </section>

    <section class="panel">
      <h2>当前订单</h2>
      <div class="status-row">
        <el-tag>排队号：{{ queueStatus.queueNo }}</el-tag>
        <el-tag type="info">状态：{{ queueStatus.status }}</el-tag>
        <el-tag type="warning">前车：{{ queueStatus.aheadCount }}</el-tag>
      </div>
      <el-divider />
      <el-button-group>
        <el-button @click="startCharging">开始充电</el-button>
        <el-button type="success" @click="stopCharging">结束充电</el-button>
        <el-button type="danger" @click="cancelCharging">取消充电</el-button>
      </el-button-group>
    </section>

    <section class="panel full">
      <h2>充电详单</h2>
      <el-table :data="details" border>
        <el-table-column prop="detailId" label="详单编号" />
        <el-table-column prop="pileId" label="充电桩" />
        <el-table-column prop="actualAmount" label="充电电量" />
        <el-table-column prop="duration" label="充电时长" />
        <el-table-column prop="chargeFee" label="充电费" />
        <el-table-column prop="serviceFee" label="服务费" />
        <el-table-column prop="totalFee" label="总费用" />
      </el-table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { http } from '@/api/http'

const requestForm = reactive({
  chargeMode: 'FAST',
  requestedAmount: 30
})

const queueStatus = reactive({
  orderId: '未生成',
  queueNo: '--',
  status: 'WAITING',
  aheadCount: 0
})

const details = ref([
  {
    detailId: 'D-demo',
    pileId: 'F01',
    actualAmount: 20,
    duration: 0.67,
    chargeFee: 14,
    serviceFee: 16,
    totalFee: 30
  }
])

async function submitRequest() {
  try {
    const { data } = await http.post('/charging/request', requestForm)
    Object.assign(queueStatus, data)
  } catch {
    queueStatus.orderId = 'demo-order'
    queueStatus.queueNo = requestForm.chargeMode === 'FAST' ? 'F1' : 'T1'
    queueStatus.status = 'WAITING'
  }
  ElMessage.success('充电请求已提交')
}

async function queryQueue() {
  if (!queueStatus.orderId || queueStatus.orderId === '未生成') {
    ElMessage.warning('请先提交充电请求')
    return
  }
  await http.get(`/charging/${queueStatus.orderId}/queue`).catch(() => undefined)
  ElMessage.info('已刷新排队状态')
}

function startCharging() {
  queueStatus.status = 'CHARGING'
  ElMessage.success('开始充电')
}

function stopCharging() {
  queueStatus.status = 'FINISHED'
  ElMessage.success('充电结束，已生成详单')
}

function cancelCharging() {
  queueStatus.status = queueStatus.status === 'CHARGING' ? 'FINISHED' : 'CANCELED'
  ElMessage.warning('取消流程已触发')
}
</script>
