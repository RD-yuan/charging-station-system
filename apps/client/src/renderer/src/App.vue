<template>
  <el-container class="app-shell">
    <el-aside width="252px" class="sidebar">
      <div class="brand">
        <div class="brand-mark">EV</div>
        <div>
          <h1>智能充电站</h1>
          <p>调度计费系统</p>
        </div>
      </div>

      <el-menu router :default-active="$route.path" class="nav-menu">
        <el-menu-item index="/user">
          <span>用户客户端</span>
        </el-menu-item>
        <el-menu-item index="/admin">
          <span>管理员客户端</span>
        </el-menu-item>
        <el-menu-item index="/dispatch">
          <span>调度算法面板</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="topbar">
        <div>
          <strong>{{ routeTitle }}</strong>
          <span>Vue3 / Electron 前端框架</span>
        </div>
        <el-tag type="success" effect="plain">API: {{ apiBaseUrl }}</el-tag>
      </el-header>
      <el-main class="content">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api'

const routeTitle = computed(() => {
  if (route.path.startsWith('/admin')) return '管理员客户端'
  if (route.path.startsWith('/dispatch')) return '调度算法面板'
  return '用户客户端'
})
</script>
