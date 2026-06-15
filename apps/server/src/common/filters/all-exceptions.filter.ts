import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger
} from '@nestjs/common'
import { Request, Response } from 'express'

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()

    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let message = 'Internal server error'
    let error = 'InternalServerError'

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      const body = exception.getResponse()
      if (typeof body === 'string') {
        message = body
      } else if (typeof body === 'object' && body !== null) {
        const obj = body as Record<string, unknown>
        message = (obj.message as string) ?? message
        error = (obj.error as string) ?? error
        // class-validator may return message as string[]
        if (Array.isArray(obj.message)) {
          message = (obj.message as string[]).join('; ')
        }
      }
      error = exception.name.replace('Exception', '') || error
    } else {
      this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : String(exception))
    }

    response.status(status).json({
      statusCode: status,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url
    })
  }
}
