/**
 * Production Environment Validation Script
 * Verifies that all required environment variables and secrets are present,
 * securely configured, and non-default before allowing a production start.
 */

import { existsSync } from 'fs';
import { resolve } from 'path';

function checkProductionEnv() {
  console.log('=== HNB Receivables Platform: Production Environment Validator ===');
  const errors: string[] = [];
  const warnings: string[] = [];

  const env = process.env;
  const isProd = env.NODE_ENV === 'production';

  console.log(`Environment: ${env.NODE_ENV || 'development'}`);

  // 1. Core Secrets & URLs
  if (!env.DATABASE_URL) {
    errors.push('DATABASE_URL is missing');
  } else if (env.DATABASE_URL.includes('localhost') && isProd) {
    warnings.push('DATABASE_URL points to localhost in production');
  }

  const jwtAccess = env.JWT_ACCESS_SECRET || '';
  const jwtRefresh = env.JWT_REFRESH_SECRET || '';

  if (!jwtAccess || jwtAccess.length < 32) {
    errors.push('JWT_ACCESS_SECRET is missing or too short (minimum 32 characters required)');
  }
  if (!jwtRefresh || jwtRefresh.length < 32) {
    errors.push('JWT_REFRESH_SECRET is missing or too short (minimum 32 characters required)');
  }
  if (jwtAccess && jwtRefresh && jwtAccess === jwtRefresh) {
    errors.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must not be identical');
  }

  // 2. MFA Encryption Key
  const mfaKey = env.MFA_ENCRYPTION_KEY || '';
  if (isProd && (!mfaKey || mfaKey.length < 32)) {
    errors.push('MFA_ENCRYPTION_KEY is missing or too short in production (required for TOTP security)');
  }

  // 3. Cookie & CORS
  if (isProd) {
    if (env.COOKIE_SECURE !== 'true') {
      errors.push('COOKIE_SECURE must be set to "true" in production');
    }
    if (!env.FRONTEND_ORIGIN || env.FRONTEND_ORIGIN.includes('localhost')) {
      errors.push('FRONTEND_ORIGIN must be set to a valid public HTTPS domain in production');
    }
  }

  // 4. Storage Driver
  if (env.STORAGE_DRIVER === 'local' && isProd) {
    errors.push('STORAGE_DRIVER cannot be "local" in production. Use MinIO or S3 object storage.');
  }

  // Summary
  if (warnings.length > 0) {
    console.warn('\n⚠️ Warnings:');
    warnings.forEach(w => console.warn(`  - ${w}`));
  }

  if (errors.length > 0) {
    console.error('\n❌ Production Environment Validation Failed:');
    errors.forEach(e => console.error(`  - ${e}`));
    console.error('\nPlease fix these issues in your .env.production file before go-live.\n');
    process.exit(1);
  } else {
    console.log('\n✅ All production environment checks passed successfully!\n');
    process.exit(0);
  }
}

checkProductionEnv();
