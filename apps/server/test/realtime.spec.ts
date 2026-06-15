import { createServer } from 'http'
import { AddressInfo } from 'net'
import { WebSocket } from 'ws'
import { RealtimeService } from '../src/realtime/realtime.service'

describe('RealtimeService', () => {
  it('accepts the station websocket and broadcasts JSON events', async () => {
    const realtime = new RealtimeService()
    const httpServer = createServer()
    realtime.attach(httpServer)
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
    const port = (httpServer.address() as AddressInfo).port
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws/station`)

    const message = new Promise<string>((resolve, reject) => {
      client.once('open', () => realtime.broadcast('dispatch_result', { applied: 1 }))
      client.once('message', (data) => resolve(data.toString()))
      client.once('error', reject)
    })

    expect(JSON.parse(await message)).toMatchObject({
      event: 'dispatch_result',
      data: { applied: 1 }
    })

    client.terminate()
    realtime.onModuleDestroy()
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  })
})
