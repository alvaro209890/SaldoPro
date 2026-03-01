const rawBackendUrl = (import.meta.env.VITE_BACKEND_URL ?? '').trim();

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

const isLocalhostUrl = (value: string): boolean =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(value);

export const BACKEND_URL = rawBackendUrl
  ? normalizeUrl(rawBackendUrl)
  : (import.meta.env.DEV ? 'http://localhost:10000' : '');

if (!BACKEND_URL) {
  throw new Error('Missing VITE_BACKEND_URL for production build.');
}

if (import.meta.env.PROD && isLocalhostUrl(BACKEND_URL)) {
  throw new Error('Invalid VITE_BACKEND_URL in production: localhost is not allowed.');
}
