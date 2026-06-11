<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits(['login-success'])

const username = ref('admin')
const password = ref('admin888')
const errorMsg = ref('')
const isLoading = ref(false)

const handleLogin = (e: Event) => {
  e.preventDefault()
  errorMsg.value = ''
  isLoading.value = true

  // Simulate call to Node/Nest backend
  setTimeout(() => {
    isLoading.value = false
    if (username.value.trim() === 'admin' && password.value === 'admin888') {
      emit('login-success', username.value.trim())
    } else {
      errorMsg.value = '管理员用户名或密码不正确（默认：admin / admin888）'
    }
  }, 800)
}
</script>

<template>
  <div class="min-h-screen bg-slate-950 flex flex-col justify-center items-center px-4 relative overflow-hidden font-sans" id="login-container">
    <!-- Abstract Tech Ambient Background -->
    <div class="absolute top-0 left-0 w-full h-full pointer-events-none z-0 overflow-hidden">
      <div class="absolute top-[-20%] left-[-10%] w-[50vw] h-[50vw] bg-emerald-500/5 rounded-full blur-[120px]"></div>
      <div class="absolute bottom-[-20%] right-[-10%] w-[50vw] h-[50vw] bg-blue-500/5 rounded-full blur-[120px]"></div>
    </div>

    <!-- Login card wrapper -->
    <div class="w-full max-w-md bg-slate-900/80 border border-slate-800/80 p-8 rounded-2xl shadow-2xl backdrop-blur-md relative z-10" id="login-card">
      <div class="text-center mb-8">
        <div class="inline-flex items-center justify-center bg-emerald-500 text-slate-900 p-3 rounded-2xl mb-4 font-bold shadow-lg shadow-emerald-500/10">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-shield-alert animate-pulse"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12" y1="16" y2="16"/></svg>
        </div>
        <h2 class="text-2xl font-bold text-white tracking-tight leading-tight">调度与计费管理后台</h2>
        <p class="text-xs text-slate-400 mt-2 font-mono">充电系统管理员门户 (Admin Portal)</p>
      </div>

      <form @submit="handleLogin" class="space-y-5">
        <div>
          <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">用户名</label>
          <div class="relative">
            <span class="absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </span>
            <input 
              type="text" 
              v-model="username"
              required
              class="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500/80 rounded-xl py-3 pl-11 pr-4 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 transition-all font-mono"
              placeholder="请输入管理员账户"
            />
          </div>
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">密码</label>
          <div class="relative">
            <span class="absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-lock"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </span>
            <input 
              type="password" 
              v-model="password"
              required
              class="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500/80 rounded-xl py-3 pl-11 pr-4 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 transition-all font-mono"
              placeholder="请输入管理员密码"
            />
          </div>
        </div>

        <div v-if="errorMsg" class="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-start gap-2.5">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-alert-triangle shrink-0 text-rose-400 mt-0.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12" y1="17" y2="17"/></svg>
          <span class="leading-relaxed">{{ errorMsg }}</span>
        </div>

        <button 
          type="submit"
          :disabled="isLoading"
          class="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold py-3.5 px-4 rounded-xl text-xs tracking-wider uppercase shadow-lg shadow-emerald-500/15 hover:shadow-emerald-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer mt-2"
        >
          <span v-if="isLoading" class="animate-spin rounded-full h-4 w-4 border-2 border-slate-950 border-t-transparent"></span>
          <span>{{ isLoading ? '正在验证接口...' : '进入管理员面板' }}</span>
        </button>
      </form>

      <!-- Tip notes for defense and setup -->
      <div class="mt-8 pt-6 border-t border-slate-800/80 flex flex-col gap-2 rounded text-[11px] text-slate-500 leading-relaxed">
        <p class="flex items-center gap-1.5">
          <span class="h-1.5 w-1.5 rounded-full bg-slate-600"></span>
          <span>演示账户: <strong class="text-slate-400">admin</strong> 密码: <strong class="text-slate-400">admin888</strong></span>
        </p>
        <p class="flex items-center gap-1.5">
          <span class="h-1.5 w-1.5 rounded-full bg-emerald-500/40"></span>
          <span>与 NestJS 后端鉴权服务完全一致</span>
        </p>
      </div>
    </div>
  </div>
</template>
