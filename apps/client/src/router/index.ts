import { createRouter, createWebHistory } from 'vue-router'
import AuthView from '../views/AuthView.vue'
import AdminLayout from '../views/AdminLayout.vue'
import UserLayout from '../views/user/UserLayout.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/auth' },
    {
      path: '/auth',
      name: 'auth',
      component: AuthView,
      meta: { guest: true }
    },
    {
      path: '/admin',
      name: 'admin',
      component: AdminLayout,
      meta: { requiresAdmin: true }
    },
    {
      path: '/user',
      name: 'user',
      component: UserLayout,
      meta: { requiresUser: true }
    }
  ]
})

router.beforeEach((to) => {
  const hasUser = Boolean(localStorage.getItem('access_token'))
  const hasAdmin = Boolean(localStorage.getItem('admin_access_token'))

  if (to.meta.requiresUser && !hasUser) {
    return { path: '/auth', query: { mode: 'user' } }
  }
  if (to.meta.requiresAdmin && !hasAdmin) {
    return { path: '/auth', query: { mode: 'admin' } }
  }
  if (to.path === '/auth') {
    const mode = to.query.mode === 'admin' ? 'admin' : 'user'
    if (mode === 'admin' && hasAdmin) return '/admin'
    if (mode === 'user' && hasUser) return '/user'
  }
})
