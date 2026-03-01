import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

interface AdminSessionPayload {
  role: 'admin';
  exp: number;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signPayload(payloadBase64: string): string {
  return createHmac('sha256', env.adminPanelSessionSecret).update(payloadBase64).digest('base64url');
}

function secureDigest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function isValidAdminPassword(password: string): boolean {
  const provided = secureDigest(password);
  const expected = secureDigest(env.adminPanelPassword);
  return timingSafeEqual(provided, expected);
}

export function createAdminSessionToken(): { token: string; expiresAt: string } {
  const expiresAtMs = Date.now() + env.adminPanelSessionTtlHours * 60 * 60 * 1000;
  const payload: AdminSessionPayload = {
    role: 'admin',
    exp: expiresAtMs
  };

  const payloadBase64 = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(payloadBase64);
  return {
    token: `${payloadBase64}.${signature}`,
    expiresAt: new Date(expiresAtMs).toISOString()
  };
}

export function verifyAdminSessionToken(token: string): { valid: true; expiresAt: string } | { valid: false } {
  const trimmed = token.trim();
  if (!trimmed) return { valid: false };

  const [payloadBase64, signature] = trimmed.split('.');
  if (!payloadBase64 || !signature) return { valid: false };

  const expectedSignature = signPayload(payloadBase64);
  const provided = Buffer.from(signature, 'utf8');
  const expected = Buffer.from(expectedSignature, 'utf8');

  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { valid: false };
  }

  try {
    const payload = JSON.parse(fromBase64Url(payloadBase64)) as AdminSessionPayload;
    if (payload.role !== 'admin' || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) {
      return { valid: false };
    }

    return {
      valid: true,
      expiresAt: new Date(payload.exp).toISOString()
    };
  } catch {
    return { valid: false };
  }
}
