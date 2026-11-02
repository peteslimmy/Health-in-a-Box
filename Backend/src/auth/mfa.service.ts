import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/services/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { AuthService, TokenPair } from './auth.service';
import { decryptSecret, encryptSecret } from './mfa-crypto';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';

/** Wrong codes allowed in a row before the account's second step is locked. */
export const MFA_MAX_FAILURES = 5;
export const MFA_LOCK_MINUTES = 5;
const RECOVERY_CODE_COUNT = 8;

export type SignedIn = { user: AuthUser; tokens: TokenPair };

function newRecoveryCode(): string {
  const raw = randomBytes(8).toString('hex').toUpperCase().slice(0, 10);
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

const normaliseRecovery = (code: string) => code.replace(/[\s-]/g, '').toUpperCase();

const ALREADY_ENABLED = {
  code: 'MFA_ALREADY_ENABLED',
  message: 'A second factor is already set up for this account',
};
const NOT_ENROLLED = { code: 'MFA_NOT_ENROLLED', message: 'Set up the authenticator app first' };

@Injectable()
export class MfaService {
  private readonly keyMaterial: string;
  private readonly issuer: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    // Without a dedicated key (development only; production refuses to start without one) the key
    // is derived from the refresh secret.
    this.keyMaterial =
      config.get<string>('MFA_ENCRYPTION_KEY') ??
      `${config.getOrThrow<string>('JWT_REFRESH_SECRET')}:mfa`;
    this.issuer = config.get<string>('MFA_ISSUER', 'HNB Receivables');
  }

  /** A signed-in person who wants to add a second factor proves their password first. */
  async beginVoluntary(user: AuthUser, password: string): Promise<{ mfaToken: string }> {
    const row = await this.prisma.user.findFirst({
      where: { id: user.id, organizationId: user.organizationId, isActive: true },
    });
    if (!row || !(await argon2.verify(row.passwordHash, password).catch(() => false))) {
      throw new UnauthorizedException('The password is not correct');
    }
    if (row.mfaEnabled) throw new ConflictException(ALREADY_ENABLED);
    return { mfaToken: await this.auth.signChallenge(user, 'enrol') };
  }

  async startEnrolment(mfaToken: string | undefined) {
    const challenge = await this.auth.readChallenge(mfaToken);
    if (challenge.stage !== 'enrol') throw new BadRequestException(ALREADY_ENABLED);
    const user = await this.loadUser(challenge.sub, challenge.org);
    if (user.mfaEnabled) throw new ConflictException(ALREADY_ENABLED);
    // Asking twice (a page reload, a double request) shows the same key, so the key on screen is
    // always the one that will be checked.
    let secret = user.mfaPendingSecretEnc
      ? decryptSecret(user.mfaPendingSecretEnc, this.keyMaterial)
      : null;
    if (!secret) {
      secret = generateTotpSecret();
      await this.prisma.user.updateMany({
        where: { id: user.id, mfaPendingSecretEnc: null },
        data: { mfaPendingSecretEnc: encryptSecret(secret, this.keyMaterial) },
      });
      // A parallel request may have stored its key first; use whatever is stored.
      const stored = await this.loadUser(user.id, user.organizationId);
      secret = decryptSecret(stored.mfaPendingSecretEnc!, this.keyMaterial);
    }
    return { secret, otpauthUri: otpauthUri(secret, user.email, this.issuer) };
  }

  async confirmEnrolment(
    mfaToken: string | undefined,
    code: string,
  ): Promise<SignedIn & { recoveryCodes: string[] }> {
    const challenge = await this.auth.readChallenge(mfaToken);
    if (challenge.stage !== 'enrol') {
      throw new BadRequestException({
        code: 'MFA_NOT_PENDING',
        message: 'No set-up is in progress',
      });
    }
    const user = await this.loadUser(challenge.sub, challenge.org);
    this.assertNotLocked(user.mfaLockedUntil);
    if (user.mfaEnabled || !user.mfaPendingSecretEnc) {
      throw new BadRequestException({
        code: 'MFA_NOT_PENDING',
        message: 'Start the set-up again to get a new key',
      });
    }
    const secret = decryptSecret(user.mfaPendingSecretEnc, this.keyMaterial);
    const step = verifyTotp(secret, code, Date.now(), null);
    if (step === null) {
      await this.recordFailure(user.id, user.organizationId, user.mfaFailedAttempts);
      throw new UnauthorizedException({
        code: 'MFA_CODE_INVALID',
        message: 'That code is not right. Check the time on your phone and try the next code',
      });
    }

    const recoveryCodes = await this.storeNewRecoveryCodes(user.id, {
      mfaEnabled: true,
      mfaSecretEnc: user.mfaPendingSecretEnc,
      mfaPendingSecretEnc: null,
      mfaEnrolledAt: new Date(),
      mfaLastStep: step,
      mfaFailedAttempts: 0,
      mfaLockedUntil: null,
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'MFA_ENROLLED',
      targetType: 'User',
      targetId: user.id,
      summary: `${user.email} set up an authenticator app`,
    });
    const authUser = await this.auth.buildAuthUser(user.id, user.organizationId);
    return { ...(await this.auth.completeSignIn(authUser)), recoveryCodes };
  }

  async verify(
    mfaToken: string | undefined,
    input: { code?: string; recoveryCode?: string },
  ): Promise<SignedIn & { recoveryCodesRemaining?: number }> {
    const challenge = await this.auth.readChallenge(mfaToken);
    if (challenge.stage !== 'verify') throw new BadRequestException(NOT_ENROLLED);
    const user = await this.loadUser(challenge.sub, challenge.org);
    this.assertNotLocked(user.mfaLockedUntil);
    if (!user.mfaEnabled || !user.mfaSecretEnc) throw new BadRequestException(NOT_ENROLLED);

    let recoveryCodesRemaining: number | undefined;
    if (input.recoveryCode) {
      recoveryCodesRemaining = await this.useRecoveryCode(user, input.recoveryCode);
    } else {
      const secret = decryptSecret(user.mfaSecretEnc, this.keyMaterial);
      const step = verifyTotp(secret, input.code ?? '', Date.now(), user.mfaLastStep);
      if (step === null || !(await this.claimStep(user.id, step))) {
        await this.recordFailure(user.id, user.organizationId, user.mfaFailedAttempts);
        throw new UnauthorizedException({
          code: 'MFA_CODE_INVALID',
          message:
            'That code is not right or was already used. Wait for the next code and try again',
        });
      }
    }

    const authUser = await this.auth.buildAuthUser(user.id, user.organizationId);
    return { ...(await this.auth.completeSignIn(authUser)), recoveryCodesRemaining };
  }

  /** New recovery codes replace the old ones; the current authenticator code is required. */
  async regenerateRecoveryCodes(
    user: AuthUser,
    code: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const row = await this.loadUser(user.id, user.organizationId);
    this.assertNotLocked(row.mfaLockedUntil);
    if (!row.mfaEnabled || !row.mfaSecretEnc) throw new BadRequestException(NOT_ENROLLED);
    const step = verifyTotp(
      decryptSecret(row.mfaSecretEnc, this.keyMaterial),
      code,
      Date.now(),
      row.mfaLastStep,
    );
    if (step === null || !(await this.claimStep(row.id, step))) {
      await this.recordFailure(row.id, row.organizationId, row.mfaFailedAttempts);
      throw new UnauthorizedException({
        code: 'MFA_CODE_INVALID',
        message: 'That code is not right or was already used',
      });
    }
    const recoveryCodes = await this.storeNewRecoveryCodes(row.id, {});
    await this.audit.record({
      organizationId: row.organizationId,
      actorId: row.id,
      action: 'MFA_RECOVERY_CODES_REGENERATED',
      targetType: 'User',
      targetId: row.id,
      summary: `${row.email} replaced their recovery codes`,
    });
    return { recoveryCodes };
  }

  /**
   * Takes a time step for good. The update is conditional, so two requests carrying the same
   * code cannot both succeed.
   */
  private async claimStep(userId: string, step: number): Promise<boolean> {
    const result = await this.prisma.user.updateMany({
      where: { id: userId, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] },
      data: { mfaLastStep: step, mfaFailedAttempts: 0, mfaLockedUntil: null },
    });
    return result.count === 1;
  }

  private async storeNewRecoveryCodes(
    userId: string,
    userData: Record<string, unknown>,
  ): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    const hashes = await Promise.all(codes.map((c) => argon2.hash(normaliseRecovery(c))));
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: userData }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.mfaRecoveryCode.createMany({
        data: hashes.map((codeHash) => ({ userId, codeHash })),
      }),
    ]);
    return codes;
  }

  private async useRecoveryCode(
    user: { id: string; organizationId: string; email: string; mfaFailedAttempts: number },
    supplied: string,
  ): Promise<number> {
    const candidate = normaliseRecovery(supplied);
    const open = await this.prisma.mfaRecoveryCode.findMany({
      where: { userId: user.id, usedAt: null },
    });
    let matchedId: string | null = null;
    for (const stored of open) {
      // Every stored code is checked so timing does not reveal how many are left.
      if (await argon2.verify(stored.codeHash, candidate).catch(() => false)) {
        matchedId ??= stored.id;
      }
    }
    const claimed = matchedId
      ? (
          await this.prisma.mfaRecoveryCode.updateMany({
            where: { id: matchedId, usedAt: null },
            data: { usedAt: new Date() },
          })
        ).count
      : 0;
    if (claimed !== 1) {
      await this.recordFailure(user.id, user.organizationId, user.mfaFailedAttempts);
      throw new UnauthorizedException({
        code: 'MFA_CODE_INVALID',
        message: 'That recovery code is not valid or was already used',
      });
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaFailedAttempts: 0, mfaLockedUntil: null },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'MFA_RECOVERY_CODE_USED',
      targetType: 'User',
      targetId: user.id,
      summary: `${user.email} signed in with a recovery code`,
    });
    return open.length - 1;
  }

  private async loadUser(id: string, organizationId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, organizationId, isActive: true },
    });
    if (!user) throw new UnauthorizedException('User account is unavailable');
    return user;
  }

  private assertNotLocked(lockedUntil: Date | null) {
    if (lockedUntil && lockedUntil.getTime() > Date.now()) {
      const minutes = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000));
      throw new HttpException(
        { code: 'MFA_LOCKED', message: `Too many wrong codes. Try again in ${minutes} minute(s)` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async recordFailure(userId: string, organizationId: string, previous: number) {
    const attempts = previous + 1;
    const lock = attempts >= MFA_MAX_FAILURES;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mfaFailedAttempts: lock ? 0 : attempts,
        mfaLockedUntil: lock ? new Date(Date.now() + MFA_LOCK_MINUTES * 60_000) : undefined,
      },
    });
    if (lock) {
      await this.audit.record({
        organizationId,
        actorId: userId,
        action: 'MFA_LOCKED',
        targetType: 'User',
        targetId: userId,
        summary: `Second step locked for ${MFA_LOCK_MINUTES} minutes after ${MFA_MAX_FAILURES} wrong codes`,
      });
    }
  }
}
