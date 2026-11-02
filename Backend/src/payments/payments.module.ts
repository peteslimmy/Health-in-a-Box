import { Module } from '@nestjs/common';
import { PaymentAllocationsController, PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [PaymentsController, PaymentAllocationsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
