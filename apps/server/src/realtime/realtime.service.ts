import { Injectable, OnModuleDestroy } from '@nestjs/common'
import type { Server } from 'http'
import { WebSocket, WebSocketServer } from 'ws'

export interface RealtimeMessage {
  event: string
  data: unknown
  timestamp: string
}

@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly server = new WebSocketServer({ noServer: true })
  private attached = false

  attach(httpServer: Server) {
    if (this.attached) return
    this.attached = true

    httpServer.on('upgrade', (request, socket, head) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname
      if (path !== '/ws/station') {
        socket.destroy()
        return
      }

      this.server.handleUpgrade(request, socket, head, (client) => {
        this.server.emit('connection', client, request)
      })
    })
  }

  broadcast(event: string, data: unknown) {
    const payload: RealtimeMessage = {
      event,
      data,
      timestamp: new Date().toISOString()
    }
    const message = JSON.stringify(payload)

    for (const client of this.server.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(message)
    }
  }

  onModuleDestroy() {
    for (const client of this.server.clients) client.terminate()
    this.server.close()
  }
}
