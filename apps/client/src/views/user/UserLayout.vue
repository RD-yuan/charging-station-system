<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import UserDashboard from './UserDashboard.vue'

const router = useRouter()
const username = computed(() => localStorage.getItem('username') ?? '用户')

function logout() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('user_id')
  localStorage.removeItem('username')
  void router.push({ path: '/auth', query: { mode: 'user' } })
}
</script>

<template>
  <div class="min-h-screen bg-slate-100 flex font-sans">
    <aside class="w-64 bg-slate-900 text-white flex flex-col shrink-0 border-r border-slate-800">
      <div class="p-6 border-b border-slate-800 flex items-center gap-3">
        <div class="bg-emerald-500 text-slate-900 p-2 rounded-lg flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>
        </div>
        <div>
          <h1 class="font-bold text-sm leading-tight text-white">智能充电调度系统</h1>
          <p class="text-[10px] text-slate-400 font-mono tracking-wider">USER PORTAL v1.1</p>
        </div>
      </div>

      <div class="p-4 mx-4 my-3 bg-slate-800/40 rounded-xl border border-slate-800/60 flex items-center gap-3">
        <div class="h-8 w-8 rounded-full bg-slate-700 flex items-center justify-center font-mono text-xs font-bold text-emerald-400">
          {{ username.substring(0, 1).toUpperCase() }}
        </div>
        <div class="flex-1 overflow-hidden">
          <p class="text-xs font-medium text-slate-200 truncate">{{ username }}</p>
          <p class="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
            <span class="h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
            用户 (Online)
          </p>
        </div>
        <button
          title="退出登录"
          class="text-slate-400 hover:text-rose-400 p-1 rounded hover:bg-slate-800 transition-all cursor-pointer"
          @click="logout"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
        </button>
      </div>

      <nav class="flex-1 px-3 py-4">
        <div class="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-xs font-bold bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/10">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          <span>充电服务</span>
        </div>
      </nav>

      <div class="p-4 border-t border-slate-800 text-center text-[10px] text-slate-500 font-mono">
        <p>© 2026 统一设计标准</p>
      </div>
    </aside>

    <main class="flex-1 overflow-y-auto p-6 md:p-8 bg-slate-50">
      <div class="max-w-7xl mx-auto">
        <UserDashboard />
      </div>
    </main>
  </div>
</template>
