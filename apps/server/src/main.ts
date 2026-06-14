import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { RealtimeService } from './realtime/realtime.service'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  const config = app.get(ConfigService)
  app.get(RealtimeService).attach(app.getHttpServer())

  app.setGlobalPrefix('api')
  app.enableCors()
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true
    })
  )

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
