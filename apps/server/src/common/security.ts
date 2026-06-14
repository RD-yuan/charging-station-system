import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto'

export type AuthRole = 'USER' | 'ADMIN'

export interface AuthTokenPayload {
  sub: string
  username: string
  role: AuthRole
  exp: number
}

const HASH_ALGORITHM = 'sha256'
const HASH_ITERATIONS = 120_000
const HASH_KEY_LENGTH = 32
const TOKEN_TTL_SECONDS = 60 * 60 * 8

function base64UrlEncode(input: Buffer | string) {
  return Buffer.from(input).toString('base64url')
}

function base64UrlJson(value: unknown) {
  return base64UrlEncode(JSON.stringify(value))
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('base64url')
  const hash = pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_KEY_LENGTH, HASH_ALGORITHM).toString('base64url')
  return `pbkdf2$${HASH_ALGORITHM}$${HASH_ITERATIONS}$${salt}$${hash}`
}

export function verifyPassword(password: string, passwordHash: string) {
  const [scheme, algorithm, iterationsText, salt, expectedHash] = passwordHash.split('$')
  if (scheme !== 'pbkdf2' || !algorithm || !iterationsText || !salt || !expectedHash) {
    return password === passwordHash
  }

  const iterations = Number(iterationsText)
  const actual = pbkdf2Sync(password, salt, iterations, HASH_KEY_LENGTH, algorithm).toString('base64url')
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expectedHash)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

export function signToken(payload: Omit<AuthTokenPayload, 'exp'>, secret: string) {
  const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' })
  const body = base64UrlJson({ ...payload, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS })
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

export function verifyToken(token: string, secret: string): AuthTokenPayload | null {
  const [header, body, signature] = token.split('.')
  if (!header || !body || !signature) return null

  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null
  }

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AuthTokenPayload
  if (payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload
}
