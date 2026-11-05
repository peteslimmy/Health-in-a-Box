import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import * as argon2 from 'argon2';
import { AuthService, REFRESH_GRACE_MS } from './auth.service';

jest.mock('argon2', () => ({
  hash: jest.fn(async () => 'dummy-hash'),
  verify: jest.fn(async () => false),
}));

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function build(settings: Record<string, string> = {}) {
  const sessions = new Map<string, Record<string, unknown>>();
  const user = {
    id: 'u1',
    organizationId: 'org-1',
    email: 'u@test.local',
    fullName: 'U',
    isActive: true,
    roleAssignments: [],
  };
  const prisma = {
    user: { findFirst: jest.fn().mockResolvedValue(user), update: jest.fn() },
    refreshSession: {
      create: jest.fn(async ({ data }) => {
        sessions.set(data.id, { ...data, revokedAt: null, rotatedAt: null });
        return data;
      }),
      findUnique: jest.fn(async ({ where }) => sessions.get(where.id) ?? null),
      update: jest.fn(async ({ where, data }) => Object.assign(sessions.get(where.id)!, data)),
      updateMany: jest.fn(async ({ where, data }) => {
        for (const session of sessions.values()) {
          if (session.tokenHash === where.tokenHash && !session.revokedAt)
            Object.assign(session, data);
        }
        return { count: 1 };
      }),
    },
  };
  const config = {
    getOrThrow: (key: string) => `test-secret-for-${key}-0123456789`,
    get: (key: string, fallback?: string) => settings[key] ?? fallback,
  };
  const access = { check: jest.fn(async () => ({ allowed: true })) };
  const service = new AuthService(
    prisma as never,
    new JwtService({}),
    config as never,
    access as never,
  );
  return { service, sessions, prisma, access };
}

/** Signs in through the internal path used by login() and returns the refresh token. */
async function issue(service: AuthService) {
  const authUser = await service.buildAuthUser('u1', 'org-1');
  const tokens = await (
    service as unknown as { issueTokens: (u: unknown) => Promise<{ refreshToken: string }> }
  ).issueTokens(authUser);
  return tokens.refreshToken;
}

