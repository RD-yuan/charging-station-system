import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Prisma } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../../prisma/prisma.service'
import { LoginDto, RegisterDto } from './auth.dto'

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwtService: JwtService
  ) {}

  async register(dto: RegisterDto) {
    const username = dto.username.trim()
    if (!username) throw new BadRequestException('Username cannot be blank.')
    const passwordHash = await bcrypt.hash(dto.password, 10)
    let user
    try {
      user = await this.prisma.user.create({
        data: {
          username,
          passwordHash,
          role: 'USER',
          batteryCapacity: dto.batteryCapacity ?? 60
        }
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Username already exists.')
      }
      throw error
    }
    return { userId: user.id, username: user.username, role: user.role }
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { username: dto.username.trim() } })
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

  async userLogin(dto: LoginDto) {
    const result = await this.login(dto)
    if (result.role !== 'USER') {
      throw new UnauthorizedException('Invalid user credentials.')
    }
    return result
  }

  async adminLogin(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { username: dto.username.trim() } })
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
