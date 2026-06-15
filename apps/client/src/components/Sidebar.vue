<script setup lang="ts">
interface SidebarProps {
  currentTab: string
  adminName: string | null
}

defineProps<SidebarProps>()
const emit = defineEmits(['update:currentTab', 'logout'])

const menuItems = [
  { id: 'dashboard', label: '控制台概览', icon: 'LayoutDashboard' },
  { id: 'monitor', label: '电桩状态监控', icon: 'Zap' },
  { id: 'reports', label: '运营统计报表', icon: 'BarChart3' },
  { id: 'websocket', label: 'WebSocket 协同', icon: 'Terminal' },
]

const selectTab = (id: string) => {
  emit('update:currentTab', id)
}
</script>

<template>
  <aside class="w-64 bg-slate-900 text-white flex flex-col shrink-0 border-r border-slate-800" id="sidebar-panel">
    <!-- Brand Header -->
    <div class="p-6 border-b border-slate-800 flex items-center gap-3">
      <div class="bg-emerald-500 text-slate-900 p-2 rounded-lg flex items-center justify-center">
        <!-- Lucide Icon mock via Tailwind / CSS standard icon or pure svg -->
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zap h-5 w-5 fill-emerald-900 text-slate-900"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
      </div>
      <div>
        <h1 class="font-bold text-sm leading-tight text-white">智能充电调度系统</h1>
        <p class="text-[10px] text-slate-400 font-mono tracking-wider">ADMIN CONSOLE v1.1</p>
      </div>
    </div>

    <!-- User Session Info -->
    <div v-if="adminName" class="p-4 mx-4 my-3 bg-slate-800/40 rounded-xl border border-slate-800/60 flex items-center gap-3">
      <div class="h-8 w-8 rounded-full bg-slate-700 flex items-center justify-center font-mono text-xs font-bold text-emerald-400">
        {{ adminName.substring(0, 1).toUpperCase() }}
      </div>
      <div class="flex-1 overflow-hidden">
        <p class="text-xs font-medium text-slate-200 truncate">{{ adminName }}</p>
        <p class="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
          <span class="h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
          管理员 (Online)
        </p>
      </div>
      <button 
        @click="emit('logout')"
        title="退出登录" 
        class="text-slate-400 hover:text-rose-400 p-1 rounded hover:bg-slate-800 transition-all cursor-pointer"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-log-out h-4 w-4"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
      </button>
    </div>

    <!-- Navigation Links -->
    <nav class="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
      <button
        v-for="item in menuItems"
        :key="item.id"
        @click="selectTab(item.id)"
        :class="`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-xs font-medium tracking-wide transition-all duration-200 cursor-pointer ${
          currentTab === item.id
            ? 'bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/10'
            : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
        }`"
      >
        <!-- Icon rendering mapping -->
        <span class="shrink-0 h-4 w-4">
          <svg v-if="item.id === 'dashboard'" xmlns="http://www.w3.org/2050/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="10" rx="1"/><rect width="7" height="5" x="3" y="14" rx="1"/></svg>
          <svg v-else-if="item.id === 'monitor'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          <svg v-else-if="item.id === 'reports'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg>
          <svg v-else-if="item.id === 'websocket'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>
        </span>
        <span>{{ item.label }}</span>

        <span v-if="item.id === 'websocket'" class="ml-auto text-[9px] font-bold bg-slate-800 text-emerald-400 px-1.5 py-0.5 rounded-full border border-slate-700">
          Live
        </span>
      </button>
    </nav>

    <!-- Footer Branding -->
    <div class="p-4 border-t border-slate-800 text-center text-[10px] text-slate-500 font-mono">
      <p>© 2026 统一客户端</p>
      <p class="text-[9px] mt-0.5 text-slate-600">用户端 / 管理端</p>
    </div>
  </aside>
</template>
