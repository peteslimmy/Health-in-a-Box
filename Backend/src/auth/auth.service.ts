import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID, timingSafeEqual } from 'crypto';
import * as argon2 from 'argon2';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, JwtPayload } from '../common/types/auth-user';
import { LoginDto } from './dto/login.dto';
import { AccessPolicyService } from '../access/access-policy.service';
import { SUPER_ADMIN_ROLE } from '../access/access-rules';
import { MfaEnforcement, mfaRequired, parseEnforcement } from './mfa-policy';

/**
 * A rotated refresh token remains usable for this long, so a page reload or a response lost in
 * transit cannot sign the user out. After the window the old token is rejected.
 */
export const REFRESH_GRACE_MS = 30_000;

/** How long the person has to enter a code (or finish enrolling) after the password was accepted. */
export const MFA_CHALLENGE_TTL_SECONDS = 300;

export type LoginResult =
  | { kind: 'session'; user: AuthUser; tokens: TokenPair }
  | { kind: 'mfa'; stage: 'verify' | 'enrol'; token: string };

export type TokenPair = { accessToken: string; refreshToken: string; refreshTtl: number };

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

@Injectable()
export class AuthService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessTtl: number;
  private readonly refreshTtl: number;
  private readonly enforcement: MfaEnforcement;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly access: AccessPolicyService,
  ) {
    this.accessSecret = this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
    this.refreshSecret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
    this.accessTtl = Number(this.config.get<string>('JWT_ACCESS_TTL', '900'));
    this.refreshTtl = Number(this.config.get<string>('JWT_REFRESH_TTL', '604800'));
    this.enforcement = parseEnforcement(
      this.config.get<string>('MFA_ENFORCEMENT'),
      this.config.get<string>('NODE_ENV') === 'production',
    );
  }

  private dummyHash?: Promise<string>;

  private getDummyHash(): Promise<string> {
    return (this.dummyHash ??= argon2.hash(randomUUID()));
  }

  async buildAuthUser(userId: string, organizationId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId, isActive: true },
      include: {
        roleAssignments: {
          include: {
            role: {
              include: {
                permissions: { include: { permission: true } },
              },
            },
          },
        },
      },
    });
    if (!user) throw new UnauthorizedException('User account is unavailable');

    const activeAssignments = user.roleAssignments.filter((a) => a.role.isActive);
    const permissions = [
      ...new Set(
        activeAssignments.flatMap((a) => a.role.permissions.map((p) => p.permission.code)),
      ),
    ];
    const roleCodes = [...new Set(activeAssignments.map((a) => a.role.code))];
    const allCentres = activeAssignments.some((a) => a.centreId === null);
    const centreIds = [
      ...new Set(
        activeAssignments.map((a) => a.centreId).filter((id): id is string => Boolean(id)),
      ),
    ];

    // Checked on every request, so removing a domain (or a Gmail address that is not a super admin)
    // ends that person's access at once, not at their next sign-in.
    const decision = await this.access.check(
      user.organizationId,
      user.email,
      roleCodes.includes(SUPER_ADMIN_ROLE),
    );
    if (!decision.allowed) {
      throw new UnauthorizedException({ code: 'EMAIL_NOT_PERMITTED', message: decision.message });
    }

    const grants = activeAssignments.map((assignment) => ({
      roleCode: assignment.role.code,
      permissions: [...new Set(assignment.role.permissions.map((p) => p.permission.code))],
      allCentres: assignment.centreId === null,
      centreIds: assignment.centreId ? [assignment.centreId] : [],
    }));

    return {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      fullName: user.fullName,
      roleCodes,
      permissions,
      centreIds,
      allCentres,
      grants,
      mfaEnabled: user.mfaEnabled,
    };
  }

  async login(dto: LoginDto): Promise<LoginResult> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { email, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!user) {
      // Pay for a password check anyway so response time does not reveal whether the email exists.
      await argon2.verify(await this.getDummyHash(), dto.password).catch(() => false);
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) throw new UnauthorizedException('Invalid email or password');

    // The password alone never opens a session for someone who needs a second factor.
    const authUser = await this.buildAuthUser(user.id, user.organizationId);
    if (mfaRequired(authUser, user.mfaEnabled, this.enforcement)) {
      const stage = user.mfaEnabled ? 'verify' : 'enrol';
      return { kind: 'mfa', stage, token: await this.signChallenge(authUser, stage) };
    }
    return { kind: 'session', ...(await this.completeSignIn(authUser)) };
  }

  /** Records the sign-in and opens the session. Called once every required factor has been checked. */
  async completeSignIn(authUser: AuthUser): Promise<{ user: AuthUser; tokens: TokenPair }> {
    await this.prisma.user.update({
      where: { id: authUser.id },
      data: { lastLoginAt: new Date() },
    });
    const tokens = await this.issueTokens(authUser);
    return { user: authUser, tokens };
  }

  async signChallenge(user: AuthUser, stage: 'verify' | 'enrol'): Promise<string> {
    return this.jwt.signAsync(
      { sub: user.id, org: user.organizationId, type: 'mfa', stage } satisfies JwtPayload,
      { secret: this.accessSecret, expiresIn: MFA_CHALLENGE_TTL_SECONDS, algorithm: 'HS256' },
    );
  }

  async readChallenge(
    token: string | undefined,
  ): Promise<JwtPayload & { stage: 'verify' | 'enrol' }> {
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token ?? '', {
        secret: this.accessSecret,
        algorithms: ['HS256'],
      });
      if (payload.type !== 'mfa' || !payload.stage || !payload.sub || !payload.org)
        throw new Error();
      return payload as JwtPayload & { stage: 'verify' | 'enrol' };
    } catch {
      throw new UnauthorizedException('The sign-in step expired; enter your password again');
    }
  }

  async refresh(refreshToken: string | undefined): Promise<{ user: AuthUser; tokens: TokenPair }> {
    if (!refreshToken) throw new UnauthorizedException('Refresh session missing');

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.refreshSecret,
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Refresh session is invalid or expired');
    }
    if (payload.type !== 'refresh' || !payload.sid) {
      throw new UnauthorizedException('Refresh session is invalid');
    }

    const session = await this.prisma.refreshSession.findUnique({
      where: { id: payload.sid },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now() ||
      !safeEqual(session.tokenHash, sha256(refreshToken)) ||
      // A rotated token is honoured only inside the grace window, then it is dead for good.
      (session.rotatedAt && Date.now() - session.rotatedAt.getTime() > REFRESH_GRACE_MS)
    ) {
      throw new UnauthorizedException('Refresh session is invalid or expired');
    }

    const authUser = await this.buildAuthUser(session.userId, session.organizationId);
    if (
      mfaRequired(authUser, authUser.mfaEnabled === true, this.enforcement) &&
      !authUser.mfaEnabled
    ) {
      // Access that now needs a second factor (a new role, a stricter policy) ends at the next refresh.
      await this.prisma.refreshSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Multi-factor sign-in is required; sign in again');
    }
    await this.prisma.refreshSession.update({
      where: { id: session.id },
      data: { rotatedAt: session.rotatedAt ?? new Date() },
    });
    const tokens = await this.issueTokens(authUser);
    return { user: authUser, tokens };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const hash = sha256(refreshToken);
    await this.prisma.refreshSession.updateMany({
      where: { tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getProfile(user: AuthUser) {
    const centres = await this.prisma.centre.findMany({
      where: {
        organizationId: user.organizationId,
        ...(user.allCentres ? {} : { id: { in: user.centreIds } }),
      },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
    return { ...user, centres };
  }

  private async issueTokens(user: AuthUser): Promise<TokenPair> {
    const sessionId = randomUUID();
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, org: user.organizationId, type: 'access' } satisfies JwtPayload,
      { secret: this.accessSecret, expiresIn: this.accessTtl, algorithm: 'HS256' },
    );
    const refreshToken = await this.jwt.signAsync(
      {
        sub: user.id,
        org: user.organizationId,
        type: 'refresh',
        sid: sessionId,
      } satisfies JwtPayload,
      { secret: this.refreshSecret, expiresIn: this.refreshTtl, algorithm: 'HS256' },
    );
    await this.prisma.refreshSession.create({
      data: {
        id: sessionId,
        organizationId: user.organizationId,
        userId: user.id,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTtl * 1000),
      },
    });
    return { accessToken, refreshToken, refreshTtl: this.refreshTtl };
  }
}
