import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/** AES-256-GCM for authenticator secrets at rest: a database copy alone cannot generate codes. */
function keyFrom(material: string): Buffer {
  return createHash('sha256').update(material).digest();
}

export function encryptSecret(plain: string, keyMaterial: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(keyMaterial), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    body.toString('base64'),
  ].join('.');
}

export function decryptSecret(stored: string, keyMaterial: string): string {
  const [version, iv, tag, body] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('Unreadable authenticator secret');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(keyMaterial), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}
