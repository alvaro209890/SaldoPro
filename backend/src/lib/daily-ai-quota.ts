import { db, nowIso } from './local-db';

const BRASILIA_TIMEZONE = 'America/Sao_Paulo';

export const WHATSAPP_FREE_QUOTA_CHANNEL = 'whatsapp_free';
export const FREE_WHATSAPP_DAILY_LIMIT = 2;

export interface DailyQuotaState {
  enabled: boolean;
  limit: number;
  used: number;
  remaining: number;
  quotaDate: string;
  resetsAt: string;
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
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function getNextBrasiliaMidnightUtcIso(now: Date = new Date()): string {
  const parts = getBrasiliaDateParts(now);
  const nextMidnightUtc = Date.UTC(parts.year, parts.month - 1, parts.day + 1, 3, 0, 0, 0);
  return new Date(nextMidnightUtc).toISOString();
}

function buildState(used: number, limit: number, enabled: boolean, quotaDate: string): DailyQuotaState {
  return {
    enabled,
    limit,
    used,
    remaining: Math.max(limit - used, 0),
    quotaDate,
    resetsAt: getNextBrasiliaMidnightUtcIso()
  };
}

export async function getDailyAiQuotaState(
  uid: string,
  channel: string,
  limit: number,
  enabled: boolean
): Promise<DailyQuotaState> {
  const quotaDate = getCurrentBrasiliaQuotaDate();
  const row = db.prepare(`
    select used_count as usedCount
    from app_daily_ai_quotas
    where uid = ? and quota_date = ? and channel = ?
    limit 1
  `).get(uid, quotaDate, channel) as { usedCount: number } | undefined;

  return buildState(Number(row?.usedCount ?? 0), limit, enabled, quotaDate);
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
  const now = nowIso();

  db.prepare(`
    insert into app_daily_ai_quotas (uid, quota_date, channel, used_count, created_at, updated_at)
    values (?, ?, ?, 0, ?, ?)
    on conflict(uid, quota_date, channel) do nothing
  `).run(uid, quotaDate, channel, now, now);

  const current = db.prepare(`
    select used_count as usedCount
    from app_daily_ai_quotas
    where uid = ? and quota_date = ? and channel = ?
    limit 1
  `).get(uid, quotaDate, channel) as { usedCount: number } | undefined;

  const used = Number(current?.usedCount ?? 0);
  if (used >= limit) {
    return {
      allowed: false,
      ...buildState(used, limit, enabled, quotaDate)
    };
  }

  const nextUsed = used + 1;
  db.prepare(`
    update app_daily_ai_quotas
    set used_count = ?, updated_at = ?
    where uid = ? and quota_date = ? and channel = ?
  `).run(nextUsed, nowIso(), uid, quotaDate, channel);

  return {
    allowed: true,
    ...buildState(nextUsed, limit, enabled, quotaDate)
  };
}

export async function consumeFreeWhatsAppQuota(uid: string): Promise<DailyQuotaState & { allowed: boolean }> {
  return consumeDailyAiQuota(uid, WHATSAPP_FREE_QUOTA_CHANNEL, FREE_WHATSAPP_DAILY_LIMIT);
}
