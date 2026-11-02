import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/types/auth-user';
import { CentreSetupService } from './centre-setup.service';
import { CommitSetupDto } from './dto/centre-setup.dto';

/** The set-up wizard. Every route needs `centres.onboard`, which only the SUPER_ADMIN role holds. */
@ApiTags('centre-setup')
@ApiBearerAuth()
@Permissions('centres.onboard')
@Controller('centre-setup')
export class CentreSetupController {
  constructor(private readonly setup: CentreSetupService) {}

  @Post('analyse')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Read a report file and propose a centre, departments and payment channels',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024, files: 1 } }))
  analyse(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.setup.analyse(user, file);
  }

  @Get()
  @ApiOperation({ summary: 'Set-ups that were started and not finished' })
  list(@CurrentUser() user: AuthUser) {
    return this.setup.listOpen(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Reopen an unfinished set-up' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.setup.get(user, id);
  }

  @Post(':id/commit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Create the centre, its departments, payment channels and terms' })
  commit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommitSetupDto,
  ) {
    return this.setup.commit(user, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Discard an unfinished set-up' })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.setup.cancel(user, id);
  }
}
