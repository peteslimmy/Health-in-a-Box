import { Module } from '@nestjs/common';
import { ImportsModule } from '../imports/imports.module';
import { CentreSetupController } from './centre-setup.controller';
import { CentreSetupService } from './centre-setup.service';

@Module({
  imports: [ImportsModule],
  controllers: [CentreSetupController],
  providers: [CentreSetupService],
})
export class CentreSetupModule {}
