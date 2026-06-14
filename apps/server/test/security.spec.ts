import { hashPassword, signToken, verifyPassword, verifyToken } from '../src/common/security'

describe('security helpers', () => {
  it('hashes and verifies passwords without storing the plain password', () => {
    const hash = hashPassword('admin888')

    expect(hash).not.toBe('admin888')
    expect(verifyPassword('admin888', hash)).toBe(true)
    expect(verifyPassword('wrong', hash)).toBe(false)
  })

  it('signs and verifies HMAC JWT-style tokens', () => {
    const token = signToken({ sub: 'u1', username: 'user_01', role: 'USER' }, 'secret')
    const payload = verifyToken(token, 'secret')

    expect(payload?.sub).toBe('u1')
    expect(payload?.role).toBe('USER')
    expect(verifyToken(token, 'other-secret')).toBeNull()
  })
})
