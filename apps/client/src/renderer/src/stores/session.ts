import { defineStore } from 'pinia'

export type ClientRole = 'USER' | 'ADMIN'

export const useSessionStore = defineStore('session', {
  state: () => ({
    token: localStorage.getItem('access_token') ?? '',
    role: 'USER' as ClientRole
  }),
  actions: {
    setSession(token: string, role: ClientRole) {
      this.token = token
      this.role = role
      localStorage.setItem('access_token', token)
    },
    clearSession() {
      this.token = ''
      localStorage.removeItem('access_token')
    }
  }
})
