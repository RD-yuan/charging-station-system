const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api'

type TokenRole = 'admin' | 'user'

function getToken(role: TokenRole) {
  return role === 'admin'
    ? localStorage.getItem('admin_access_token')
    : localStorage.getItem('access_token')
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  role: TokenRole = 'admin'
): Promise<T> {
  const token = getToken(role)
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers
  })

  if (!response.ok) {
    if (response.status === 401 && token) {
      const tokenKey = role === 'admin' ? 'admin_access_token' : 'access_token'
      localStorage.removeItem(tokenKey)
      window.location.assign(`/auth?mode=${role}`)
    }
    const message = await parseErrorMessage(response)
    throw new Error(message || `HTTP ${response.status}`)
  }

  if (response.status === 204) return undefined as T

  const text = await response.text()
  if (!text.trim()) return undefined as T

  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`接口返回了无效的 JSON（HTTP ${response.status}）`)
  }
}

async function parseErrorMessage(response: Response) {
  const text = await response.text()
  if (!text) return `HTTP ${response.status}`

  try {
    const json = JSON.parse(text) as { message?: string | string[] }
    if (Array.isArray(json.message)) return json.message.join('；')
    if (typeof json.message === 'string') return json.message
  } catch {
    // Keep raw text for non-JSON error bodies.
  }

  return text
}

export function wsUrl() {
  return import.meta.env.VITE_WS_URL ?? 'ws://localhost:3000/ws/station'
}
