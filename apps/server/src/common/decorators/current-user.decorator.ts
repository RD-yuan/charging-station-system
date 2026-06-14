import { ExecutionContext, createParamDecorator } from '@nestjs/common'

export interface JwtPayload {
  userId: string
  username: string
  role: string
}

export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext): JwtPayload | string => {
    const request = ctx.switchToHttp().getRequest()
    const user = request.user as JwtPayload
    return data ? user?.[data] : user
  }
)
