import { Module } from '@nestjs/common'
import { DispatchModule } from '../dispatch/dispatch.module'
import { PileController } from './pile.controller'
import { PileService } from './pile.service'

@Module({
  imports: [DispatchModule],
  controllers: [PileController],
  providers: [PileService]
})
export class PileModule {}
