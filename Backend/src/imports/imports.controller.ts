import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/types/auth-user';
import {
  ApproveVarianceDto,
  CommitImportDto,
  ImportQueryDto,
  UploadImportDto,
} from './dto/import.dto';
import { ImportsService } from './imports.service';

@ApiTags('imports')
@ApiBearerAuth()
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get()
  @Permissions('imports.read')
  @ApiOperation({ summary: 'List revenue-report imports' })
  list(@CurrentUser() user: AuthUser, @Query() query: ImportQueryDto) {
    return this.imports.list(user, query);
  }

  @Get('template')
  @Permissions('imports.read')
  @ApiOperation({ summary: 'Download a CSV revenue template for a hospital' })
  async template(
    @CurrentUser() user: AuthUser,
    @Query('hospitalId', new ParseUUIDPipe()) hospitalId: string,
    @Res() res: Response,
  ) {
    const result = await this.imports.template(user, hospitalId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    res.send(result.content);
  }

  @Get(':id/source')
  @Permissions('imports.read')
  @ApiOperation({ summary: 'Download the original uploaded file (audited)' })
  async source(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: Response,
  ) {
    const file = await this.imports.downloadSource(user, id);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(file.content);
  }

  @Get(':id')
  @Permissions('imports.read')
  @ApiOperation({ summary: 'Get an import with validation details' })
  get(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.imports.get(user, id);
  }

  @Post()
  @Permissions('imports.manage')
  @ApiOperation({ summary: 'Upload and validate a revenue report (CSV, XLSX or PDF)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'hospitalId'],
      properties: {
        file: { type: 'string', format: 'binary' },
        hospitalId: { type: 'string', format: 'uuid' },
        periodStart: { type: 'string', example: '2026-09-01' },
        periodEnd: { type: 'string', example: '2026-09-30' },
        reportDate: { type: 'string', example: '2026-09-30' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024, files: 1 } }))
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadImportDto,
  ) {
    return this.imports.upload(user, file, dto);
  }

  @Post(':id/commit-with-variance')
  @Permissions('imports.approve_variance')
  @ApiOperation({
    summary:
      'Commit a held report although its totals do not add up (named permission, written reason, audited; cannot be the uploader)',
  })
  commitWithVariance(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ApproveVarianceDto,
  ) {
    return this.imports.commitWithVariance(user, id, dto);
  }

  @Post(':id/commit')
  @Permissions('imports.commit')
  @ApiOperation({
    summary:
      'Commit a validated import into a revenue report (reviewer action; cannot be the uploader)',
  })
  commit(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CommitImportDto,
  ) {
    return this.imports.commit(user, id, dto);
  }
}
