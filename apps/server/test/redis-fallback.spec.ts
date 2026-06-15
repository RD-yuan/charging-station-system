import { RedisService } from '../src/redis/redis.service'

describe('RedisService fallback', () => {
  it('turns cache operations into safe no-ops before Redis is available', async () => {
    const redis = new RedisService({ get: () => 'redis://127.0.0.1:1' } as never)

    await expect(redis.get('missing')).resolves.toBeNull()
    await expect(redis.setJson('key', { ok: true })).resolves.toBeUndefined()
    await expect(redis.queueRange('queue')).resolves.toEqual([])
    await expect(redis.lock('lock')).resolves.toBe(false)
    await expect(redis.ping()).resolves.toBe(false)

    await redis.onModuleDestroy()
  })
})
