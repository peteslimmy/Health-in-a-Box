const REQUIRED = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const;

/** Values copied from documentation or examples must never reach a real deployment. */
const PLACEHOLDER = /replace[-_ ]?with|change[-_ ]?me|example|secret[-_ ]?here|your[-_ ]/i;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  for (const key of REQUIRED) {
    const value = config[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  const access = String(config.JWT_ACCESS_SECRET);
  const refresh = String(config.JWT_REFRESH_SECRET);
  if (access.length < 32 || refresh.length < 32) {
    throw new Error('JWT secrets must be at least 32 characters');
  }
  if (access === refresh) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
  }

  const enforcement = text(config.MFA_ENFORCEMENT);
  if (enforcement !== '' && !['off', 'privileged', 'all'].includes(enforcement)) {
    throw new Error('MFA_ENFORCEMENT must be off, privileged or all');
  }

  const port = Number(config.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port');
  }

  if (config.NODE_ENV === 'production') {
    const problems: string[] = [];
    if (PLACEHOLDER.test(access) || PLACEHOLDER.test(refresh)) {
      problems.push('JWT secrets still look like the placeholders from .env.example');
    }
    if (text(config.COOKIE_SECURE) !== 'true') {
      problems.push('COOKIE_SECURE must be true (the refresh cookie must only travel over HTTPS)');
    }
    const origins = text(config.FRONTEND_ORIGIN)
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (
      origins.length === 0 ||
      origins.some((origin) => origin === '*' || /localhost|127\.0\.0\.1/.test(origin))
    ) {
      problems.push('FRONTEND_ORIGIN must list the real web app origin(s), not * or localhost');
    }
    const mfaKey = text(config.MFA_ENCRYPTION_KEY);
    if (mfaKey.length < 32 || PLACEHOLDER.test(mfaKey) || mfaKey === access || mfaKey === refresh) {
      problems.push(
        'MFA_ENCRYPTION_KEY must be a separate random secret of at least 32 characters (it protects authenticator secrets)',
      );
    }
    if (text(config.MFA_ENFORCEMENT) === 'off') {
      problems.push('MFA_ENFORCEMENT must not be off (use privileged or all)');
    }
    if (config.STORAGE_DRIVER !== 'minio') {
      problems.push('STORAGE_DRIVER must be minio (private object storage), not local disk');
    }
    if (
      /hnb_dev_password|hnb_minio_password/.test(
        text(config.DATABASE_URL) + text(config.MINIO_SECRET_KEY),
      )
    ) {
      problems.push('database and storage credentials still use the development defaults');
    }
    if (problems.length > 0) {
      throw new Error(`Unsafe production configuration:\n - ${problems.join('\n - ')}`);
    }
  }

  return config;
}
