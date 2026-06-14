<template>
  <div class="page-grid">
    <section class="panel">
      <h2>用户登录</h2>
      <el-form label-width="96px">
        <el-form-item label="用户名">
          <el-input v-model="authForm.username" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="authForm.password" type="password" show-password />
        </el-form-item>
        <el-form-item label="电池容量">
          <el-input-number v-model="authForm.batteryCapacity" :min="1" :step="5" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="login">登录</el-button>
          <el-button @click="register">注册</el-button>
          <el-tag v-if="session.userId" type="success">已登录：{{ session.username }}</el-tag>
        </el-form-item>
      </el-form>
    </section>

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
          <el-button @click="modifyMode">修改模式</el-button>
          <el-button @click="modifyAmount">修改电量</el-button>
        </el-form-item>
      </el-form>
    </section>

    <section class="panel">
      <h2>当前订单</h2>
      <div class="status-row">
        <el-tag>排队号：{{ queueStatus.queueNo }}</el-tag>
        <el-tag type="info">状态：{{ queueStatus.status }}</el-tag>
        <el-tag type="success">区域：{{ queueStatus.queueArea }}</el-tag>
        <el-tag type="warning">前车：{{ queueStatus.aheadCount }}</el-tag>
        <el-tag type="warning">预计等待：{{ queueStatus.estimatedWaitTime }} 分钟</el-tag>
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

const authForm = reactive({
  username: localStorage.getItem('username') ?? 'user_01',
  password: 'password123',
  batteryCapacity: 60
})

const session = reactive({
  userId: localStorage.getItem('user_id') ?? '',
  username: localStorage.getItem('username') ?? ''
})

const requestForm = reactive({
  chargeMode: 'FAST',
  requestedAmount: 30
})

const queueStatus = reactive({
  orderId: '未生成',
  queueNo: '--',
  status: 'WAITING',
  queueArea: '--',
  aheadCount: 0,
  estimatedWaitTime: 0
})

const details = ref<Array<Record<string, unknown>>>([])

async function register() {
  const { data } = await http.post('/user/register', authForm)
  setSession(data)
  ElMessage.success('注册成功')
}

async function login() {
  const { data } = await http.post('/user/login', {
    username: authForm.username,
    password: authForm.password
  })
  setSession(data)
  ElMessage.success('登录成功')
}

async function submitRequest() {
  if (!session.userId) {
    ElMessage.warning('请先登录')
    return
  }
  const { data } = await http.post('/user/charging/request', {
    userId: session.userId,
    ...requestForm
  })
  Object.assign(queueStatus, data)
  ElMessage.success('充电请求已提交')
}

async function queryQueue() {
  if (!queueStatus.orderId || queueStatus.orderId === '未生成') {
    ElMessage.warning('请先提交充电请求')
    return
  }
  const { data } = await http.get(`/user/charging/${queueStatus.orderId}/queue`)
  Object.assign(queueStatus, data)
  ElMessage.info('已刷新排队状态')
}

async function modifyMode() {
  if (!hasOrder()) return
  const { data } = await http.put(`/user/charging/${queueStatus.orderId}/mode`, {
    newMode: requestForm.chargeMode
  })
  Object.assign(queueStatus, data)
  ElMessage.success('充电模式已修改')
}

async function modifyAmount() {
  if (!hasOrder()) return
  const { data } = await http.put(`/user/charging/${queueStatus.orderId}/amount`, {
    newAmount: requestForm.requestedAmount
  })
  Object.assign(queueStatus, data)
  ElMessage.success('请求电量已修改')
}

async function startCharging() {
  if (!hasOrder()) return
  const { data } = await http.post(`/user/charging/${queueStatus.orderId}/start`)
  queueStatus.status = data.status
  ElMessage.success('开始充电')
}

async function stopCharging() {
  if (!hasOrder()) return
  const { data } = await http.post(`/user/charging/${queueStatus.orderId}/stop`)
  queueStatus.status = 'FINISHED'
  details.value.unshift(data)
  ElMessage.success('充电结束，已生成详单')
}

async function cancelCharging() {
  if (!hasOrder()) return
  const { data } = await http.post(`/user/charging/${queueStatus.orderId}/cancel`, {
    reason: queueStatus.status === 'CHARGING' ? 'USER_STOP' : 'USER_CANCEL'
  })
  if (data.detailId) {
    queueStatus.status = 'FINISHED'
    details.value.unshift(data)
  } else {
    Object.assign(queueStatus, data)
  }
  ElMessage.warning('取消流程已触发')
}

function setSession(data: { accessToken: string; userId: string; username: string }) {
  session.userId = data.userId
  session.username = data.username
  localStorage.setItem('access_token', data.accessToken)
  localStorage.setItem('user_id', data.userId)
  localStorage.setItem('username', data.username)
}

function hasOrder() {
  if (!queueStatus.orderId || queueStatus.orderId === '未生成') {
    ElMessage.warning('请先提交充电请求')
    return false
  }
  return true
}
</script>
