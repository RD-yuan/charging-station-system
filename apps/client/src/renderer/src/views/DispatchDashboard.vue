<template>
  <div class="page-grid">
    <section class="panel">
      <h2>单次最优时长调度</h2>
      <el-form label-width="96px">
        <el-form-item label="空位数量">
          <el-input-number v-model="singleForm.spotsCount" :min="1" />
        </el-form-item>
        <el-form-item label="充电模式">
          <el-radio-group v-model="singleForm.mode">
            <el-radio-button label="FAST">快充</el-radio-button>
            <el-radio-button label="SLOW">慢充</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="runSingle">运行</el-button>
        </el-form-item>
      </el-form>
    </section>

    <section class="panel">
      <h2>批量最优时长调度</h2>
      <el-alert
        title="批量调度按需求不传 mode，不区分快充和慢充。"
        type="info"
        show-icon
        :closable="false"
      />
      <el-form label-width="96px" style="margin-top: 16px">
        <el-form-item label="车辆数量">
          <el-input-number v-model="batchForm.spotsCount" :min="1" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="runBatch">运行</el-button>
        </el-form-item>
      </el-form>
    </section>

    <section class="panel full">
      <h2>调度结果</h2>
      <el-table :data="results" border>
        <el-table-column prop="orderId" label="订单" />
        <el-table-column prop="queueNo" label="排队号" />
        <el-table-column prop="pileId" label="目标桩" />
        <el-table-column prop="projectedFinishTime" label="预计完成时长" />
      </el-table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { http } from '@/api/http'

const singleForm = reactive({ spotsCount: 2, mode: 'FAST' })
const batchForm = reactive({ spotsCount: 10 })
const results = ref<Array<{ orderId: string; queueNo: string; pileId: string; projectedFinishTime: number }>>([])

async function runSingle() {
  const { data } = await http.post('/admin/optimization/single', singleForm)
  results.value = data.assignments ?? []
  ElMessage.success('单次最优调度已提交')
}

async function runBatch() {
  const { data } = await http.post('/admin/optimization/batch', batchForm)
  results.value = data.assignments ?? []
  ElMessage.success('批量最优调度已提交')
}
</script>
