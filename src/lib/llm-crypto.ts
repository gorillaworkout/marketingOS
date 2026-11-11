import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PREFIX = 'v1:';

function encryptionKey(): Buffer {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) throw new Error('JWT_SECRET is required to store the OpenRouter API key.');
  return createHash('sha256').update(`marketingos-llm-provider:${secret}`).digest();
}

/** AES-256-GCM. The key is derived from the existing JWT_SECRET. No new env var. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) throw new Error('Could not read the stored OpenRouter API key.');
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
  if (raw.length < 28) throw new Error('Could not read the stored OpenRouter API key.');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Could not read the stored OpenRouter API key.');
  }
}

/** Last four characters only. The full key never goes back to the browser. */
export function maskSecret(secret: string): string | null {
  const trimmed = secret.trim();
  if (trimmed.length < 4) return null;
  return `••••${trimmed.slice(-4)}`;
}

export function scrubSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .slice(0, 300);
}
