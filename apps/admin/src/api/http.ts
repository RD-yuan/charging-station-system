const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api'

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('admin_access_token')
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `HTTP ${response.status}`)
  }

  return response.json() as Promise<T>
}

export function wsUrl() {
  return import.meta.env.VITE_WS_URL ?? 'ws://localhost:3000/ws/station'
}
