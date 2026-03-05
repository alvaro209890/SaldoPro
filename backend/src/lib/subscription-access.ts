import { getFreeWhatsAppQuotaState, type DailyQuotaState } from './daily-ai-quota';
import { type BillingPlanCode, isBillingPlanCode } from './billing-plans';
import { type UserSubscriptionStatus } from './mercado-pago';
import { supabaseAdmin as db } from './supabase';

const SUBSCRIPTIONS_TABLE = 'app_user_subscriptions';
const BILLING_EVENTS_TABLE = 'app_billing_events';
const PLAN_OVERRIDES_TABLE = 'app_user_plan_overrides';
// Temporary maintenance mode: when false, all premium features stay enabled
// without changing subscription records/billing internals.
const SUBSCRIPTION_ENFORCEMENT_ENABLED = false;

export type PremiumFeature =
  | 'web_ai_chat'
  | 'web_ai_chat_history'
  | 'goals'
  | 'document_storage'
  | 'whatsapp_unlimited_ai'
  | 'whatsapp_document_storage';

export type PlanAwareSubscriptionStatus = UserSubscriptionStatus | 'none';
export type ManualPlanOverrideMode = 'allow' | 'deny';

interface DbUserPlanOverrideRow {
  uid: string;
  mode: ManualPlanOverrideMode;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

interface DbUserSubscriptionRow {
  id: string;
  uid: string;
  plan_code: BillingPlanCode;
  status: UserSubscriptionStatus;
  status_reason: string | null;
  mercado_pago_preapproval_id: string | null;
  mercado_pago_plan_id: string | null;
  external_reference: string;
  payer_email: string;
  next_billing_date: string | null;
  last_payment_at: string | null;
  last_payment_status: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserSubscriptionRecord {
  id: string;
  uid: string;
  planCode: BillingPlanCode;
  status: UserSubscriptionStatus;
  statusReason: string | null;
  mercadoPagoPreapprovalId: string | null;
  mercadoPagoPlanId: string | null;
  externalReference: string;
  payerEmail: string;
  nextBillingDate: string | null;
  lastPaymentAt: string | null;
  lastPaymentStatus: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserPlanFeatures {
  webAiChat: boolean;
  webAiChatHistory: boolean;
  goals: boolean;
  documentStorage: boolean;
  whatsappUnlimitedAi: boolean;
  whatsappDocumentStorage: boolean;
}

export interface UserPlanAccess {
  subscriptionStatus: PlanAwareSubscriptionStatus;
  baseHasActivePlan: boolean;
  hasActivePlan: boolean;
  manualOverride: ManualPlanOverrideMode | 'none';
  features: UserPlanFeatures;
  freeWhatsappQuota: DailyQuotaState;
}

export interface UserPlanOverrideRecord {
  uid: string;
  mode: ManualPlanOverrideMode;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserPlanAccessSummary {
  subscriptionStatus: PlanAwareSubscriptionStatus;
  baseHasActivePlan: boolean;
  hasActivePlan: boolean;
  manualOverride: ManualPlanOverrideMode | 'none';
}

interface CreateUserSubscriptionInput {
  uid: string;
  planCode: BillingPlanCode;
  status: UserSubscriptionStatus;
  statusReason?: string | null;
  mercadoPagoPreapprovalId?: string | null;
  mercadoPagoPlanId?: string | null;
  externalReference: string;
  payerEmail: string;
  nextBillingDate?: string | null;
  lastPaymentAt?: string | null;
  lastPaymentStatus?: string | null;
  cancelledAt?: string | null;
}

interface UpdateUserSubscriptionInput {
  status?: UserSubscriptionStatus;
  statusReason?: string | null;
  nextBillingDate?: string | null;
  lastPaymentAt?: string | null;
  lastPaymentStatus?: string | null;
  cancelledAt?: string | null;
}

function assertNoError(error: { message: string } | null, context: string): void {
  if (!error) return;
  throw new Error(`${context}: ${error.message}`);
}

function mapSubscriptionRow(row: DbUserSubscriptionRow): UserSubscriptionRecord {
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

function mapPlanOverrideRow(row: DbUserPlanOverrideRow): UserPlanOverrideRecord {
  return {
    uid: row.uid,
    mode: row.mode,
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function buildPremiumFeatureFlags(hasActivePlan: boolean): UserPlanFeatures {
  return {
    webAiChat: hasActivePlan,
    webAiChatHistory: hasActivePlan,
    goals: hasActivePlan,
    documentStorage: hasActivePlan,
    whatsappUnlimitedAi: hasActivePlan,
    whatsappDocumentStorage: hasActivePlan
  };
}

export function isSubscriptionAuthorized(status: PlanAwareSubscriptionStatus): boolean {
  return status === 'authorized';
}

export function isFeatureEnabled(features: UserPlanFeatures, feature: PremiumFeature): boolean {
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

function buildUserPlanAccessSummary(
  subscription: UserSubscriptionRecord | null,
  override: UserPlanOverrideRecord | null
): UserPlanAccessSummary {
  const subscriptionStatus: PlanAwareSubscriptionStatus = subscription?.status ?? 'none';
  const baseHasActivePlan = isSubscriptionAuthorized(subscriptionStatus);
  const manualOverride = override?.mode ?? 'none';
  const hasActivePlan =
    manualOverride === 'allow'
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

export async function getLatestUserSubscription(uid: string): Promise<UserSubscriptionRecord | null> {
  const { data, error } = await db
    .from(SUBSCRIPTIONS_TABLE)
    .select('*')
    .eq('uid', uid)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  assertNoError(error, 'getLatestUserSubscription');
  if (!data) return null;
  return mapSubscriptionRow(data as DbUserSubscriptionRow);
}

export async function getUserPlanOverride(uid: string): Promise<UserPlanOverrideRecord | null> {
  const { data, error } = await db
    .from(PLAN_OVERRIDES_TABLE)
    .select('*')
    .eq('uid', uid)
    .maybeSingle();

  assertNoError(error, 'getUserPlanOverride');
  if (!data) return null;
  return mapPlanOverrideRow(data as DbUserPlanOverrideRow);
}

export async function getUserPlanAccessSummary(uid: string): Promise<UserPlanAccessSummary> {
  const [subscription, override] = await Promise.all([
    getLatestUserSubscription(uid),
    getUserPlanOverride(uid)
  ]);

  return buildUserPlanAccessSummary(subscription, override);
}

export async function getUserPlanAccessSummaryMap(
  uids: readonly string[]
): Promise<Map<string, UserPlanAccessSummary>> {
  const uniqueUids = [...new Set(uids.filter((uid) => uid.trim().length > 0))];
  if (uniqueUids.length === 0) {
    return new Map();
  }

  const [subscriptionRows, overrideRows] = await Promise.all([
    db
      .from(SUBSCRIPTIONS_TABLE)
      .select('*')
      .in('uid', uniqueUids)
      .order('created_at', { ascending: false }),
    db
      .from(PLAN_OVERRIDES_TABLE)
      .select('*')
      .in('uid', uniqueUids)
  ]);

  assertNoError(subscriptionRows.error, 'getUserPlanAccessSummaryMap.subscriptions');
  assertNoError(overrideRows.error, 'getUserPlanAccessSummaryMap.overrides');

  const latestByUid = new Map<string, UserSubscriptionRecord>();
  for (const row of (subscriptionRows.data ?? []) as DbUserSubscriptionRow[]) {
    if (!latestByUid.has(row.uid)) {
      latestByUid.set(row.uid, mapSubscriptionRow(row));
    }
  }

  const overrideByUid = new Map<string, UserPlanOverrideRecord>();
  for (const row of (overrideRows.data ?? []) as DbUserPlanOverrideRow[]) {
    overrideByUid.set(row.uid, mapPlanOverrideRow(row));
  }

  const result = new Map<string, UserPlanAccessSummary>();
  for (const uid of uniqueUids) {
    result.set(
      uid,
      buildUserPlanAccessSummary(latestByUid.get(uid) ?? null, overrideByUid.get(uid) ?? null)
    );
  }

  return result;
}

export async function getUserSubscriptionByMercadoPagoId(
  mercadoPagoPreapprovalId: string
): Promise<UserSubscriptionRecord | null> {
  const { data, error } = await db
    .from(SUBSCRIPTIONS_TABLE)
    .select('*')
    .eq('mercado_pago_preapproval_id', mercadoPagoPreapprovalId)
    .maybeSingle();

  assertNoError(error, 'getUserSubscriptionByMercadoPagoId');
  if (!data) return null;
  return mapSubscriptionRow(data as DbUserSubscriptionRow);
}

export async function listUserSubscriptionsByStatuses(
  uid: string,
  statuses: readonly UserSubscriptionStatus[]
): Promise<UserSubscriptionRecord[]> {
  const { data, error } = await db
    .from(SUBSCRIPTIONS_TABLE)
    .select('*')
    .eq('uid', uid)
    .in('status', [...statuses])
    .order('created_at', { ascending: false });

  assertNoError(error, 'listUserSubscriptionsByStatuses');
  return ((data ?? []) as DbUserSubscriptionRow[]).map(mapSubscriptionRow);
}

export async function createUserSubscriptionRecord(
  input: CreateUserSubscriptionInput
): Promise<UserSubscriptionRecord> {
  const nowIso = new Date().toISOString();
  const { data, error } = await db
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
  return mapSubscriptionRow(data as DbUserSubscriptionRow);
}

export async function updateUserSubscriptionRecord(
  id: string,
  updates: UpdateUserSubscriptionInput
): Promise<UserSubscriptionRecord> {
  const { data, error } = await db
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
  return mapSubscriptionRow(data as DbUserSubscriptionRow);
}

export async function updateUserSubscriptionByMercadoPagoId(
  mercadoPagoPreapprovalId: string,
  updates: UpdateUserSubscriptionInput
): Promise<UserSubscriptionRecord> {
  const { data, error } = await db
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
  return mapSubscriptionRow(data as DbUserSubscriptionRow);
}

export async function createBillingEvent(input: {
  provider: string;
  eventType: string;
  providerEventId?: string | null;
  rawPayload: unknown;
}): Promise<string> {
  const { data, error } = await db
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
  const row = data as { id: string };
  return row.id;
}

export async function markBillingEventProcessed(id: string): Promise<void> {
  const { error } = await db
    .from(BILLING_EVENTS_TABLE)
    .update({
      processed: true,
      processed_at: new Date().toISOString(),
      error_message: null
    })
    .eq('id', id);

  assertNoError(error, 'markBillingEventProcessed');
}

export async function markBillingEventFailed(id: string, errorMessage: string): Promise<void> {
  const { error } = await db
    .from(BILLING_EVENTS_TABLE)
    .update({
      processed: false,
      error_message: errorMessage
    })
    .eq('id', id);

  assertNoError(error, 'markBillingEventFailed');
}

export async function setUserPlanOverride(
  uid: string,
  mode: ManualPlanOverrideMode,
  reason: string | null = null
): Promise<UserPlanOverrideRecord> {
  const nowIso = new Date().toISOString();
  const { data, error } = await db
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
  return mapPlanOverrideRow(data as DbUserPlanOverrideRow);
}

export async function clearUserPlanOverride(uid: string): Promise<void> {
  const { error } = await db
    .from(PLAN_OVERRIDES_TABLE)
    .delete()
    .eq('uid', uid);

  assertNoError(error, 'clearUserPlanOverride');
}

export async function getUserPlanAccess(uid: string): Promise<UserPlanAccess> {
  const summary = await getUserPlanAccessSummary(uid);
  const { subscriptionStatus, baseHasActivePlan, hasActivePlan, manualOverride } = summary;
  const effectiveHasActivePlan = SUBSCRIPTION_ENFORCEMENT_ENABLED ? hasActivePlan : true;
  const features = buildPremiumFeatureFlags(effectiveHasActivePlan);
  const freeWhatsappQuota = await getFreeWhatsAppQuotaState(uid, SUBSCRIPTION_ENFORCEMENT_ENABLED && !effectiveHasActivePlan);

  return {
    subscriptionStatus,
    baseHasActivePlan,
    hasActivePlan: effectiveHasActivePlan,
    manualOverride,
    features,
    freeWhatsappQuota
  };
}

export async function listAllSubscriptions(): Promise<UserSubscriptionRecord[]> {
  const { data, error } = await db
    .from(SUBSCRIPTIONS_TABLE)
    .select('*')
    .order('created_at', { ascending: false });

  assertNoError(error, 'listAllSubscriptions');
  return ((data ?? []) as DbUserSubscriptionRow[]).map(mapSubscriptionRow);
}

export async function adminGrantSubscription(
  uid: string,
  days: number,
  reason: string | null = null
): Promise<UserSubscriptionRecord> {
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

  const { data, error } = await db
    .from(SUBSCRIPTIONS_TABLE)
    .insert({
      uid,
      plan_code: 'monthly' as BillingPlanCode,
      status: 'authorized' as UserSubscriptionStatus,
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
  return mapSubscriptionRow(data as DbUserSubscriptionRow);
}
