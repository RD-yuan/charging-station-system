<!-- src/App.vue -->
<script setup lang="ts">
import AdminLayout from './views/AdminLayout.vue'
</script>

<template>
  <AdminLayout />
</template>

<style>
/* 引入全局重置样式 */
html, body, #app {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  background-color: #0f172a; /* 默认深空黑底色，体验更佳 */
}
</style>