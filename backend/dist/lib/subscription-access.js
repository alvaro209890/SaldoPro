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
const daily_ai_quota_1 = require("./daily-ai-quota");
const supabase_1 = require("./supabase");
const SUBSCRIPTIONS_TABLE = 'app_user_subscriptions';
const BILLING_EVENTS_TABLE = 'app_billing_events';
const PLAN_OVERRIDES_TABLE = 'app_user_plan_overrides';
function assertNoError(error, context) {
    if (!error)
        return;
    throw new Error(`${context}: ${error.message}`);
}
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
    const hasActivePlan = manualOverride === 'allow'
        ? true
        : manualOverride === 'deny'
            ? false
            : baseHasActivePlan;
    return {
        subscriptionStatus,
        baseHasActivePlan,
        hasActivePlan,
        manualOverride
    };
}
async function getLatestUserSubscription(uid) {
    const { data, error } = await supabase_1.supabaseAdmin
        .from(SUBSCRIPTIONS_TABLE)
        .select('*')
        .eq('uid', uid)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    assertNoError(error, 'getLatestUserSubscription');
    if (!data)
        return null;
    return mapSubscriptionRow(data);
}
async function getUserPlanOverride(uid) {
    const { data, error } = await supabase_1.supabaseAdmin
        .from(PLAN_OVERRIDES_TABLE)
        .select('*')
        .eq('uid', uid)
        .maybeSingle();
    assertNoError(error, 'getUserPlanOverride');
    if (!data)
        return null;
    return mapPlanOverrideRow(data);
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
    if (uniqueUids.length === 0) {
        return new Map();
    }
    const [subscriptionRows, overrideRows] = await Promise.all([
        supabase_1.supabaseAdmin
            .from(SUBSCRIPTIONS_TABLE)
            .select('*')
            .in('uid', uniqueUids)
            .order('created_at', { ascending: false }),
        supabase_1.supabaseAdmin
            .from(PLAN_OVERRIDES_TABLE)
            .select('*')
            .in('uid', uniqueUids)
    ]);
    assertNoError(subscriptionRows.error, 'getUserPlanAccessSummaryMap.subscriptions');
    assertNoError(overrideRows.error, 'getUserPlanAccessSummaryMap.overrides');
    const latestByUid = new Map();
    for (const row of (subscriptionRows.data ?? [])) {
        if (!latestByUid.has(row.uid)) {
            latestByUid.set(row.uid, mapSubscriptionRow(row));
        }
    }
    const overrideByUid = new Map();
    for (const row of (overrideRows.data ?? [])) {
        overrideByUid.set(row.uid, mapPlanOverrideRow(row));
    }
    const result = new Map();
    for (const uid of uniqueUids) {
        result.set(uid, buildUserPlanAccessSummary(latestByUid.get(uid) ?? null, overrideByUid.get(uid) ?? null));
    }
    return result;
}
async function getUserSubscriptionByMercadoPagoId(mercadoPagoPreapprovalId) {
    const { data, error } = await supabase_1.supabaseAdmin
        .from(SUBSCRIPTIONS_TABLE)
        .select('*')
        .eq('mercado_pago_preapproval_id', mercadoPagoPreapprovalId)
        .maybeSingle();
    assertNoError(error, 'getUserSubscriptionByMercadoPagoId');
    if (!data)
        return null;
    return mapSubscriptionRow(data);
}
async function listUserSubscriptionsByStatuses(uid, statuses) {
    const { data, error } = await supabase_1.supabaseAdmin
        .from(SUBSCRIPTIONS_TABLE)
        .select('*')
        .eq('uid', uid)
        .in('status', [...statuses])
        .order('created_at', { ascending: false });
    assertNoError(error, 'listUserSubscriptionsByStatuses');
    return (data ?? []).map(mapSubscriptionRow);
}
async function createUserSubscriptionRecord(input) {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase_1.supabaseAdmin
        .from(SUBSCRIPTIONS_TABLE)
        .insert({
        uid: input.uid,
        plan_code: input.planCode,
        status: input.status,
        status_reason: input.statusReason ?? null,
        mercado_pago_preapproval_id: input.mercadoPagoPreapprovalId ?? null,
        mercado_pago_plan_id: input.mercadoPagoPlanId ?? null,
        external_reference: input.externalReference,
        payer_email: input.payerEmail,
        next_billing_date: input.nextBillingDate ?? null,
        last_payment_at: input.lastPaymentAt ?? null,
        last_payment_status: input.lastPaymentStatus ?? null,
        cancelled_at: input.cancelledAt ?? null,
        created_at: nowIso,
        updated_at: nowIso
    })
        .select('*')
        .single();
    assertNoError(error, 'createUserSubscriptionRecord');
    return mapSubscriptionRow(data);
}
async function updateUserSubscriptionRecord(id, updates) {
    const { data, error } = await supabase_1.supabaseAdmin
        .from(SUBSCRIPTIONS_TABLE)
        .update({
        ...(updates.status ? { status: updates.status } : {}),
        ...(updates.statusReason !== undefined ? { status_reason: updates.statusReason } : {}),
        ...(updates.nextBillingDate !== undefined ? { next_billing_date: updates.nextBillingDate } : {}),
        ...(updates.lastPaymentAt !== undefined ? { last_payment_at: updates.lastPaymentAt } : {}),
        ...(updates.lastPaymentStatus !== undefined ? { last_payment_status: updates.lastPaymentStatus } : {}),
        ...(updates.cancelledAt !== undefined ? { cancelled_at: updates.cancelledAt } : {}),
        updated_at: new Date().toISOString()
    })
        .eq('id', id)
        .select('*')
        .single();
    assertNoError(error, 'updateUserSubscriptionRecord');
    return mapSubscriptionRow(data);
}
async function updateUserSubscriptionByMercadoPagoId(mercadoPagoPreapprovalId, updates) {
    const { data, error } = await supabase_1.supabaseAdmin
        .from(SUBSCRIPTIONS_TABLE)
        .update({
        ...(updates.status ? { status: updates.status } : {}),
        ...(updates.statusReason !== undefined ? { status_reason: updates.statusReason } : {}),
        ...(updates.nextBillingDate !== undefined ? { next_billing_date: updates.nextBillingDate } : {}),
        ...(updates.lastPaymentAt !== undefined ? { last_payment_at: updates.lastPaymentAt } : {}),
        ...(updates.lastPaymentStatus !== undefined ? { last_payment_status: updates.lastPaymentStatus } : {}),
        ...(updates.cancelledAt !== undefined ? { cancelled_at: updates.cancelledAt } : {}),
        updated_at: new Date().toISOString()
    })
        .eq('mercado_pago_preapproval_id', mercadoPagoPreapprovalId)
        .select('*')
        .single();
    assertNoError(error, 'updateUserSubscriptionByMercadoPagoId');
    return mapSubscriptionRow(data);
}
async function createBillingEvent(input) {
    const { data, error } = await supabase_1.supabaseAdmin
        .from(BILLING_EVENTS_TABLE)
        .insert({
        provider: input.provider,
        event_type: input.eventType,
        provider_event_id: input.providerEventId ?? null,
        raw_payload: input.rawPayload
    })
        .select('id')
        .single();
    assertNoError(error, 'createBillingEvent');
    const row = data;
    return row.id;
}
async function markBillingEventProcessed(id) {
    const { error } = await supabase_1.supabaseAdmin
        .from(BILLING_EVENTS_TABLE)
        .update({
        processed: true,
        processed_at: new Date().toISOString(),
        error_message: null
    })
        .eq('id', id);
    assertNoError(error, 'markBillingEventProcessed');
}
async function markBillingEventFailed(id, errorMessage) {
    const { error } = await supabase_1.supabaseAdmin
        .from(BILLING_EVENTS_TABLE)
        .update({
        processed: false,
        error_message: errorMessage
    })
        .eq('id', id);
    assertNoError(error, 'markBillingEventFailed');
}
async function setUserPlanOverride(uid, mode, reason = null) {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase_1.supabaseAdmin
        .from(PLAN_OVERRIDES_TABLE)
        .upsert({
        uid,
        mode,
        reason,
        created_at: nowIso,
        updated_at: nowIso
    }, {
        onConflict: 'uid'
    })
        .select('*')
        .single();
    assertNoError(error, 'setUserPlanOverride');
    return mapPlanOverrideRow(data);
}
async function clearUserPlanOverride(uid) {
    const { error } = await supabase_1.supabaseAdmin
        .from(PLAN_OVERRIDES_TABLE)
        .delete()
        .eq('uid', uid);
    assertNoError(error, 'clearUserPlanOverride');
}
async function getUserPlanAccess(uid) {
    const summary = await getUserPlanAccessSummary(uid);
    const { subscriptionStatus, baseHasActivePlan, hasActivePlan, manualOverride } = summary;
    const features = buildPremiumFeatureFlags(hasActivePlan);
    const freeWhatsappQuota = await (0, daily_ai_quota_1.getFreeWhatsAppQuotaState)(uid, !hasActivePlan);
    return {
        subscriptionStatus,
        baseHasActivePlan,
        hasActivePlan,
        manualOverride,
        features,
        freeWhatsappQuota
    };
}
async function listAllSubscriptions() {
    const { data, error } = await supabase_1.supabaseAdmin
        .from(SUBSCRIPTIONS_TABLE)
        .select('*')
        .order('created_at', { ascending: false });
    assertNoError(error, 'listAllSubscriptions');
    return (data ?? []).map(mapSubscriptionRow);
}
async function adminGrantSubscription(uid, days, reason = null) {
    const nowIso = new Date().toISOString();
    const nextBilling = new Date(Date.now() + days * 86_400_000).toISOString();
    // Cancel existing active subscriptions before granting
    const replaceable = await listUserSubscriptionsByStatuses(uid, ['pending', 'authorized', 'paused']);
    for (const current of replaceable) {
        await updateUserSubscriptionRecord(current.id, {
            status: 'cancelled',
            statusReason: 'replaced_by_admin_grant',
            cancelledAt: nowIso,
            lastPaymentStatus: 'cancelled'
        });
    }
    const { data, error } = await supabase_1.supabaseAdmin
        .from(SUBSCRIPTIONS_TABLE)
        .insert({
        uid,
        plan_code: 'monthly',
        status: 'authorized',
        status_reason: reason || `Admin concedeu ${days} dias`,
        mercado_pago_preapproval_id: null,
        mercado_pago_plan_id: null,
        external_reference: `admin_grant:${uid}|days:${days}|ts:${Date.now()}`,
        payer_email: 'admin@saldopro.com',
        next_billing_date: nextBilling,
        last_payment_at: nowIso,
        last_payment_status: 'admin_grant',
        cancelled_at: null,
        created_at: nowIso,
        updated_at: nowIso
    })
        .select('*')
        .single();
    assertNoError(error, 'adminGrantSubscription');
    return mapSubscriptionRow(data);
}
