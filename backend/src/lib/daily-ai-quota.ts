import { supabaseAdmin as db } from './supabase';

const DAILY_AI_QUOTA_TABLE = 'app_daily_ai_quotas';
const CONSUME_DAILY_AI_QUOTA_RPC = 'consume_daily_ai_quota';
const BRASILIA_TIMEZONE = 'America/Sao_Paulo';

export const WHATSAPP_FREE_QUOTA_CHANNEL = 'whatsapp_free';
export const FREE_WHATSAPP_DAILY_LIMIT = 1;

interface DbDailyAiQuotaRow {
  used_count: number;
}

interface ConsumeQuotaRpcRow {
  allowed: boolean;
  used_count: number;
  remaining_count: number;
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
  const { data, error } = await db.rpc(CONSUME_DAILY_AI_QUOTA_RPC, {
    p_uid: uid,
    p_quota_date: quotaDate,
    p_channel: channel,
    p_limit: limit
  });

  assertNoError(error, 'consumeDailyAiQuota');

  const row = Array.isArray(data) ? (data[0] as ConsumeQuotaRpcRow | undefined) : undefined;
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

export async function consumeFreeWhatsAppQuota(uid: string): Promise<DailyQuotaState & { allowed: boolean }> {
  return consumeDailyAiQuota(uid, WHATSAPP_FREE_QUOTA_CHANNEL, FREE_WHATSAPP_DAILY_LIMIT);
}
