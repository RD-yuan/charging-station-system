<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiRequest } from '../api/http'

type PortalMode = 'user' | 'admin'

const route = useRoute()
const router = useRouter()

const mode = ref<PortalMode>(route.query.mode === 'admin' ? 'admin' : 'user')
const username = ref(mode.value === 'admin' ? 'admin' : 'user_01')
const password = ref(mode.value === 'admin' ? 'admin888' : 'password123')
const batteryCapacity = ref(60)
const errorMsg = ref('')
const successMsg = ref('')
const isLoading = ref(false)

const isUserMode = computed(() => mode.value === 'user')

watch(
  () => route.query.mode,
  (value) => {
    mode.value = value === 'admin' ? 'admin' : 'user'
  }
)

function switchMode(next: PortalMode) {
  mode.value = next
  errorMsg.value = ''
  successMsg.value = ''
  router.replace({ path: '/auth', query: { mode: next } })
}

async function handleLogin(e: Event) {
  e.preventDefault()
  errorMsg.value = ''
  successMsg.value = ''
  isLoading.value = true

  try {
    if (isUserMode.value) {
      const result = await apiRequest<{ accessToken: string; userId: string; username: string }>(
        '/user/login',
        {
          method: 'POST',
          body: JSON.stringify({
            username: username.value.trim(),
            password: password.value
          })
        },
        'user'
      )
      localStorage.setItem('access_token', result.accessToken)
      localStorage.setItem('user_id', result.userId)
      localStorage.setItem('username', result.username)
      await router.push('/user')
      return
    }

    const result = await apiRequest<{ accessToken: string; adminName: string }>('/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: username.value.trim(),
        password: password.value
      })
    })
    localStorage.setItem('admin_access_token', result.accessToken)
    localStorage.setItem('admin_name', result.adminName || username.value.trim())
    await router.push('/admin')
  } catch {
    errorMsg.value = isUserMode.value
      ? '用户登录失败，请检查用户名和密码'
      : '管理员用户名或密码不正确（默认：admin / admin888）'
  } finally {
    isLoading.value = false
  }
}

async function handleRegister(e: Event) {
  e.preventDefault()
  errorMsg.value = ''
  successMsg.value = ''
  isLoading.value = true

  try {
    const result = await apiRequest<{ accessToken: string; userId: string; username: string }>(
      '/user/register',
      {
        method: 'POST',
        body: JSON.stringify({
          username: username.value.trim(),
          password: password.value,
          batteryCapacity: batteryCapacity.value
        })
      },
      'user'
    )
    localStorage.setItem('access_token', result.accessToken)
    localStorage.setItem('user_id', result.userId)
    localStorage.setItem('username', result.username)
    successMsg.value = '注册成功，正在进入用户端...'
    setTimeout(() => void router.push('/user'), 600)
  } catch {
    errorMsg.value = '注册失败，用户名可能已存在'
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-slate-950 flex flex-col justify-center items-center px-4 relative overflow-hidden font-sans">
    <div class="absolute top-0 left-0 w-full h-full pointer-events-none z-0 overflow-hidden">
      <div class="absolute top-[-20%] left-[-10%] w-[50vw] h-[50vw] bg-emerald-500/5 rounded-full blur-[120px]"></div>
      <div class="absolute bottom-[-20%] right-[-10%] w-[50vw] h-[50vw] bg-blue-500/5 rounded-full blur-[120px]"></div>
    </div>

    <div class="w-full max-w-md relative z-10 space-y-4">
      <div class="flex p-1 bg-slate-900/80 border border-slate-800 rounded-xl backdrop-blur-md">
        <button
          type="button"
          class="flex-1 py-2.5 text-xs font-bold rounded-lg transition-all"
          :class="isUserMode ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20' : 'text-slate-400 hover:text-slate-200'"
          @click="switchMode('user')"
        >
          用户端
        </button>
        <button
          type="button"
          class="flex-1 py-2.5 text-xs font-bold rounded-lg transition-all"
          :class="!isUserMode ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20' : 'text-slate-400 hover:text-slate-200'"
          @click="switchMode('admin')"
        >
          管理端
        </button>
      </div>

      <div class="bg-slate-900/80 border border-slate-800/80 p-8 rounded-2xl shadow-2xl backdrop-blur-md">
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center bg-emerald-500 text-slate-900 p-3 rounded-2xl mb-4 font-bold shadow-lg shadow-emerald-500/10">
            <svg v-if="isUserMode" xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12" y1="16" y2="16"/></svg>
          </div>
          <h2 class="text-2xl font-bold text-white tracking-tight leading-tight">
            {{ isUserMode ? '智能充电用户服务' : '调度与计费管理后台' }}
          </h2>
          <p class="text-xs text-slate-400 mt-2 font-mono">
            {{ isUserMode ? 'Charging User Portal' : 'Admin Console Portal' }}
          </p>
        </div>

        <form class="space-y-5" @submit="handleLogin">
          <div>
            <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">用户名</label>
            <input
              v-model="username"
              type="text"
              required
              class="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500/80 rounded-xl py-3 px-4 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 transition-all font-mono"
              :placeholder="isUserMode ? '请输入用户账户' : '请输入管理员账户'"
            />
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">密码</label>
            <input
              v-model="password"
              type="password"
              required
              class="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500/80 rounded-xl py-3 px-4 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 transition-all font-mono"
              placeholder="请输入密码"
            />
          </div>

          <div v-if="isUserMode">
            <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">电池容量 (kWh)</label>
            <input
              v-model.number="batteryCapacity"
              type="number"
              min="1"
              step="5"
              class="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500/80 rounded-xl py-3 px-4 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 transition-all font-mono"
            />
            <p class="text-[10px] text-slate-500 mt-1.5">注册时使用，登录可忽略</p>
          </div>

          <div v-if="errorMsg" class="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400">
            {{ errorMsg }}
          </div>
          <div v-if="successMsg" class="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-400">
            {{ successMsg }}
          </div>

          <div class="flex gap-3 pt-1">
            <button
              type="submit"
              :disabled="isLoading"
              class="flex-1 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold py-3.5 px-4 rounded-xl text-xs tracking-wider uppercase shadow-lg shadow-emerald-500/15 transition-all"
            >
              {{ isLoading ? '处理中...' : isUserMode ? '登录' : '进入管理面板' }}
            </button>
            <button
              v-if="isUserMode"
              type="button"
              :disabled="isLoading"
              class="flex-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-100 font-bold py-3.5 px-4 rounded-xl text-xs tracking-wider uppercase border border-slate-700 transition-all"
              @click="handleRegister"
            >
              注册
            </button>
          </div>
        </form>

        <div class="mt-8 pt-6 border-t border-slate-800/80 text-[11px] text-slate-500 leading-relaxed space-y-2">
          <p v-if="isUserMode">用户端：支持注册与登录，可提交充电请求、查询排队、开始/结束充电。</p>
          <template v-else>
            <p>管理端<strong class="text-slate-400">不提供自助注册</strong>，管理员账号由系统预置（数据库 seed）。</p>
            <p>演示账户：<strong class="text-slate-400">admin</strong> / <strong class="text-slate-400">admin888</strong></p>
          </template>
          <p class="text-slate-600">统一入口，可在上方按钮切换用户端与管理端。</p>
        </div>
      </div>
    </div>
  </div>
</template>
