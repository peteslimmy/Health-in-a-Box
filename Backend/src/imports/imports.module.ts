import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { RevenueParserService } from './revenue-parser.service';

@Module({
  controllers: [ImportsController],
  providers: [ImportsService, RevenueParserService],
  exports: [ImportsService],
})
export class ImportsModule {}
