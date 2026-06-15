import { Global, Module } from '@nestjs/common'
import { QueueCacheService } from './queue-cache.service'

@Global()
@Module({
  providers: [QueueCacheService],
  exports: [QueueCacheService]
})
export class QueueModule {}
