import { Injectable } from '@nestjs/common'
import { createHash } from 'crypto'
import type { IncomingMessage, Server } from 'http'
import type { Duplex } from 'stream'

export interface RealtimeMessage {
  event: string
  data: unknown
  timestamp: string
}

@Injectable()
export class RealtimeService {
  private readonly clients = new Set<Duplex>()
  private attached = false

  attach(server: Server) {
    if (this.attached) return
    this.attached = true

    server.on('upgrade', (request, socket) => {
      if (!request.url?.startsWith('/ws/station')) {
        socket.destroy()
        return
      }

      const key = request.headers['sec-websocket-key']
      if (typeof key !== 'string') {
        socket.destroy()
        return
      }

      socket.write(this.handshakeResponse(request, key))
      this.clients.add(socket)
      socket.on('close', () => this.clients.delete(socket))
      socket.on('error', () => this.clients.delete(socket))
    })
  }

  broadcast(event: string, data: unknown) {
    const payload: RealtimeMessage = {
      event,
      data,
      timestamp: new Date().toISOString()
    }
    const frame = encodeTextFrame(JSON.stringify(payload))
    for (const client of this.clients) {
      if (!client.destroyed) client.write(frame)
    }
  }

  private handshakeResponse(request: IncomingMessage, key: string) {
    const accept = createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64')

    const lines = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`
    ]
    const protocol = request.headers['sec-websocket-protocol']
    if (typeof protocol === 'string') lines.push(`Sec-WebSocket-Protocol: ${protocol}`)
    return `${lines.join('\r\n')}\r\n\r\n`
  }
}

function encodeTextFrame(text: string) {
  const payload = Buffer.from(text)
  const header: number[] = [0x81]

  if (payload.length < 126) {
    header.push(payload.length)
  } else if (payload.length <= 0xffff) {
    header.push(126, (payload.length >> 8) & 0xff, payload.length & 0xff)
  } else {
    const length = BigInt(payload.length)
    header.push(127)
    for (let shift = 56n; shift >= 0n; shift -= 8n) {
      header.push(Number((length >> shift) & 0xffn))
    }
  }

  return Buffer.concat([Buffer.from(header), payload])
}
