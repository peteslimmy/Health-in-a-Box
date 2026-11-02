import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { THROTTLERS } from './common/throttle';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { AccessModule } from './access/access.module';
import { CentresModule } from './centres/centres.module';
import { CentreSetupModule } from './centre-setup/centre-setup.module';
import { PlatformModule } from './platform/platform.module';
import { UsersModule } from './users/users.module';
import { ImportsModule } from './imports/imports.module';
import { ChargesModule } from './charges/charges.module';
import { AdjustmentsModule } from './adjustments/adjustments.module';
import { AuditModule } from './audit/audit.module';
import { WorkQueueModule } from './work-queue/work-queue.module';
import { PaymentsModule } from './payments/payments.module';
import { ReceivablesModule } from './receivables/receivables.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReportsModule } from './reports/reports.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env'],
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot(THROTTLERS),
    PrismaModule,
    CommonModule,
    AccessModule,
    AuthModule,
    HealthModule,
    CentresModule,
    CentreSetupModule,
    PlatformModule,
    UsersModule,
    ImportsModule,
    ChargesModule,
    AuditModule,
    PaymentsModule,
    ReceivablesModule,
    DashboardModule,
    ReportsModule,
    AdjustmentsModule,
    WorkQueueModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
