import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name)
  private client: Redis

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {
    const url = config.get<string>('REDIS_URL') ?? 'redis://localhost:6379'
    this.client = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) return null
        return Math.min(times * 200, 2000)
      },
      lazyConnect: true
    })
  }

  async onModuleInit() {
    try {
      await this.client.connect()
      await this.client.ping()
      this.logger.log('Redis connected')
    } catch (err) {
      this.logger.warn('Redis unavailable — caching and locks disabled. ' + String(err))
    }
  }

  async onModuleDestroy() {
    await this.client.quit()
  }

  // ── 基础缓存 ──────────────────────────────────────

  async get(key: string): Promise<string | null> {
    return this.client.get(key)
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds)
    } else {
      await this.client.set(key, value)
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds)
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key)
    return raw ? (JSON.parse(raw) as T) : null
  }

  async del(key: string): Promise<void> {
    await this.client.del(key)
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1
  }

  // ── 队列操作（List） ──────────────────────────────

  /** 从右边入队（队尾添加） */
  async queuePush(key: string, ...values: string[]): Promise<void> {
    await this.client.rpush(key, ...values)
  }

  /** 从左边出队（队首取出） */
  async queuePop(key: string): Promise<string | null> {
    return this.client.lpop(key)
  }

  /** 从队列中移除指定值 */
  async queueRemove(key: string, value: string): Promise<void> {
    await this.client.lrem(key, 0, value)
  }

  /** 获取队列全部元素 */
  async queueRange(key: string, start = 0, stop = -1): Promise<string[]> {
    return this.client.lrange(key, start, stop)
  }

  /** 队列长度 */
  async queueLength(key: string): Promise<number> {
    return this.client.llen(key)
  }

  // ── 分布式锁 ──────────────────────────────────────

  /**
   * 获取锁。返回 true 表示获取成功。
   * @param key    锁的键名
   * @param ttlMs  锁自动过期时间（毫秒）
   */
  async lock(key: string, ttlMs = 5000): Promise<boolean> {
    const result = await this.client.set(key, '1', 'PX', ttlMs, 'NX')
    return result === 'OK'
  }

  /** 释放锁 */
  async unlock(key: string): Promise<void> {
    await this.client.del(key)
  }

  // ── 健康检查 ──────────────────────────────────────

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG'
    } catch {
      return false
    }
  }

  /** 暴露底层客户端供特殊场景使用 */
  get raw(): Redis {
    return this.client
  }
}
