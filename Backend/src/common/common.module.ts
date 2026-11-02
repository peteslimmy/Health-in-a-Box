import { Global, Module } from '@nestjs/common';
import { AuditService } from './services/audit.service';
import { StorageService } from './services/storage.service';

@Global()
@Module({
  providers: [AuditService, StorageService],
  exports: [AuditService, StorageService],
})
export class CommonModule {}
