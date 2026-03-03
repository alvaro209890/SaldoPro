"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FREE_WHATSAPP_DAILY_LIMIT = exports.WHATSAPP_FREE_QUOTA_CHANNEL = void 0;
exports.getCurrentBrasiliaQuotaDate = getCurrentBrasiliaQuotaDate;
exports.getNextBrasiliaMidnightUtcIso = getNextBrasiliaMidnightUtcIso;
exports.getDailyAiQuotaState = getDailyAiQuotaState;
exports.getFreeWhatsAppQuotaState = getFreeWhatsAppQuotaState;
exports.consumeDailyAiQuota = consumeDailyAiQuota;
exports.consumeFreeWhatsAppQuota = consumeFreeWhatsAppQuota;
const supabase_1 = require("./supabase");
const DAILY_AI_QUOTA_TABLE = 'app_daily_ai_quotas';
const CONSUME_DAILY_AI_QUOTA_RPC = 'consume_daily_ai_quota';
const BRASILIA_TIMEZONE = 'America/Sao_Paulo';
exports.WHATSAPP_FREE_QUOTA_CHANNEL = 'whatsapp_free';
exports.FREE_WHATSAPP_DAILY_LIMIT = 1;
function assertNoError(error, context) {
    if (!error)
        return;
    throw new Error(`${context}: ${error.message}`);
}
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
    const year = String(parts.year).padStart(4, '0');
    const month = String(parts.month).padStart(2, '0');
    const day = String(parts.day).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function getNextBrasiliaMidnightUtcIso(now = new Date()) {
    const parts = getBrasiliaDateParts(now);
    const nextMidnightUtc = Date.UTC(parts.year, parts.month - 1, parts.day + 1, 3, 0, 0, 0);
    return new Date(nextMidnightUtc).toISOString();
}
async function getDailyAiQuotaState(uid, channel, limit, enabled) {
    const quotaDate = getCurrentBrasiliaQuotaDate();
    const { data, error } = await supabase_1.supabaseAdmin
        .from(DAILY_AI_QUOTA_TABLE)
        .select('used_count')
        .eq('uid', uid)
        .eq('quota_date', quotaDate)
        .eq('channel', channel)
        .maybeSingle();
    assertNoError(error, 'getDailyAiQuotaState');
    const used = Math.max(0, Number(data?.used_count ?? 0));
    return {
        enabled,
        limit,
        used,
        remaining: Math.max(limit - used, 0),
        quotaDate,
        resetsAt: getNextBrasiliaMidnightUtcIso()
    };
}
async function getFreeWhatsAppQuotaState(uid, enabled) {
    return getDailyAiQuotaState(uid, exports.WHATSAPP_FREE_QUOTA_CHANNEL, exports.FREE_WHATSAPP_DAILY_LIMIT, enabled);
}
async function consumeDailyAiQuota(uid, channel, limit, enabled = true) {
    const quotaDate = getCurrentBrasiliaQuotaDate();
    const { data, error } = await supabase_1.supabaseAdmin.rpc(CONSUME_DAILY_AI_QUOTA_RPC, {
        p_uid: uid,
        p_quota_date: quotaDate,
        p_channel: channel,
        p_limit: limit
    });
    assertNoError(error, 'consumeDailyAiQuota');
    const row = Array.isArray(data) ? data[0] : undefined;
    const used = Math.max(0, Number(row?.used_count ?? 0));
    const remaining = Math.max(0, Number(row?.remaining_count ?? Math.max(limit - used, 0)));
    return {
        allowed: Boolean(row?.allowed),
        enabled,
        limit,
        used,
        remaining,
        quotaDate,
        resetsAt: getNextBrasiliaMidnightUtcIso()
    };
}
async function consumeFreeWhatsAppQuota(uid) {
    return consumeDailyAiQuota(uid, exports.WHATSAPP_FREE_QUOTA_CHANNEL, exports.FREE_WHATSAPP_DAILY_LIMIT);
}
