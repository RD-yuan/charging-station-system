import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis | null

  constructor(@Inject(ConfigService) config: ConfigService) {
    const redisUrl = config.get<string>('REDIS_URL')
    this.client = redisUrl
      ? new Redis(redisUrl, {
          lazyConnect: true,
          connectTimeout: 5000,
          commandTimeout: 5000,
          maxRetriesPerRequest: 1
        })
      : null

    this.client?.on('error', () => undefined)
  }

  async setJson(key: string, value: unknown) {
    if (!this.client) return
    try {
      if (this.client.status === 'wait') await this.client.connect()
      await this.client.set(key, JSON.stringify(value))
    } catch {
      // Redis is a cache only; business state remains in MySQL.
    }
  }

  async delete(key: string) {
    if (!this.client) return
    try {
      if (this.client.status === 'wait') await this.client.connect()
      await this.client.del(key)
    } catch {
      // Redis is a cache only; business state remains in MySQL.
    }
  }

  async onModuleDestroy() {
    this.client?.disconnect()
  }
}
