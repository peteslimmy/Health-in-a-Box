import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/types/auth-user';
import {
  DomainDto,
  ProfileDto,
  SmtpDto,
  SuperAdminDto,
  TestMailDto,
  UpdateDomainDto,
} from './dto/platform.dto';
import { BrandingKindName } from './image-rules';
import { PlatformService } from './platform.service';

const kindOf = (value: string): BrandingKindName => {
  if (value !== 'logo' && value !== 'favicon') {
    throw new BadRequestException('The image must be "logo" or "favicon"');
  }
  return value;
};

/** Platform settings. Every route needs `platform.manage`, which only the SUPER_ADMIN role holds. */
@ApiTags('platform')
@ApiBearerAuth()
@Permissions('platform.manage')
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('settings')
  @ApiOperation({ summary: 'Product name, outgoing email (without its password) and branding' })
  get(@CurrentUser() user: AuthUser) {
    return this.platform.get(user);
  }

  @Put('profile')
  saveProfile(@CurrentUser() user: AuthUser, @Body() dto: ProfileDto) {
    return this.platform.saveProfile(user, dto);
  }

  @Put('smtp')
  @ApiOperation({
    summary: 'Save the SMTP server and credentials (the password is stored encrypted)',
  })
  saveSmtp(@CurrentUser() user: AuthUser, @Body() dto: SmtpDto) {
    return this.platform.saveSmtp(user, dto);
  }

  @Delete('smtp')
  clearSmtp(@CurrentUser() user: AuthUser) {
    return this.platform.clearSmtp(user);
  }

  @Post('smtp/test')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send a test email with the saved settings' })
  testSmtp(@CurrentUser() user: AuthUser, @Body() dto: TestMailDto) {
    return this.platform.testSmtp(user, dto.to);
  }

  @Post('branding/:kind')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024, files: 1 } }))
  saveAsset(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.platform.saveAsset(user, kindOf(kind), file);
  }

  @Delete('branding/:kind')
  removeAsset(@CurrentUser() user: AuthUser, @Param('kind') kind: string) {
    return this.platform.removeAsset(user, kindOf(kind));
  }

  @Get('domains')
  @ApiOperation({ summary: 'Approved email domains, and people who are blocked by the rules' })
  listDomains(@CurrentUser() user: AuthUser) {
    return this.platform.listDomains(user);
  }

  @Post('domains')
  addDomain(@CurrentUser() user: AuthUser, @Body() dto: DomainDto) {
    return this.platform.addDomain(user, dto);
  }

  @Patch('domains/:id')
  updateDomain(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDomainDto,
  ) {
    return this.platform.updateDomain(user, id, dto);
  }

  @Delete('domains/:id')
  removeDomain(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.platform.removeDomain(user, id);
  }

  @Get('super-admins')
  listSuperAdmins(@CurrentUser() user: AuthUser) {
    return this.platform.listSuperAdmins(user);
  }

  @Post('super-admins')
  @ApiOperation({ summary: 'Register another super admin (a Gmail address)' })
  addSuperAdmin(@CurrentUser() user: AuthUser, @Body() dto: SuperAdminDto) {
    return this.platform.addSuperAdmin(user, dto);
  }
}