describe('refresh token rotation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('issues a new token pair and marks the old session as rotated', async () => {
    const { service, sessions } = build();
    const first = await issue(service);
    const { tokens } = await service.refresh(first);
    expect(tokens.refreshToken).not.toBe(first);
    const old = [...sessions.values()].find((s) => s.tokenHash === sha256(first))!;
    expect(old.rotatedAt).toBeInstanceOf(Date);
    expect(old.revokedAt).toBeNull();
  });

  it('still honours the old token inside the grace window (reload or lost response)', async () => {
    const { service } = build();
    const first = await issue(service);
    await service.refresh(first); // the response never reaches the browser
    await expect(service.refresh(first)).resolves.toMatchObject({
      tokens: { accessToken: expect.any(String) },
    });
  });

  it('rejects the old token once the grace window has passed', async () => {
    const { service } = build();
    const first = await issue(service);
    await service.refresh(first);
    // Move only Date.now() forward (fake timers would stall the JWT library's async signing).
    const realNow = Date.now.bind(Date);
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + REFRESH_GRACE_MS + 1_000);
    await expect(service.refresh(first)).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('never accepts a token after logout, even inside the grace window', async () => {
    const { service } = build();
    const first = await issue(service);
    await service.logout(first);
    await expect(service.refresh(first)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a missing, malformed or forged token', async () => {
    const { service } = build();
    await expect(service.refresh(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.refresh('not-a-jwt')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('sign-in does the same work whether or not the account exists', () => {
  const verify = argon2.verify as unknown as jest.Mock;
  beforeEach(() => verify.mockClear());

  it('checks a password even for an unknown email (no timing oracle)', async () => {
    const { service, prisma } = build();
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      service.login({ email: 'ghost@test.local', password: 'whatever-1' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('gives the same message for an unknown email and a wrong password', async () => {
    const { service, prisma } = build();
    prisma.user.findFirst.mockResolvedValue(null);
    const unknown = await service
      .login({ email: 'ghost@test.local', password: 'x'.repeat(10) })
      .catch((e: Error) => e.message);
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      organizationId: 'org-1',
      passwordHash: 'real-hash',
      isActive: true,
      email: 'u@test.local',
      fullName: 'U',
      roleAssignments: [],
    });
    const wrong = await service
      .login({ email: 'u@test.local', password: 'x'.repeat(10) })
      .catch((e: Error) => e.message);
    expect(unknown).toBe('Invalid email or password');
    expect(wrong).toBe(unknown);
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it('issues tokens only when the password verifies', async () => {
    const { service, prisma } = build();
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      organizationId: 'org-1',
      passwordHash: 'real-hash',
      isActive: true,
      email: 'u@test.local',
      fullName: 'U',
      roleAssignments: [],
    });
    verify.mockResolvedValueOnce(true);
    const result = await service.login({ email: 'u@test.local', password: 'correct-horse' });
    expect(result.kind).toBe('session');
    if (result.kind === 'session') expect(result.tokens.accessToken).toEqual(expect.any(String));
  });

  it('signs access tokens with HS256 only', async () => {
    const { service, prisma } = build();
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      organizationId: 'org-1',
      passwordHash: 'h',
      isActive: true,
      email: 'u@test.local',
      fullName: 'U',
      roleAssignments: [],
    });
    verify.mockResolvedValueOnce(true);
    const result = await service.login({ email: 'u@test.local', password: 'correct-horse' });
    if (result.kind !== 'session') throw new Error('expected a session');
    const { tokens } = result;
    const header = JSON.parse(
      Buffer.from(tokens.accessToken.split('.')[0], 'base64url').toString(),
    );
    expect(header.alg).toBe('HS256');
  });
});

describe('second factor at sign-in', () => {
  const verify = argon2.verify as unknown as jest.Mock;
  const approver = (mfaEnabled: boolean) => ({
    id: 'u1',
    organizationId: 'org-1',
    passwordHash: 'h',
    isActive: true,
    email: 'u@test.local',
    fullName: 'U',
    mfaEnabled,
    roleAssignments: [
      {
        hospitalId: null,
        role: {
          code: 'FINANCE_MANAGER',
          isActive: true,
          permissions: [{ permission: { code: 'payments.approve' } }],
        },
      },
    ],
  });
  const reader = (mfaEnabled = false) => ({
    ...approver(mfaEnabled),
    roleAssignments: [
      {
        hospitalId: null,
        role: {
          code: 'AUDITOR',
          isActive: true,
          permissions: [{ permission: { code: 'payments.read' } }],
        },
      },
    ],
  });
  const login = (service: AuthService) =>
    service.login({ email: 'u@test.local', password: 'correct-horse' });

  beforeEach(() => verify.mockReset().mockResolvedValue(true));

  it('does not open a session for an approver who has not enrolled; it asks them to enrol', async () => {
    const { service, prisma } = build({ MFA_ENFORCEMENT: 'privileged' });
    prisma.user.findFirst.mockResolvedValue(approver(false));
    const result = await login(service);
    expect(result).toMatchObject({ kind: 'mfa', stage: 'enrol' });
    expect(prisma.refreshSession.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('asks an enrolled person for a code and opens no session yet', async () => {
    const { service, prisma } = build({ MFA_ENFORCEMENT: 'privileged' });
    prisma.user.findFirst.mockResolvedValue(reader(true));
    const result = await login(service);
    expect(result).toMatchObject({ kind: 'mfa', stage: 'verify' });
    expect(prisma.refreshSession.create).not.toHaveBeenCalled();
  });

  it('lets a read-only person in with a password when only privileged roles are enforced', async () => {
    const { service, prisma } = build({ MFA_ENFORCEMENT: 'privileged' });
    prisma.user.findFirst.mockResolvedValue(reader());
    expect((await login(service)).kind).toBe('session');
  });

  it('requires everyone to enrol when enforcement is "all"', async () => {
    const { service, prisma } = build({ MFA_ENFORCEMENT: 'all' });
    prisma.user.findFirst.mockResolvedValue(reader());
    expect(await login(service)).toMatchObject({ kind: 'mfa', stage: 'enrol' });
  });

  it('is off by default outside production and on by default in production', async () => {
    const dev = build();
    dev.prisma.user.findFirst.mockResolvedValue(approver(false));
    expect((await login(dev.service)).kind).toBe('session');
    const prod = build({ NODE_ENV: 'production' });
    prod.prisma.user.findFirst.mockResolvedValue(approver(false));
    expect((await login(prod.service)).kind).toBe('mfa');
  });

  it('a challenge token cannot be used as an access token or as a refresh token', async () => {
    const { service, prisma } = build({ MFA_ENFORCEMENT: 'privileged' });
    prisma.user.findFirst.mockResolvedValue(approver(true));
    const result = await login(service);
    if (result.kind !== 'mfa') throw new Error('expected a challenge');
    const payload = await service.readChallenge(result.token);
    expect(payload.type).toBe('mfa');
    await expect(service.refresh(result.token)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.readChallenge('garbage')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('ends a session at refresh when its owner now needs a second factor and has none', async () => {
    const { service, prisma, sessions } = build({ MFA_ENFORCEMENT: 'privileged' });
    prisma.user.findFirst.mockResolvedValue(reader());
    const first = await issue(service);
    prisma.user.findFirst.mockResolvedValue(approver(false)); // given an approving role since
    await expect(service.refresh(first)).rejects.toThrow('Multi-factor sign-in is required');
    expect([...sessions.values()][0].revokedAt).toBeInstanceOf(Date);
  });
});

describe('which email addresses may sign in', () => {
  const verify = argon2.verify as unknown as jest.Mock;
  const person = (email: string, roleCode = 'FINANCE_OFFICER') => ({
    id: 'u1',
    organizationId: 'org-1',
    passwordHash: 'h',
    isActive: true,
    email,
    fullName: 'U',
    mfaEnabled: false,
    roleAssignments: [
      {
        hospitalId: null,
        role: {
          code: roleCode,
          isActive: true,
          permissions: [{ permission: { code: 'payments.read' } }],
        },
      },
    ],
  });

  beforeEach(() => verify.mockReset().mockResolvedValue(true));

  it('refuses a correct password when the address is not allowed, with the reason', async () => {
    const { service, prisma, access } = build();
    prisma.user.findFirst.mockResolvedValue(person('someone@gmail.com'));
    access.check.mockResolvedValue({
      allowed: false,
      code: 'GMAIL_RESERVED',
      message: 'Gmail addresses are blocked. Only registered super admins may use Gmail',
    } as never);
    await expect(
      service.login({ email: 'someone@gmail.com', password: 'correct-horse' }),
    ).rejects.toMatchObject({
      response: { code: 'EMAIL_NOT_PERMITTED', message: expect.stringContaining('Gmail') },
    });
    expect(prisma.refreshSession.create).not.toHaveBeenCalled();
  });

  it('tells the policy whether the person is a super admin, using their roles', async () => {
    const { service, prisma, access } = build();
    prisma.user.findFirst.mockResolvedValue(person('owner@gmail.com', 'SUPER_ADMIN'));
    await service.buildAuthUser('u1', 'org-1');
    expect(access.check).toHaveBeenLastCalledWith('org-1', 'owner@gmail.com', true);
    prisma.user.findFirst.mockResolvedValue(person('staff@4coretech.com'));
    await service.buildAuthUser('u1', 'org-1');
    expect(access.check).toHaveBeenLastCalledWith('org-1', 'staff@4coretech.com', false);
  });

  it('applies on every request and refresh, so withdrawing a domain ends access at once', async () => {
    const { service, prisma, access } = build();
    prisma.user.findFirst.mockResolvedValue(person('staff@4coretech.com'));
    const first = await issue(service);
    access.check.mockResolvedValue({
      allowed: false,
      code: 'DOMAIN_NOT_APPROVED',
      message: 'The email domain "4coretech.com" is not on the approved list for this application',
    } as never);
    await expect(service.buildAuthUser('u1', 'org-1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.refresh(first)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
