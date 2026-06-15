import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name)
  private client: Redis
  private available = false

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
      this.available = true
      this.logger.log('Redis connected')
    } catch (err) {
      this.available = false
      this.logger.warn('Redis unavailable — caching and locks disabled. ' + String(err))
    }
  }

  async onModuleDestroy() {
    if (this.available) await this.client.quit()
  }

  // ── 基础缓存 ──────────────────────────────────────

  async get(key: string): Promise<string | null> {
    if (!this.available) return null
    try {
      return await this.client.get(key)
    } catch (err) {
      this.markUnavailable(err)
      return null
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.available) return
    try {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds)
      } else {
        await this.client.set(key, value)
      }
    } catch (err) {
      this.markUnavailable(err)
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
    if (!this.available) return
    try {
      await this.client.del(key)
    } catch (err) {
      this.markUnavailable(err)
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.available) return false
    try {
      return (await this.client.exists(key)) === 1
    } catch (err) {
      this.markUnavailable(err)
      return false
    }
  }

  // ── 队列操作（List） ──────────────────────────────

  /** 从右边入队（队尾添加） */
  async queuePush(key: string, ...values: string[]): Promise<void> {
    if (!this.available || values.length === 0) return
    try {
      await this.client.rpush(key, ...values)
    } catch (err) {
      this.markUnavailable(err)
    }
  }

  /** 从左边出队（队首取出） */
  async queuePop(key: string): Promise<string | null> {
    if (!this.available) return null
    try {
      return await this.client.lpop(key)
    } catch (err) {
      this.markUnavailable(err)
      return null
    }
  }

  /** 从队列中移除指定值 */
  async queueRemove(key: string, value: string): Promise<void> {
    if (!this.available) return
    try {
      await this.client.lrem(key, 0, value)
    } catch (err) {
      this.markUnavailable(err)
    }
  }

  /** 获取队列全部元素 */
  async queueRange(key: string, start = 0, stop = -1): Promise<string[]> {
    if (!this.available) return []
    try {
      return await this.client.lrange(key, start, stop)
    } catch (err) {
      this.markUnavailable(err)
      return []
    }
  }

  /** 队列长度 */
  async queueLength(key: string): Promise<number> {
    if (!this.available) return 0
    try {
      return await this.client.llen(key)
    } catch (err) {
      this.markUnavailable(err)
      return 0
    }
  }

  // ── 分布式锁 ──────────────────────────────────────

  /**
   * 获取锁。返回 true 表示获取成功。
   * @param key    锁的键名
   * @param ttlMs  锁自动过期时间（毫秒）
   */
  async lock(key: string, ttlMs = 5000): Promise<boolean> {
    if (!this.available) return false
    try {
      const result = await this.client.set(key, '1', 'PX', ttlMs, 'NX')
      return result === 'OK'
    } catch (err) {
      this.markUnavailable(err)
      return false
    }
  }

  /** 释放锁 */
  async unlock(key: string): Promise<void> {
    await this.del(key)
  }

  // ── 健康检查 ──────────────────────────────────────

  async ping(): Promise<boolean> {
    if (!this.available) return false
    try {
      return (await this.client.ping()) === 'PONG'
    } catch {
      this.available = false
      return false
    }
  }

  /** 暴露底层客户端供特殊场景使用 */
  get raw(): Redis {
    return this.client
  }

  private markUnavailable(err: unknown) {
    if (this.available) {
      this.logger.warn('Redis command failed; caching disabled. ' + String(err))
    }
    this.available = false
  }
}
