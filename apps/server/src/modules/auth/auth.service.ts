import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { LoginDto, RegisterDto } from './auth.dto'

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(dto: RegisterDto) {
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        passwordHash: dto.password,
        batteryCapacity: dto.batteryCapacity ?? 60
      }
    })
    return { userId: user.id, username: user.username }
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { username: dto.username } })
    return {
      accessToken: `dev-token-${user?.id ?? 'anonymous'}`,
      userId: user?.id,
      username: dto.username
    }
  }
}
