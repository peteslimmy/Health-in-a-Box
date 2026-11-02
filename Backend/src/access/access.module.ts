import { Global, Module } from '@nestjs/common';
import { AccessPolicyService } from './access-policy.service';

@Global()
@Module({
  providers: [AccessPolicyService],
  exports: [AccessPolicyService],
})
export class AccessModule {}
