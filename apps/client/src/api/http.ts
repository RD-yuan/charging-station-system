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
    const message = await parseErrorMessage(response)
    throw new Error(message || `HTTP ${response.status}`)
  }

  return response.json() as Promise<T>
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
