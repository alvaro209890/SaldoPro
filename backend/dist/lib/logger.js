"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.getRecentOperationalLogs = getRecentOperationalLogs;
const MAX_RECENT_LOGS = 200;
const recentLogs = [];
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
function getRecentOperationalLogs(limit = 50) {
    const safeLimit = Math.max(1, Math.floor(limit));
    return recentLogs.slice(-safeLimit);
}
exports.logger = {
    debug: (message, meta) => log('debug', message, meta),
    info: (message, meta) => log('info', message, meta),
    warn: (message, meta) => log('warn', message, meta),
    error: (message, meta) => log('error', message, meta)
};
