import { supabaseAdmin as db } from './supabase';

const DEFAULT_LOCK_TTL_SECONDS = 90;

function assertSlotId(slotId: string): void {
  if (slotId !== 'wa1') {
    throw new Error(`Invalid WhatsApp slot id for lock: ${slotId}`);
  }
}

export async function acquireWhatsAppConnectionLock(
  slotId: 'wa1',
  instanceId: string,
  ttlSeconds = DEFAULT_LOCK_TTL_SECONDS
): Promise<boolean> {
  assertSlotId(slotId);
  const normalizedInstanceId = instanceId.trim();
  if (!normalizedInstanceId) throw new Error('Invalid instance id for WhatsApp lock');

  const { data, error } = await db.rpc('acquire_whatsapp_connection_lock', {
    p_slot_id: slotId,
    p_instance_id: normalizedInstanceId,
    p_ttl_seconds: ttlSeconds
  });

  if (error) {
    throw new Error(`acquireWhatsAppConnectionLock: ${error.message}`);
  }

  return data === true;
}

export async function releaseWhatsAppConnectionLock(
  slotId: 'wa1',
  instanceId: string
): Promise<boolean> {
  assertSlotId(slotId);
  const normalizedInstanceId = instanceId.trim();
  if (!normalizedInstanceId) return false;

  const { data, error } = await db.rpc('release_whatsapp_connection_lock', {
    p_slot_id: slotId,
    p_instance_id: normalizedInstanceId
  });

  if (error) {
    throw new Error(`releaseWhatsAppConnectionLock: ${error.message}`);
  }

  return data === true;
}

export async function forceAcquireWhatsAppConnectionLock(
  slotId: 'wa1',
  instanceId: string,
  ttlSeconds = DEFAULT_LOCK_TTL_SECONDS
): Promise<boolean> {
  assertSlotId(slotId);
  const normalizedInstanceId = instanceId.trim();
  if (!normalizedInstanceId) throw new Error('Invalid instance id for WhatsApp lock');

  const { data, error } = await db.rpc('force_acquire_whatsapp_connection_lock', {
    p_slot_id: slotId,
    p_instance_id: normalizedInstanceId,
    p_ttl_seconds: ttlSeconds
  });

  if (error) {
    throw new Error(`forceAcquireWhatsAppConnectionLock: ${error.message}`);
  }

  return data === true;
}
