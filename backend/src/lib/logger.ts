export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface OperationalLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
}

const MAX_RECENT_LOGS = 200;
const recentLogs: OperationalLogEntry[] = [];

function serializeMeta(meta: unknown): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  if (meta instanceof Error) {
    return {
      error: {
        name: meta.name,
        message: meta.message,
        stack: meta.stack
      }
    };
  }
  if (typeof meta === 'object') {
    return meta as Record<string, unknown>;
  }
  return { value: meta };
}

function log(level: LogLevel, message: string, meta?: unknown): void {
  const serializedMeta = serializeMeta(meta);
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(serializedMeta ?? {})
  };
  recentLogs.push({
    timestamp: payload.timestamp,
    level,
    message,
    ...(serializedMeta ? { meta: serializedMeta } : {})
  });
  if (recentLogs.length > MAX_RECENT_LOGS) {
    recentLogs.splice(0, recentLogs.length - MAX_RECENT_LOGS);
  }
  const output = JSON.stringify(payload);
  if (level === 'error') {
    console.error(output);
    return;
  }
  if (level === 'warn') {
    console.warn(output);
    return;
  }
  console.log(output);
}

export function getRecentOperationalLogs(limit = 50): OperationalLogEntry[] {
  const safeLimit = Math.max(1, Math.floor(limit));
  return recentLogs.slice(-safeLimit);
}

export const logger = {
  debug: (message: string, meta?: unknown): void => log('debug', message, meta),
  info: (message: string, meta?: unknown): void => log('info', message, meta),
  warn: (message: string, meta?: unknown): void => log('warn', message, meta),
  error: (message: string, meta?: unknown): void => log('error', message, meta)
};
