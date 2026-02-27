"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acquireWhatsAppConnectionLock = acquireWhatsAppConnectionLock;
exports.releaseWhatsAppConnectionLock = releaseWhatsAppConnectionLock;
const supabase_1 = require("./supabase");
const DEFAULT_LOCK_TTL_SECONDS = 90;
function assertSlotId(slotId) {
    if (slotId !== 'wa1') {
        throw new Error(`Invalid WhatsApp slot id for lock: ${slotId}`);
    }
}
async function acquireWhatsAppConnectionLock(slotId, instanceId, ttlSeconds = DEFAULT_LOCK_TTL_SECONDS) {
    assertSlotId(slotId);
    const normalizedInstanceId = instanceId.trim();
    if (!normalizedInstanceId)
        throw new Error('Invalid instance id for WhatsApp lock');
    const { data, error } = await supabase_1.supabaseAdmin.rpc('acquire_whatsapp_connection_lock', {
        p_slot_id: slotId,
        p_instance_id: normalizedInstanceId,
        p_ttl_seconds: ttlSeconds
    });
    if (error) {
        throw new Error(`acquireWhatsAppConnectionLock: ${error.message}`);
    }
    return data === true;
}
async function releaseWhatsAppConnectionLock(slotId, instanceId) {
    assertSlotId(slotId);
    const normalizedInstanceId = instanceId.trim();
    if (!normalizedInstanceId)
        return false;
    const { data, error } = await supabase_1.supabaseAdmin.rpc('release_whatsapp_connection_lock', {
        p_slot_id: slotId,
        p_instance_id: normalizedInstanceId
    });
    if (error) {
        throw new Error(`releaseWhatsAppConnectionLock: ${error.message}`);
    }
    return data === true;
}
