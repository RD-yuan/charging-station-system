import { createRouter, createWebHashHistory } from 'vue-router'
import UserDashboard from '@/views/UserDashboard.vue'
import AdminDashboard from '@/views/AdminDashboard.vue'
import DispatchDashboard from '@/views/DispatchDashboard.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/user' },
    { path: '/user', component: UserDashboard },
    { path: '/admin', component: AdminDashboard },
    { path: '/dispatch', component: DispatchDashboard }
  ]
})
