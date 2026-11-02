import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { BrandingController } from './branding.controller';
import { MailService } from './mail.service';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [UsersModule],
  controllers: [PlatformController, BrandingController],
  providers: [PlatformService, MailService],
  exports: [MailService],
})
export class PlatformModule {}
