import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService, TokenPair } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { MfaService } from './mfa.service';
import { MfaBeginDto, MfaCodeDto, MfaConfirmDto, MfaTokenDto, MfaVerifyDto } from './dto/mfa.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth-user';

const REFRESH_COOKIE = 'hnb_refresh';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly mfa: MfaService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Sign in with email and password' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto);
    if (result.kind === 'mfa') {
      // Password accepted, but no session yet: the second step comes next.
      return { mfa: { stage: result.stage, token: result.token } };
    }
    this.setRefreshCookie(res, result.tokens);
    return { user: result.user, accessToken: result.tokens.accessToken };
  }

  @Public()
  @Post('mfa/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Second step of sign-in: authenticator code or recovery code' })
  async mfaVerify(@Body() dto: MfaVerifyDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.mfa.verify(dto.mfaToken, dto);
    this.setRefreshCookie(res, result.tokens);
    return {
      user: result.user,
      accessToken: result.tokens.accessToken,
      recoveryCodesRemaining: result.recoveryCodesRemaining,
    };
  }

  @Public()
  @Post('mfa/enrol/start')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get a new authenticator key to add to the app' })
  mfaEnrolStart(@Body() dto: MfaTokenDto) {
    return this.mfa.startEnrolment(dto.mfaToken);
  }

  @Public()
  @Post('mfa/enrol/confirm')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Confirm the first code; opens the session and returns recovery codes once',
  })
  async mfaEnrolConfirm(@Body() dto: MfaConfirmDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.mfa.confirmEnrolment(dto.mfaToken, dto.code);
    this.setRefreshCookie(res, result.tokens);
    return {
      user: result.user,
      accessToken: result.tokens.accessToken,
      recoveryCodes: result.recoveryCodes,
    };
  }

  @Post('mfa/begin')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Signed-in person starts adding a second factor (password required)' })
  mfaBegin(@CurrentUser() user: AuthUser, @Body() dto: MfaBeginDto) {
    return this.mfa.beginVoluntary(user, dto.password);
  }

  @Post('mfa/recovery-codes')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Replace the recovery codes (current authenticator code required)' })
  mfaRecoveryCodes(@CurrentUser() user: AuthUser, @Body() dto: MfaCodeDto) {
    return this.mfa.regenerateRecoveryCodes(user, dto.code);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rotate the refresh session and issue an access token' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.refresh(req.cookies?.[REFRESH_COOKIE]);
    this.setRefreshCookie(res, result.tokens);
    return { user: result.user, accessToken: result.tokens.accessToken };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the refresh session' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current user, permissions and accessible hospitals' })
  me(@CurrentUser() user: AuthUser) {
    return this.authService.getProfile(user);
  }

  private setRefreshCookie(res: Response, tokens: TokenPair) {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: this.config.get<string>('COOKIE_SECURE', 'false') === 'true',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: tokens.refreshTtl * 1000,
      ...(this.config.get<string>('COOKIE_DOMAIN')
        ? { domain: this.config.get<string>('COOKIE_DOMAIN') }
        : {}),
    });
  }
}
