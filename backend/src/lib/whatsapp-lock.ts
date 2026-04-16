import { db, nowIso } from './local-db';

const DEFAULT_LOCK_TTL_SECONDS = 90;

function assertSlotId(slotId: string): void {
  if (slotId !== 'wa1') {
    throw new Error(`Invalid WhatsApp slot id for lock: ${slotId}`);
  }
}

function expiresAtFromNow(ttlSeconds: number): string {
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

function isExpired(expiresAt: string): boolean {
  return Date.parse(expiresAt) <= Date.now();
}

export async function acquireWhatsAppConnectionLock(
  slotId: 'wa1',
  instanceId: string,
  ttlSeconds = DEFAULT_LOCK_TTL_SECONDS
): Promise<boolean> {
  assertSlotId(slotId);
  const normalizedInstanceId = instanceId.trim();
  if (!normalizedInstanceId) {
    throw new Error('Invalid instance id for WhatsApp lock');
  }

  const current = db
    .prepare('select instance_id as instanceId, expires_at as expiresAt from whatsapp_connection_locks where slot_id = ?')
    .get(slotId) as { instanceId: string; expiresAt: string } | undefined;

  if (current && !isExpired(current.expiresAt) && current.instanceId !== normalizedInstanceId) {
    return false;
  }

  db.prepare(`
    insert into whatsapp_connection_locks (slot_id, instance_id, expires_at, updated_at)
    values (?, ?, ?, ?)
    on conflict(slot_id) do update set
      instance_id = excluded.instance_id,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).run(slotId, normalizedInstanceId, expiresAtFromNow(ttlSeconds), nowIso());

  return true;
}

export async function releaseWhatsAppConnectionLock(
  slotId: 'wa1',
  instanceId: string
): Promise<boolean> {
  assertSlotId(slotId);
  const normalizedInstanceId = instanceId.trim();
  if (!normalizedInstanceId) {
    return false;
  }

  const result = db
    .prepare('delete from whatsapp_connection_locks where slot_id = ? and instance_id = ?')
    .run(slotId, normalizedInstanceId);

  return result.changes > 0;
}

export async function forceAcquireWhatsAppConnectionLock(
  slotId: 'wa1',
  instanceId: string,
  ttlSeconds = DEFAULT_LOCK_TTL_SECONDS
): Promise<boolean> {
  assertSlotId(slotId);
  const normalizedInstanceId = instanceId.trim();
  if (!normalizedInstanceId) {
    throw new Error('Invalid instance id for WhatsApp lock');
  }

  db.prepare(`
    insert into whatsapp_connection_locks (slot_id, instance_id, expires_at, updated_at)
    values (?, ?, ?, ?)
    on conflict(slot_id) do update set
      instance_id = excluded.instance_id,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).run(slotId, normalizedInstanceId, expiresAtFromNow(ttlSeconds), nowIso());

  return true;
}
