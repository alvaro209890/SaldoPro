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
const BRASILIA_TIMEZONE = 'America/Sao_Paulo';
const QUOTA_UPDATE_MAX_ATTEMPTS = 3;
exports.WHATSAPP_FREE_QUOTA_CHANNEL = 'whatsapp_free';
exports.FREE_WHATSAPP_DAILY_LIMIT = 2;
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
    const nowIso = new Date().toISOString();
    const resetsAt = getNextBrasiliaMidnightUtcIso();
    const { error: upsertError } = await supabase_1.supabaseAdmin
        .from(DAILY_AI_QUOTA_TABLE)
        .upsert({
        uid,
        quota_date: quotaDate,
        channel,
        used_count: 0,
        created_at: nowIso,
        updated_at: nowIso
    }, {
        onConflict: 'uid,quota_date,channel',
        ignoreDuplicates: true
    });
    assertNoError(upsertError, 'consumeDailyAiQuota.ensureRow');
    for (let attempt = 0; attempt < QUOTA_UPDATE_MAX_ATTEMPTS; attempt += 1) {
        const { data: currentRow, error: currentError } = await supabase_1.supabaseAdmin
            .from(DAILY_AI_QUOTA_TABLE)
            .select('used_count')
            .eq('uid', uid)
            .eq('quota_date', quotaDate)
            .eq('channel', channel)
            .maybeSingle();
        assertNoError(currentError, 'consumeDailyAiQuota.readCurrent');
        const currentUsed = Math.max(0, Number(currentRow?.used_count ?? 0));
        if (currentUsed >= limit) {
            return {
                allowed: false,
                enabled,
                limit,
                used: currentUsed,
                remaining: 0,
                quotaDate,
                resetsAt
            };
        }
        const nextUsed = currentUsed + 1;
        const { data: updatedRow, error: updateError } = await supabase_1.supabaseAdmin
            .from(DAILY_AI_QUOTA_TABLE)
            .update({
            used_count: nextUsed,
            updated_at: new Date().toISOString()
        })
            .eq('uid', uid)
            .eq('quota_date', quotaDate)
            .eq('channel', channel)
            .eq('used_count', currentUsed)
            .select('used_count')
            .maybeSingle();
        assertNoError(updateError, 'consumeDailyAiQuota.compareAndSet');
        if (updatedRow) {
            return {
                allowed: true,
                enabled,
                limit,
                used: Math.max(0, Number(updatedRow.used_count)),
                remaining: Math.max(limit - nextUsed, 0),
                quotaDate,
                resetsAt
            };
        }
    }
    throw new Error('consumeDailyAiQuota: failed to update quota after retries');
}
async function consumeFreeWhatsAppQuota(uid) {
    return consumeDailyAiQuota(uid, exports.WHATSAPP_FREE_QUOTA_CHANNEL, exports.FREE_WHATSAPP_DAILY_LIMIT);
}
