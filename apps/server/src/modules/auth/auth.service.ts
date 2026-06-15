import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../../prisma/prisma.service'
import { LoginDto, RegisterDto } from './auth.dto'

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService
  ) {}

  async register(dto: RegisterDto) {
    const passwordHash = await bcrypt.hash(dto.password, 10)
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        passwordHash,
        role: (dto.role as 'USER' | 'ADMIN') ?? 'USER',
        batteryCapacity: dto.batteryCapacity ?? 60
      }
    })
    return { userId: user.id, username: user.username, role: user.role }
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { username: dto.username } })
    if (!user) {
      throw new UnauthorizedException('Invalid username or password.')
    }
    const valid = await bcrypt.compare(dto.password, user.passwordHash)
    if (!valid) {
      throw new UnauthorizedException('Invalid username or password.')
    }
    const payload = { userId: user.id, username: user.username, role: user.role }
    return {
      accessToken: this.jwtService.sign(payload),
      userId: user.id,
      username: user.username,
      role: user.role
    }
  }

  async adminLogin(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { username: dto.username } })
    if (!user || user.role !== 'ADMIN') {
      throw new UnauthorizedException('Invalid admin credentials.')
    }
    const valid = await bcrypt.compare(dto.password, user.passwordHash)
    if (!valid) {
      throw new UnauthorizedException('Invalid admin credentials.')
    }
    const payload = { userId: user.id, username: user.username, role: user.role }
    return {
      accessToken: this.jwtService.sign(payload),
      userId: user.id,
      username: user.username,
      role: user.role
    }
  }
}
