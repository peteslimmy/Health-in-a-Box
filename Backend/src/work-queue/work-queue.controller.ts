import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth-user';
import { WorkQueueService } from './work-queue.service';

@ApiTags('work-queue')
@ApiBearerAuth()
@Controller('work-queue')
export class WorkQueueController {
  constructor(private readonly queue: WorkQueueService) {}

  /** Open to every signed-in user: it only ever lists what that person may act on. */
  @Get()
  @ApiOperation({ summary: 'What is waiting for the signed-in user to act on' })
  get(@CurrentUser() user: AuthUser) {
    return this.queue.queue(user);
  }
}
