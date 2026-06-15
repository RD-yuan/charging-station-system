import * as bcrypt from 'bcryptjs'
import { AuthService } from '../src/modules/auth/auth.service'
import { AdminDashboardController } from '../src/modules/admin/admin-dashboard.controller'
import { BillingController } from '../src/modules/billing/billing.controller'
import { ChargingController, UserChargingAliasController } from '../src/modules/charging/charging.controller'
import { PileController } from '../src/modules/pile/pile.controller'

describe('security boundaries', () => {
  it('always creates public registrations as normal users', async () => {
    const create = jest.fn(async ({ data }) => ({ id: 'u1', username: data.username, role: data.role }))
    const service = new AuthService(
      { user: { create } } as never,
      { sign: jest.fn() } as never
    )

    await service.register({ username: 'new-user', password: 'secret', role: 'ADMIN' } as never)

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: 'USER' })
    }))
  })

  it('rejects administrator accounts at the user login endpoint', async () => {
    const passwordHash = await bcrypt.hash('admin123', 4)
    const service = new AuthService(
      { user: { findUnique: jest.fn(async () => ({ id: 'a1', username: 'admin', passwordHash, role: 'ADMIN' })) } } as never,
      { sign: jest.fn(() => 'token') } as never
    )

    await expect(service.userLogin({ username: 'admin', password: 'admin123' })).rejects.toThrow(
      'Invalid user credentials.'
    )
  })

  it('marks management and user controllers with explicit roles', () => {
    expect(Reflect.getMetadata('roles', AdminDashboardController)).toEqual(['ADMIN'])
    expect(Reflect.getMetadata('roles', PileController)).toEqual(['ADMIN'])
    expect(Reflect.getMetadata('roles', ChargingController)).toEqual(['ADMIN'])
    expect(Reflect.getMetadata('roles', UserChargingAliasController)).toEqual(['USER'])
    expect(Reflect.getMetadata('roles', BillingController)).toEqual(['USER'])
  })
})
