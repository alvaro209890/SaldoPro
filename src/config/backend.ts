const rawBackendUrl = (import.meta.env.VITE_BACKEND_URL ?? '').trim();
const defaultProductionBackendUrl = 'https://saldopro-whatsapp-backend.onrender.com';

const normalizeUrl = (value: string): string => value.replace(/\/+$/, '');
const isLocalhostUrl = (value: string): boolean => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(value);

export const BACKEND_URL = rawBackendUrl
  ? normalizeUrl(rawBackendUrl)
  : (import.meta.env.DEV ? 'http://localhost:10000' : defaultProductionBackendUrl);

export const MERCADO_PAGO_PUBLIC_KEY = (import.meta.env.VITE_MERCADO_PAGO_PUBLIC_KEY ?? '').trim();
export const MERCADO_PAGO_PUBLIC_KEY_IS_TEST = MERCADO_PAGO_PUBLIC_KEY.startsWith('TEST-');

if (import.meta.env.PROD && isLocalhostUrl(BACKEND_URL)) {
  throw new Error('Invalid VITE_BACKEND_URL in production: localhost is not allowed.');
}
