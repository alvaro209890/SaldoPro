"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acquireWhatsAppConnectionLock = acquireWhatsAppConnectionLock;
exports.releaseWhatsAppConnectionLock = releaseWhatsAppConnectionLock;
exports.forceAcquireWhatsAppConnectionLock = forceAcquireWhatsAppConnectionLock;
const local_db_1 = require("./local-db");
const DEFAULT_LOCK_TTL_SECONDS = 90;
function assertSlotId(slotId) {
    if (slotId !== 'wa1') {
        throw new Error(`Invalid WhatsApp slot id for lock: ${slotId}`);
    }
}
function expiresAtFromNow(ttlSeconds) {
    return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}
function isExpired(expiresAt) {
    return Date.parse(expiresAt) <= Date.now();
}
async function acquireWhatsAppConnectionLock(slotId, instanceId, ttlSeconds = DEFAULT_LOCK_TTL_SECONDS) {
    assertSlotId(slotId);
    const normalizedInstanceId = instanceId.trim();
    if (!normalizedInstanceId) {
        throw new Error('Invalid instance id for WhatsApp lock');
    }
    const current = local_db_1.db
        .prepare('select instance_id as instanceId, expires_at as expiresAt from whatsapp_connection_locks where slot_id = ?')
        .get(slotId);
    if (current && !isExpired(current.expiresAt) && current.instanceId !== normalizedInstanceId) {
        return false;
    }
    local_db_1.db.prepare(`
    insert into whatsapp_connection_locks (slot_id, instance_id, expires_at, updated_at)
    values (?, ?, ?, ?)
    on conflict(slot_id) do update set
      instance_id = excluded.instance_id,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).run(slotId, normalizedInstanceId, expiresAtFromNow(ttlSeconds), (0, local_db_1.nowIso)());
    return true;
}
async function releaseWhatsAppConnectionLock(slotId, instanceId) {
    assertSlotId(slotId);
    const normalizedInstanceId = instanceId.trim();
    if (!normalizedInstanceId) {
        return false;
    }
    const result = local_db_1.db
        .prepare('delete from whatsapp_connection_locks where slot_id = ? and instance_id = ?')
        .run(slotId, normalizedInstanceId);
    return result.changes > 0;
}
async function forceAcquireWhatsAppConnectionLock(slotId, instanceId, ttlSeconds = DEFAULT_LOCK_TTL_SECONDS) {
    assertSlotId(slotId);
    const normalizedInstanceId = instanceId.trim();
    if (!normalizedInstanceId) {
        throw new Error('Invalid instance id for WhatsApp lock');
    }
    local_db_1.db.prepare(`
    insert into whatsapp_connection_locks (slot_id, instance_id, expires_at, updated_at)
    values (?, ?, ?, ?)
    on conflict(slot_id) do update set
      instance_id = excluded.instance_id,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).run(slotId, normalizedInstanceId, expiresAtFromNow(ttlSeconds), (0, local_db_1.nowIso)());
    return true;
}
