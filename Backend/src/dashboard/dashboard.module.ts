import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { InsightsService } from './insights.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, InsightsService],
})
export class DashboardModule {}
