type LogLevel = 'debug' | 'info' | 'warn' | 'error';

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
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(serializeMeta(meta) ?? {})
  };
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

export const logger = {
  debug: (message: string, meta?: unknown): void => log('debug', message, meta),
  info: (message: string, meta?: unknown): void => log('info', message, meta),
  warn: (message: string, meta?: unknown): void => log('warn', message, meta),
  error: (message: string, meta?: unknown): void => log('error', message, meta)
};

