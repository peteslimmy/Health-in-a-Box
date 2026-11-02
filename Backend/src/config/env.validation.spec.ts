import { validateEnv } from './env.validation';

const SAFE = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app:Zq8v2m4pL7xR@db.internal:5432/hnb',
  JWT_ACCESS_SECRET: 'k3D9sL0pQw7ZxV1nB6mR8tY2uC5aE4hGfJ',
  JWT_REFRESH_SECRET: 'T7yH1gF5dS3aQ9wE2rV6bN8mK0jLxZcPoI',
  MFA_ENCRYPTION_KEY: 'p4W8eR2tY6uI0oA3sD7fG1hJ5kL9zXcVbN',
  COOKIE_SECURE: 'true',
  FRONTEND_ORIGIN: 'https://receivables.example-corp.com',
  STORAGE_DRIVER: 'minio',
  MINIO_SECRET_KEY: 'Vb7nM1kL9pQ4xZ2cR6tY8uI3oE5w',
};

describe('environment validation', () => {
  it('accepts a development environment with real-looking secrets', () => {
    expect(() =>
      validateEnv({
        DATABASE_URL: 'postgresql://x',
        JWT_ACCESS_SECRET: 'a'.repeat(40),
        JWT_REFRESH_SECRET: 'b'.repeat(40),
      }),
    ).not.toThrow();
  });

  it('rejects missing, short or identical JWT secrets in any environment', () => {
    expect(() =>
      validateEnv({
        DATABASE_URL: 'x',
        JWT_ACCESS_SECRET: 'short',
        JWT_REFRESH_SECRET: 'b'.repeat(40),
      }),
    ).toThrow(/32 characters/);
    expect(() =>
      validateEnv({
        DATABASE_URL: 'x',
        JWT_ACCESS_SECRET: 'a'.repeat(40),
        JWT_REFRESH_SECRET: 'a'.repeat(40),
      }),
    ).toThrow(/different/);
    expect(() =>
      validateEnv({ JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40) }),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects an unknown second-factor setting in any environment', () => {
    expect(() =>
      validateEnv({
        DATABASE_URL: 'x',
        JWT_ACCESS_SECRET: 'a'.repeat(40),
        JWT_REFRESH_SECRET: 'b'.repeat(40),
        MFA_ENFORCEMENT: 'sometimes',
      }),
    ).toThrow(/MFA_ENFORCEMENT/);
  });

  it('accepts a properly configured production environment', () => {
    expect(() => validateEnv({ ...SAFE })).not.toThrow();
  });

  it.each([
    [
      'the placeholder secrets from .env.example',
      { JWT_ACCESS_SECRET: 'replace-with-a-long-random-access-secret' },
      /placeholders/,
    ],
    ['no authenticator encryption key', { MFA_ENCRYPTION_KEY: '' }, /MFA_ENCRYPTION_KEY/],
    ['a short authenticator key', { MFA_ENCRYPTION_KEY: 'short' }, /MFA_ENCRYPTION_KEY/],
    [
      'an authenticator key equal to a JWT secret',
      { MFA_ENCRYPTION_KEY: 'k3D9sL0pQw7ZxV1nB6mR8tY2uC5aE4hGfJ' },
      /MFA_ENCRYPTION_KEY/,
    ],
    ['second factor switched off', { MFA_ENFORCEMENT: 'off' }, /MFA_ENFORCEMENT/],
    ['an insecure refresh cookie', { COOKIE_SECURE: 'false' }, /COOKIE_SECURE/],
    ['a localhost web origin', { FRONTEND_ORIGIN: 'http://localhost:5173' }, /FRONTEND_ORIGIN/],
    ['a wildcard web origin', { FRONTEND_ORIGIN: '*' }, /FRONTEND_ORIGIN/],
    ['local-disk file storage', { STORAGE_DRIVER: 'local' }, /STORAGE_DRIVER/],
    [
      'the development database password',
      { DATABASE_URL: 'postgresql://hnb:hnb_dev_password@db/hnb' },
      /development defaults/,
    ],
  ])('refuses production with %s', (_label, override, message) => {
    expect(() => validateEnv({ ...SAFE, ...override })).toThrow(message);
  });

  it('lists every problem at once', () => {
    expect(() => validateEnv({ ...SAFE, COOKIE_SECURE: 'false', STORAGE_DRIVER: 'local' })).toThrow(
      /COOKIE_SECURE[\s\S]*STORAGE_DRIVER/,
    );
  });
});
