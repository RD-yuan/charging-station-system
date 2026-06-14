import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { hashPassword, signToken, verifyPassword } from '../../common/security'
import { PrismaService } from '../../prisma/prisma.service'
import { LoginDto, RegisterDto } from './auth.dto'

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { username: dto.username } })
    if (existing) throw new BadRequestException('Username already exists.')

    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        passwordHash: hashPassword(dto.password),
        batteryCapacity: dto.batteryCapacity ?? 60
      }
    })
    return {
      userId: user.id,
      username: user.username,
      accessToken: this.issueToken(user.id, user.username, 'USER')
    }
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { username: dto.username } })
    if (!user || !verifyPassword(dto.password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid username or password.')
    }
    return {
      accessToken: this.issueToken(user.id, user.username, 'USER'),
      userId: user.id,
      username: user.username
    }
  }

  async adminLogin(dto: LoginDto) {
    const admin = await this.prisma.administrator.findUnique({ where: { username: dto.username } })
    if (!admin || !verifyPassword(dto.password, admin.passwordHash)) {
      throw new UnauthorizedException('Invalid administrator credentials.')
    }
    return {
      accessToken: this.issueToken(admin.id, admin.username, 'ADMIN'),
      adminId: admin.id,
      adminName: admin.adminName,
      username: admin.username
    }
  }

  private issueToken(sub: string, username: string, role: 'USER' | 'ADMIN') {
    return signToken({ sub, username, role }, this.config.get<string>('JWT_SECRET') ?? 'change-me-in-development')
  }
}
