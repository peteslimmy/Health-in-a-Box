import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api/v1');
  // Behind a reverse proxy, trust its forwarded address so rate limits apply per real client.
  // Set TRUST_PROXY to the number of proxy hops (e.g. 1), or leave unset when not behind one.
  const trustProxy = config.get<string>('TRUST_PROXY');
  if (trustProxy) {
    app
      .getHttpAdapter()
      .getInstance()
      .set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  }
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());
  app.enableCors({
    origin: config
      .get<string>('FRONTEND_ORIGIN', 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Correlation-Id'],
    exposedHeaders: ['X-Correlation-Id'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: false,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('HNB Receivables API')
    .setDescription('Service charge computation, receivables, payments and reconciliation')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  // The API documentation lists every route and DTO; keep it off in production unless asked for.
  const docsEnabled =
    config.get<string>('NODE_ENV') !== 'production' ||
    config.get<string>('ENABLE_SWAGGER') === 'true';
  if (docsEnabled)
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  const port = Number(config.get<string>('PORT', '4000'));
  await app.listen(port);
  logger.log(`API listening on http://localhost:${port}/api/v1`);
  if (docsEnabled) logger.log(`OpenAPI docs at http://localhost:${port}/api/docs`);
}

void bootstrap();
