import { Module } from '@nestjs/common';
import { ImportsModule } from '../imports/imports.module';
import { HospitalSetupController } from './hospital-setup.controller';
import { HospitalSetupService } from './hospital-setup.service';

@Module({
  imports: [ImportsModule],
  controllers: [HospitalSetupController],
  providers: [HospitalSetupService],
})
export class HospitalSetupModule {}
