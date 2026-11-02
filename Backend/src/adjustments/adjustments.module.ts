import { Module } from '@nestjs/common';
import {
  AdjustmentsController,
  DisputesController,
  OpeningBalancesController,
} from './adjustments.controller';
import { AdjustmentsService } from './adjustments.service';
import { OpeningBalancesService } from './opening-balances.service';

@Module({
  controllers: [AdjustmentsController, DisputesController, OpeningBalancesController],
  providers: [AdjustmentsService, OpeningBalancesService],
})
export class AdjustmentsModule {}
