"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FREE_WHATSAPP_DAILY_LIMIT = exports.WHATSAPP_FREE_QUOTA_CHANNEL = void 0;
exports.getCurrentBrasiliaQuotaDate = getCurrentBrasiliaQuotaDate;
exports.getNextBrasiliaMidnightUtcIso = getNextBrasiliaMidnightUtcIso;
exports.getDailyAiQuotaState = getDailyAiQuotaState;
exports.getFreeWhatsAppQuotaState = getFreeWhatsAppQuotaState;
exports.consumeDailyAiQuota = consumeDailyAiQuota;
exports.consumeFreeWhatsAppQuota = consumeFreeWhatsAppQuota;
const local_db_1 = require("./local-db");
const BRASILIA_TIMEZONE = 'America/Sao_Paulo';
exports.WHATSAPP_FREE_QUOTA_CHANNEL = 'whatsapp_free';
exports.FREE_WHATSAPP_DAILY_LIMIT = 2;
function getBrasiliaDateParts(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: BRASILIA_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(now);
    const map = new Map();
    for (const part of parts) {
        if (part.type !== 'literal') {
            map.set(part.type, part.value);
        }
    }
    return {
        year: Number(map.get('year') ?? 0),
        month: Number(map.get('month') ?? 0),
        day: Number(map.get('day') ?? 0)
    };
}
function getCurrentBrasiliaQuotaDate(now = new Date()) {
    const parts = getBrasiliaDateParts(now);
    return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}
function getNextBrasiliaMidnightUtcIso(now = new Date()) {
    const parts = getBrasiliaDateParts(now);
    const nextMidnightUtc = Date.UTC(parts.year, parts.month - 1, parts.day + 1, 3, 0, 0, 0);
    return new Date(nextMidnightUtc).toISOString();
}
function buildState(used, limit, enabled, quotaDate) {
    return {
        enabled,
        limit,
        used,
        remaining: Math.max(limit - used, 0),
        quotaDate,
        resetsAt: getNextBrasiliaMidnightUtcIso()
    };
}
async function getDailyAiQuotaState(uid, channel, limit, enabled) {
    const quotaDate = getCurrentBrasiliaQuotaDate();
    const row = local_db_1.db.prepare(`
    select used_count as usedCount
    from app_daily_ai_quotas
    where uid = ? and quota_date = ? and channel = ?
    limit 1
  `).get(uid, quotaDate, channel);
    return buildState(Number(row?.usedCount ?? 0), limit, enabled, quotaDate);
}
async function getFreeWhatsAppQuotaState(uid, enabled) {
    return getDailyAiQuotaState(uid, exports.WHATSAPP_FREE_QUOTA_CHANNEL, exports.FREE_WHATSAPP_DAILY_LIMIT, enabled);
}
async function consumeDailyAiQuota(uid, channel, limit, enabled = true) {
    const quotaDate = getCurrentBrasiliaQuotaDate();
    const now = (0, local_db_1.nowIso)();
    local_db_1.db.prepare(`
    insert into app_daily_ai_quotas (uid, quota_date, channel, used_count, created_at, updated_at)
    values (?, ?, ?, 0, ?, ?)
    on conflict(uid, quota_date, channel) do nothing
  `).run(uid, quotaDate, channel, now, now);
    const current = local_db_1.db.prepare(`
    select used_count as usedCount
    from app_daily_ai_quotas
    where uid = ? and quota_date = ? and channel = ?
    limit 1
  `).get(uid, quotaDate, channel);
    const used = Number(current?.usedCount ?? 0);
    if (used >= limit) {
        return {
            allowed: false,
            ...buildState(used, limit, enabled, quotaDate)
        };
    }
    const nextUsed = used + 1;
    local_db_1.db.prepare(`
    update app_daily_ai_quotas
    set used_count = ?, updated_at = ?
    where uid = ? and quota_date = ? and channel = ?
  `).run(nextUsed, (0, local_db_1.nowIso)(), uid, quotaDate, channel);
    return {
        allowed: true,
        ...buildState(nextUsed, limit, enabled, quotaDate)
    };
}
async function consumeFreeWhatsAppQuota(uid) {
    return consumeDailyAiQuota(uid, exports.WHATSAPP_FREE_QUOTA_CHANNEL, exports.FREE_WHATSAPP_DAILY_LIMIT);
}
