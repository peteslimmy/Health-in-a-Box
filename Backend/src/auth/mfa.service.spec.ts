import { UnauthorizedException } from '@nestjs/common';
import { MfaService, MFA_MAX_FAILURES } from './mfa.service';
import { decryptSecret } from './mfa-crypto';
import { totpAt } from './totp';

jest.setTimeout(30_000);

const KEY = 'test-config-key-material';

type Row = Record<string, any>;

function build() {
  const user: Row = {
    id: 'u1',
    organizationId: 'org-1',
    email: 'approver@test.local',
    passwordHash: 'x',
    isActive: true,
    mfaEnabled: false,
    mfaSecretEnc: null,
    mfaPendingSecretEnc: null,
    mfaLastStep: null,
    mfaFailedAttempts: 0,
    mfaLockedUntil: null,
  };
  const recovery: Row[] = [];
  const matches = (where: Row) =>
    (where.id === undefined || where.id === user.id) &&
    (where.OR === undefined ||
      where.OR.some(
        (c: Row) =>
          (c.mfaLastStep === null && user.mfaLastStep === null) ||
          (c.mfaLastStep?.lt !== undefined &&
            user.mfaLastStep !== null &&
            user.mfaLastStep < c.mfaLastStep.lt),
      ));
  const prisma = {
    user: {
      findFirst: jest.fn(async () => ({ ...user })),
      update: jest.fn(async ({ data }: Row) => {
        for (const [k, v] of Object.entries(data)) if (v !== undefined) user[k] = v;
        return { ...user };
      }),
      updateMany: jest.fn(async ({ where, data }: Row) => {
        if (where.mfaPendingSecretEnc === null && user.mfaPendingSecretEnc !== null) {
          return { count: 0 };
        }
        if (!matches(where)) return { count: 0 };
        Object.assign(user, data);
        return { count: 1 };
      }),
    },
    mfaRecoveryCode: {
      findMany: jest.fn(async ({ where }: Row) =>
        recovery.filter((r) => r.userId === where.userId && r.usedAt === null),
      ),
      updateMany: jest.fn(async ({ where, data }: Row) => {
        const row = recovery.find((r) => r.id === where.id && r.usedAt === null);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
      deleteMany: jest.fn(async () => {
        recovery.length = 0;
        return { count: 0 };
      }),
      createMany: jest.fn(async ({ data }: Row) => {
        data.forEach((d: Row, i: number) => recovery.push({ id: `r${i}`, usedAt: null, ...d }));
        return { count: data.length };
      }),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const auth = {
    readChallenge: jest.fn(async (token: string) => {
      if (token === 'enrol-token') return { sub: 'u1', org: 'org-1', type: 'mfa', stage: 'enrol' };
      if (token === 'verify-token')
        return { sub: 'u1', org: 'org-1', type: 'mfa', stage: 'verify' };
      throw new UnauthorizedException('expired');
    }),
    signChallenge: jest.fn(async () => 'enrol-token'),
    buildAuthUser: jest.fn(async () => ({ id: 'u1', organizationId: 'org-1' })),
    completeSignIn: jest.fn(async (u: unknown) => ({
      user: u,
      tokens: { accessToken: 'a', refreshToken: 'r', refreshTtl: 1 },
    })),
  };
  const audit = { record: jest.fn(async () => ({})) };
  const config = {
    get: (key: string, fallback?: string) => (key === 'MFA_ENCRYPTION_KEY' ? KEY : fallback),
    getOrThrow: () => 'refresh-secret',
  };
  const service = new MfaService(prisma as never, auth as never, audit as never, config as never);
  return { service, user, recovery, prisma, auth, audit };
}

/** Walks through enrolment and returns the secret and the recovery codes. */
async function enrol(ctx: ReturnType<typeof build>) {
  const { secret } = await ctx.service.startEnrolment('enrol-token');
  const result = await ctx.service.confirmEnrolment('enrol-token', totpAt(secret, Date.now()));
  return { secret, recoveryCodes: result.recoveryCodes };
}

describe('enrolment', () => {
  it('stores the secret encrypted and only after the first code is confirmed', async () => {
    const ctx = build();
    const started = await ctx.service.startEnrolment('enrol-token');
    expect(started.otpauthUri).toContain('otpauth://totp/');
    expect(ctx.user.mfaPendingSecretEnc).not.toContain(started.secret);
    expect(decryptSecret(ctx.user.mfaPendingSecretEnc, KEY)).toBe(started.secret);
    expect(ctx.user.mfaEnabled).toBe(false);

    await ctx.service.confirmEnrolment('enrol-token', totpAt(started.secret, Date.now()));
    expect(ctx.user.mfaEnabled).toBe(true);
    expect(ctx.user.mfaPendingSecretEnc).toBeNull();
    expect(ctx.user.mfaSecretEnc).not.toContain(started.secret);
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MFA_ENROLLED' }),
    );
  });

  it('shows the same key when set-up is started twice, so the key on screen is the one checked', async () => {
    const ctx = build();
    const [a, b] = await Promise.all([
      ctx.service.startEnrolment('enrol-token'),
      ctx.service.startEnrolment('enrol-token'),
    ]);
    const again = await ctx.service.startEnrolment('enrol-token');
    expect(a.secret).toBe(b.secret);
    expect(again.secret).toBe(a.secret);
    expect(decryptSecret(ctx.user.mfaPendingSecretEnc, KEY)).toBe(a.secret);
  });

  it('refuses a wrong first code and leaves the account unenrolled', async () => {
    const ctx = build();
    await ctx.service.startEnrolment('enrol-token');
    await expect(ctx.service.confirmEnrolment('enrol-token', '000000')).rejects.toMatchObject({
      response: { code: 'MFA_CODE_INVALID' },
    });
    expect(ctx.user.mfaEnabled).toBe(false);
    expect(ctx.auth.completeSignIn).not.toHaveBeenCalled();
  });

  it('opens the session and returns eight single-use recovery codes, stored only as hashes', async () => {
    const ctx = build();
    const { recoveryCodes } = await enrol(ctx);
    expect(ctx.auth.completeSignIn).toHaveBeenCalledTimes(1);
    expect(recoveryCodes).toHaveLength(8);
    expect(new Set(recoveryCodes).size).toBe(8);
    expect(recoveryCodes[0]).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
    expect(ctx.recovery).toHaveLength(8);
    expect(JSON.stringify(ctx.recovery)).not.toContain(recoveryCodes[0].replace('-', ''));
  });

  it('will not start for an account that is already enrolled, or from a verify-stage token', async () => {
    const ctx = build();
    await enrol(ctx);
    await expect(ctx.service.startEnrolment('enrol-token')).rejects.toMatchObject({
      response: { code: 'MFA_ALREADY_ENABLED' },
    });
    await expect(ctx.service.startEnrolment('verify-token')).rejects.toBeDefined();
    await expect(ctx.service.startEnrolment('expired')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('second step of sign-in', () => {
  it('opens the session for a correct code and refuses the same code a second time', async () => {
    const ctx = build();
    const { secret } = await enrol(ctx);
    ctx.auth.completeSignIn.mockClear();
    // The enrolment consumed this time step; the next code (one step on) is acceptable.
    const next = totpAt(secret, Date.now() + 30_000);
    await ctx.service.verify('verify-token', { code: next });
    expect(ctx.auth.completeSignIn).toHaveBeenCalledTimes(1);
    await expect(ctx.service.verify('verify-token', { code: next })).rejects.toMatchObject({
      response: { code: 'MFA_CODE_INVALID' },
    });
    expect(ctx.auth.completeSignIn).toHaveBeenCalledTimes(1);
  });

  it('lets only one of two simultaneous requests with the same code through', async () => {
    const ctx = build();
    const { secret } = await enrol(ctx);
    ctx.auth.completeSignIn.mockClear();
    const code = totpAt(secret, Date.now() + 30_000);
    const results = await Promise.allSettled([
      ctx.service.verify('verify-token', { code }),
      ctx.service.verify('verify-token', { code }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(ctx.auth.completeSignIn).toHaveBeenCalledTimes(1);
  });

  it('locks the second step after repeated wrong codes, even for the right code, and audits it', async () => {
    const ctx = build();
    const { secret } = await enrol(ctx);
    for (let i = 0; i < MFA_MAX_FAILURES; i += 1) {
      await expect(ctx.service.verify('verify-token', { code: '111111' })).rejects.toBeDefined();
    }
    expect(ctx.user.mfaLockedUntil).toBeInstanceOf(Date);
    await expect(
      ctx.service.verify('verify-token', { code: totpAt(secret, Date.now() + 30_000) }),
    ).rejects.toMatchObject({ response: { code: 'MFA_LOCKED' }, status: 429 });
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MFA_LOCKED' }),
    );
  });

  it('a recovery code works once, then never again', async () => {
    const ctx = build();
    const { recoveryCodes } = await enrol(ctx);
    ctx.auth.completeSignIn.mockClear();
    const first = await ctx.service.verify('verify-token', { recoveryCode: recoveryCodes[0] });
    expect(first.recoveryCodesRemaining).toBe(7);
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MFA_RECOVERY_CODE_USED' }),
    );
    await expect(
      ctx.service.verify('verify-token', { recoveryCode: recoveryCodes[0] }),
    ).rejects.toMatchObject({ response: { code: 'MFA_CODE_INVALID' } });
    // Case and the dash do not matter when typing it in.
    await ctx.service.verify('verify-token', {
      recoveryCode: recoveryCodes[1].toLowerCase().replace('-', ' '),
    });
    expect(ctx.auth.completeSignIn).toHaveBeenCalledTimes(2);
  });

  it('refuses an enrol-stage token, an account without a second factor, and an empty request', async () => {
    const ctx = build();
    await expect(ctx.service.verify('enrol-token', { code: '123456' })).rejects.toBeDefined();
    await expect(ctx.service.verify('verify-token', { code: '123456' })).rejects.toMatchObject({
      response: { code: 'MFA_NOT_ENROLLED' },
    });
    await enrol(ctx);
    await expect(ctx.service.verify('verify-token', {})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('recovery codes', () => {
  it('are replaced only with a fresh authenticator code, and the old ones stop working', async () => {
    const ctx = build();
    const { secret, recoveryCodes } = await enrol(ctx);
    const actor = { id: 'u1', organizationId: 'org-1' } as never;
    await expect(ctx.service.regenerateRecoveryCodes(actor, '000000')).rejects.toBeDefined();
    const fresh = await ctx.service.regenerateRecoveryCodes(
      actor,
      totpAt(secret, Date.now() + 30_000),
    );
    expect(fresh.recoveryCodes).toHaveLength(8);
    await expect(
      ctx.service.verify('verify-token', { recoveryCode: recoveryCodes[2] }),
    ).rejects.toBeDefined();
    await expect(
      ctx.service.verify('verify-token', { recoveryCode: fresh.recoveryCodes[2] }),
    ).resolves.toBeDefined();
  });
});
