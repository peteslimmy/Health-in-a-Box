import { Module } from '@nestjs/common';
import { WorkQueueController } from './work-queue.controller';
import { WorkQueueService } from './work-queue.service';

@Module({ controllers: [WorkQueueController], providers: [WorkQueueService] })
export class WorkQueueModule {}
