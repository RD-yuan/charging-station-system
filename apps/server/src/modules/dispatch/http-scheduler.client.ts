import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'

@Injectable()
export class HttpSchedulerClient {
  private readonly baseUrl: string

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.baseUrl = config.get<string>('SCHEDULER_SERVICE_URL') ?? 'http://localhost:8100'
  }

  async post<T>(path: string, payload: unknown): Promise<T> {
    const { data } = await axios.post<T>(`${this.baseUrl}${path}`, payload, { timeout: 5000 })
    return data
  }
}
