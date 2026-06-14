import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory, Reflector } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  const config = app.get(ConfigService)

  app.setGlobalPrefix('api')
  app.enableCors()
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true
    })
  )
  app.useGlobalFilters(new AllExceptionsFilter())
  app.useGlobalGuards(new JwtAuthGuard(app.get(Reflector)))

  const swaggerConfig = new DocumentBuilder()
    .setTitle('智能充电桩调度计费系统 API')
    .setDescription('Node.js / TypeScript backend API scaffold.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build()
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig))

  const port = config.get<number>('PORT') ?? 3000
  await app.listen(port)
}

bootstrap()
