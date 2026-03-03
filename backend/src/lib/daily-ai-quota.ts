import { supabaseAdmin as db } from './supabase';

const DAILY_AI_QUOTA_TABLE = 'app_daily_ai_quotas';
const BRASILIA_TIMEZONE = 'America/Sao_Paulo';
const QUOTA_UPDATE_MAX_ATTEMPTS = 3;

export const WHATSAPP_FREE_QUOTA_CHANNEL = 'whatsapp_free';
export const FREE_WHATSAPP_DAILY_LIMIT = 2;

interface DbDailyAiQuotaRow {
  used_count: number;
}

interface DbQuotaMutationRow {
  used_count: number;
}

export interface DailyQuotaState {
  enabled: boolean;
  limit: number;
  used: number;
  remaining: number;
  quotaDate: string;
  resetsAt: string;
}

function assertNoError(error: { message: string } | null, context: string): void {
  if (!error) return;
  throw new Error(`${context}: ${error.message}`);
}

function getBrasiliaDateParts(now: Date = new Date()): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BRASILIA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);

  const map = new Map<string, string>();
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

export function getCurrentBrasiliaQuotaDate(now: Date = new Date()): string {
  const parts = getBrasiliaDateParts(now);
  const year = String(parts.year).padStart(4, '0');
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getNextBrasiliaMidnightUtcIso(now: Date = new Date()): string {
  const parts = getBrasiliaDateParts(now);
  const nextMidnightUtc = Date.UTC(parts.year, parts.month - 1, parts.day + 1, 3, 0, 0, 0);
  return new Date(nextMidnightUtc).toISOString();
}

export async function getDailyAiQuotaState(
  uid: string,
  channel: string,
  limit: number,
  enabled: boolean
): Promise<DailyQuotaState> {
  const quotaDate = getCurrentBrasiliaQuotaDate();
  const { data, error } = await db
    .from(DAILY_AI_QUOTA_TABLE)
    .select('used_count')
    .eq('uid', uid)
    .eq('quota_date', quotaDate)
    .eq('channel', channel)
    .maybeSingle();

  assertNoError(error, 'getDailyAiQuotaState');

  const used = Math.max(0, Number((data as DbDailyAiQuotaRow | null)?.used_count ?? 0));
  return {
    enabled,
    limit,
    used,
    remaining: Math.max(limit - used, 0),
    quotaDate,
    resetsAt: getNextBrasiliaMidnightUtcIso()
  };
}

export async function getFreeWhatsAppQuotaState(uid: string, enabled: boolean): Promise<DailyQuotaState> {
  return getDailyAiQuotaState(uid, WHATSAPP_FREE_QUOTA_CHANNEL, FREE_WHATSAPP_DAILY_LIMIT, enabled);
}

export async function consumeDailyAiQuota(
  uid: string,
  channel: string,
  limit: number,
  enabled = true
): Promise<DailyQuotaState & { allowed: boolean }> {
  const quotaDate = getCurrentBrasiliaQuotaDate();
  const nowIso = new Date().toISOString();
  const resetsAt = getNextBrasiliaMidnightUtcIso();

  const { error: upsertError } = await db
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
    const { data: currentRow, error: currentError } = await db
      .from(DAILY_AI_QUOTA_TABLE)
      .select('used_count')
      .eq('uid', uid)
      .eq('quota_date', quotaDate)
      .eq('channel', channel)
      .maybeSingle();

    assertNoError(currentError, 'consumeDailyAiQuota.readCurrent');

    const currentUsed = Math.max(0, Number((currentRow as DbDailyAiQuotaRow | null)?.used_count ?? 0));
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
    const { data: updatedRow, error: updateError } = await db
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
        used: Math.max(0, Number((updatedRow as DbQuotaMutationRow).used_count)),
        remaining: Math.max(limit - nextUsed, 0),
        quotaDate,
        resetsAt
      };
    }
  }

  throw new Error('consumeDailyAiQuota: failed to update quota after retries');
}

export async function consumeFreeWhatsAppQuota(uid: string): Promise<DailyQuotaState & { allowed: boolean }> {
  return consumeDailyAiQuota(uid, WHATSAPP_FREE_QUOTA_CHANNEL, FREE_WHATSAPP_DAILY_LIMIT);
}
