"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
function serializeMeta(meta) {
    if (!meta)
        return undefined;
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
        return meta;
    }
    return { value: meta };
}
function log(level, message, meta) {
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
exports.logger = {
    debug: (message, meta) => log('debug', message, meta),
    info: (message, meta) => log('info', message, meta),
    warn: (message, meta) => log('warn', message, meta),
    error: (message, meta) => log('error', message, meta)
};
