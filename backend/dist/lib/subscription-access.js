"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSubscriptionAuthorized = isSubscriptionAuthorized;
exports.isFeatureEnabled = isFeatureEnabled;
exports.getLatestUserSubscription = getLatestUserSubscription;
exports.getUserPlanOverride = getUserPlanOverride;
exports.getUserPlanAccessSummary = getUserPlanAccessSummary;
exports.getUserPlanAccessSummaryMap = getUserPlanAccessSummaryMap;
exports.getUserSubscriptionByMercadoPagoId = getUserSubscriptionByMercadoPagoId;
exports.listUserSubscriptionsByStatuses = listUserSubscriptionsByStatuses;
exports.createUserSubscriptionRecord = createUserSubscriptionRecord;
exports.updateUserSubscriptionRecord = updateUserSubscriptionRecord;
exports.updateUserSubscriptionByMercadoPagoId = updateUserSubscriptionByMercadoPagoId;
exports.createBillingEvent = createBillingEvent;
exports.markBillingEventProcessed = markBillingEventProcessed;
exports.markBillingEventFailed = markBillingEventFailed;
exports.setUserPlanOverride = setUserPlanOverride;
exports.clearUserPlanOverride = clearUserPlanOverride;
exports.getUserPlanAccess = getUserPlanAccess;
exports.listAllSubscriptions = listAllSubscriptions;
exports.adminGrantSubscription = adminGrantSubscription;
const node_crypto_1 = require("node:crypto");
const daily_ai_quota_1 = require("./daily-ai-quota");
const billing_plans_1 = require("./billing-plans");
const local_db_1 = require("./local-db");
const SUBSCRIPTION_ENFORCEMENT_ENABLED = false;
function mapSubscriptionRow(row) {
    return {
        id: row.id,
        uid: row.uid,
        planCode: row.plan_code,
        status: row.status,
        statusReason: row.status_reason,
        mercadoPagoPreapprovalId: row.mercado_pago_preapproval_id,
        mercadoPagoPlanId: row.mercado_pago_plan_id,
        externalReference: row.external_reference,
        payerEmail: row.payer_email,
        nextBillingDate: row.next_billing_date,
        lastPaymentAt: row.last_payment_at,
        lastPaymentStatus: row.last_payment_status,
        cancelledAt: row.cancelled_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
function mapPlanOverrideRow(row) {
    return {
        uid: row.uid,
        mode: row.mode,
        reason: row.reason,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
function buildPremiumFeatureFlags(hasActivePlan) {
    return {
        webAiChat: hasActivePlan,
        webAiChatHistory: hasActivePlan,
        goals: hasActivePlan,
        documentStorage: hasActivePlan,
        whatsappUnlimitedAi: hasActivePlan,
        whatsappDocumentStorage: hasActivePlan
    };
}
function isSubscriptionAuthorized(status) {
    return status === 'authorized';
}
function isFeatureEnabled(features, feature) {
    switch (feature) {
        case 'web_ai_chat':
            return features.webAiChat;
        case 'web_ai_chat_history':
            return features.webAiChatHistory;
        case 'goals':
            return features.goals;
        case 'document_storage':
            return features.documentStorage;
        case 'whatsapp_unlimited_ai':
            return features.whatsappUnlimitedAi;
        case 'whatsapp_document_storage':
            return features.whatsappDocumentStorage;
        default:
            return false;
    }
}
function buildUserPlanAccessSummary(subscription, override) {
    const subscriptionStatus = subscription?.status ?? 'none';
    const baseHasActivePlan = isSubscriptionAuthorized(subscriptionStatus);
    const manualOverride = override?.mode ?? 'none';
    const effectiveBaseHasPlan = SUBSCRIPTION_ENFORCEMENT_ENABLED ? baseHasActivePlan : true;
    const hasActivePlan = manualOverride === 'allow'
        ? true
        : manualOverride === 'deny'
            ? false
            : effectiveBaseHasPlan;
    return {
        subscriptionStatus,
        baseHasActivePlan: effectiveBaseHasPlan,
        hasActivePlan,
        manualOverride
    };
}
async function getLatestUserSubscription(uid) {
    const row = local_db_1.db.prepare(`
    select *
    from app_user_subscriptions
    where uid = ?
    order by created_at desc
    limit 1
  `).get(uid);
    return row ? mapSubscriptionRow(row) : null;
}
async function getUserPlanOverride(uid) {
    const row = local_db_1.db.prepare(`
    select * from app_user_plan_overrides where uid = ? limit 1
  `).get(uid);
    return row ? mapPlanOverrideRow(row) : null;
}
async function getUserPlanAccessSummary(uid) {
    const [subscription, override] = await Promise.all([
        getLatestUserSubscription(uid),
        getUserPlanOverride(uid)
    ]);
    return buildUserPlanAccessSummary(subscription, override);
}
async function getUserPlanAccessSummaryMap(uids) {
    const uniqueUids = [...new Set(uids.filter((uid) => uid.trim().length > 0))];
    const map = new Map();
    for (const uid of uniqueUids) {
        map.set(uid, await getUserPlanAccessSummary(uid));
    }
    return map;
}
async function getUserSubscriptionByMercadoPagoId(mercadoPagoPreapprovalId) {
    const row = local_db_1.db.prepare(`
    select * from app_user_subscriptions where mercado_pago_preapproval_id = ? limit 1
  `).get(mercadoPagoPreapprovalId);
    return row ? mapSubscriptionRow(row) : null;
}
async function listUserSubscriptionsByStatuses(uid, statuses) {
    if (statuses.length === 0) {
        return [];
    }
    const placeholders = statuses.map(() => '?').join(', ');
    const rows = local_db_1.db.prepare(`
    select * from app_user_subscriptions
    where uid = ? and status in (${placeholders})
    order by created_at desc
  `).all(uid, ...statuses);
    return rows.map(mapSubscriptionRow);
}
async function createUserSubscriptionRecord(input) {
    const id = (0, node_crypto_1.randomUUID)();
    const now = (0, local_db_1.nowIso)();
    local_db_1.db.prepare(`
    insert into app_user_subscriptions (
      id, uid, plan_code, status, status_reason, mercado_pago_preapproval_id, mercado_pago_plan_id,
      external_reference, payer_email, next_billing_date, last_payment_at, last_payment_status,
      cancelled_at, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.uid, input.planCode, input.status, input.statusReason ?? null, input.mercadoPagoPreapprovalId ?? null, input.mercadoPagoPlanId ?? null, input.externalReference, input.payerEmail, input.nextBillingDate ?? null, input.lastPaymentAt ?? null, input.lastPaymentStatus ?? null, input.cancelledAt ?? null, now, now);
    return (await getUserSubscriptionById(id));
}
async function getUserSubscriptionById(id) {
    const row = local_db_1.db.prepare('select * from app_user_subscriptions where id = ? limit 1').get(id);
    return row ? mapSubscriptionRow(row) : null;
}
async function updateUserSubscriptionRecord(id, input) {
    const current = await getUserSubscriptionById(id);
    if (!current) {
        return null;
    }
    local_db_1.db.prepare(`
    update app_user_subscriptions
    set status = ?, status_reason = ?, next_billing_date = ?, last_payment_at = ?, last_payment_status = ?, cancelled_at = ?, updated_at = ?
    where id = ?
  `).run(input.status ?? current.status, input.statusReason ?? current.statusReason, input.nextBillingDate ?? current.nextBillingDate, input.lastPaymentAt ?? current.lastPaymentAt, input.lastPaymentStatus ?? current.lastPaymentStatus, input.cancelledAt ?? current.cancelledAt, (0, local_db_1.nowIso)(), id);
    return getUserSubscriptionById(id);
}
async function updateUserSubscriptionByMercadoPagoId(mercadoPagoPreapprovalId, input) {
    const current = await getUserSubscriptionByMercadoPagoId(mercadoPagoPreapprovalId);
    if (!current) {
        return null;
    }
    return updateUserSubscriptionRecord(current.id, input);
}
async function createBillingEvent(input) {
    const now = (0, local_db_1.nowIso)();
    const existing = local_db_1.db.prepare(`
    select id from app_billing_events where provider = ? and provider_event_id = ? limit 1
  `).get(input.provider, input.providerEventId);
    if (existing) {
        return existing.id;
    }
    const id = (0, node_crypto_1.randomUUID)();
    local_db_1.db.prepare(`
    insert into app_billing_events (
      id, provider, event_type, provider_event_id, processed, failed, error_message, raw_payload, created_at, updated_at
    ) values (?, ?, ?, ?, 0, 0, null, ?, ?, ?)
  `).run(id, input.provider, input.eventType, input.providerEventId, JSON.stringify(input.rawPayload ?? null), now, now);
    return id;
}
async function markBillingEventProcessed(id) {
    local_db_1.db.prepare(`
    update app_billing_events
    set processed = 1, failed = 0, error_message = null, updated_at = ?
    where id = ?
  `).run((0, local_db_1.nowIso)(), id);
}
async function markBillingEventFailed(id, errorMessage) {
    local_db_1.db.prepare(`
    update app_billing_events
    set failed = 1, error_message = ?, updated_at = ?
    where id = ?
  `).run(errorMessage, (0, local_db_1.nowIso)(), id);
}
async function setUserPlanOverride(uid, mode, reason = null) {
    const now = (0, local_db_1.nowIso)();
    local_db_1.db.prepare(`
    insert into app_user_plan_overrides (uid, mode, reason, created_at, updated_at)
    values (?, ?, ?, ?, ?)
    on conflict(uid) do update set
      mode = excluded.mode,
      reason = excluded.reason,
      updated_at = excluded.updated_at
  `).run(uid, mode, reason, now, now);
}
async function clearUserPlanOverride(uid) {
    local_db_1.db.prepare('delete from app_user_plan_overrides where uid = ?').run(uid);
}
async function getUserPlanAccess(uid) {
    const summary = await getUserPlanAccessSummary(uid);
    const features = buildPremiumFeatureFlags(summary.hasActivePlan);
    const freeWhatsappQuota = await (0, daily_ai_quota_1.getFreeWhatsAppQuotaState)(uid, !summary.hasActivePlan);
    return {
        ...summary,
        features,
        freeWhatsappQuota
    };
}
async function listAllSubscriptions() {
    const rows = local_db_1.db.prepare(`
    select * from app_user_subscriptions order by created_at desc
  `).all();
    return rows.map(mapSubscriptionRow);
}
async function adminGrantSubscription(uid, planCode, status = 'authorized') {
    if (!(0, billing_plans_1.isBillingPlanCode)(planCode)) {
        throw new Error('Invalid billing plan code.');
    }
    return createUserSubscriptionRecord({
        uid,
        planCode,
        status,
        statusReason: 'admin_grant',
        externalReference: `admin:${uid}:${Date.now()}`,
        payerEmail: 'admin@local.invalid',
        lastPaymentStatus: status,
        lastPaymentAt: (0, local_db_1.nowIso)()
    });
}
