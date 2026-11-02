import { Module } from '@nestjs/common';
import { ChargeConfigController } from './charge-config.controller';
import { ChargeConfigService } from './charge-config.service';
import { ChargeRunsController } from './charge-runs.controller';
import { ChargeRunsService } from './charge-runs.service';

@Module({
  controllers: [ChargeConfigController, ChargeRunsController],
  providers: [ChargeConfigService, ChargeRunsService],
  exports: [ChargeConfigService, ChargeRunsService],
})
export class ChargesModule {}
