import { randomUUID } from 'node:crypto';
import { getFreeWhatsAppQuotaState, type DailyQuotaState } from './daily-ai-quota';
import { type BillingPlanCode, isBillingPlanCode } from './billing-plans';
import { type UserSubscriptionStatus } from './mercado-pago';
import { db, nowIso } from './local-db';

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
  const effectiveBaseHasPlan = SUBSCRIPTION_ENFORCEMENT_ENABLED ? baseHasActivePlan : true;
  const hasActivePlan =
    manualOverride === 'allow'
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

export async function getLatestUserSubscription(uid: string): Promise<UserSubscriptionRecord | null> {
  const row = db.prepare(`
    select *
    from app_user_subscriptions
    where uid = ?
    order by created_at desc
    limit 1
  `).get(uid) as DbUserSubscriptionRow | undefined;

  return row ? mapSubscriptionRow(row) : null;
}

export async function getUserPlanOverride(uid: string): Promise<UserPlanOverrideRecord | null> {
  const row = db.prepare(`
    select * from app_user_plan_overrides where uid = ? limit 1
  `).get(uid) as DbUserPlanOverrideRow | undefined;
  return row ? mapPlanOverrideRow(row) : null;
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
  const map = new Map<string, UserPlanAccessSummary>();
  for (const uid of uniqueUids) {
    map.set(uid, await getUserPlanAccessSummary(uid));
  }
  return map;
}

export async function getUserSubscriptionByMercadoPagoId(
  mercadoPagoPreapprovalId: string
): Promise<UserSubscriptionRecord | null> {
  const row = db.prepare(`
    select * from app_user_subscriptions where mercado_pago_preapproval_id = ? limit 1
  `).get(mercadoPagoPreapprovalId) as DbUserSubscriptionRow | undefined;
  return row ? mapSubscriptionRow(row) : null;
}

export async function listUserSubscriptionsByStatuses(
  uid: string,
  statuses: readonly UserSubscriptionStatus[]
): Promise<UserSubscriptionRecord[]> {
  if (statuses.length === 0) {
    return [];
  }
  const placeholders = statuses.map(() => '?').join(', ');
  const rows = db.prepare(`
    select * from app_user_subscriptions
    where uid = ? and status in (${placeholders})
    order by created_at desc
  `).all(uid, ...statuses) as DbUserSubscriptionRow[];
  return rows.map(mapSubscriptionRow);
}

export async function createUserSubscriptionRecord(
  input: CreateUserSubscriptionInput
): Promise<UserSubscriptionRecord> {
  const id = randomUUID();
  const now = nowIso();
  db.prepare(`
    insert into app_user_subscriptions (
      id, uid, plan_code, status, status_reason, mercado_pago_preapproval_id, mercado_pago_plan_id,
      external_reference, payer_email, next_billing_date, last_payment_at, last_payment_status,
      cancelled_at, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.uid,
    input.planCode,
    input.status,
    input.statusReason ?? null,
    input.mercadoPagoPreapprovalId ?? null,
    input.mercadoPagoPlanId ?? null,
    input.externalReference,
    input.payerEmail,
    input.nextBillingDate ?? null,
    input.lastPaymentAt ?? null,
    input.lastPaymentStatus ?? null,
    input.cancelledAt ?? null,
    now,
    now
  );

  return (await getUserSubscriptionById(id)) as UserSubscriptionRecord;
}

async function getUserSubscriptionById(id: string): Promise<UserSubscriptionRecord | null> {
  const row = db.prepare('select * from app_user_subscriptions where id = ? limit 1').get(id) as DbUserSubscriptionRow | undefined;
  return row ? mapSubscriptionRow(row) : null;
}

export async function updateUserSubscriptionRecord(
  id: string,
  input: UpdateUserSubscriptionInput
): Promise<UserSubscriptionRecord | null> {
  const current = await getUserSubscriptionById(id);
  if (!current) {
    return null;
  }

  db.prepare(`
    update app_user_subscriptions
    set status = ?, status_reason = ?, next_billing_date = ?, last_payment_at = ?, last_payment_status = ?, cancelled_at = ?, updated_at = ?
    where id = ?
  `).run(
    input.status ?? current.status,
    input.statusReason ?? current.statusReason,
    input.nextBillingDate ?? current.nextBillingDate,
    input.lastPaymentAt ?? current.lastPaymentAt,
    input.lastPaymentStatus ?? current.lastPaymentStatus,
    input.cancelledAt ?? current.cancelledAt,
    nowIso(),
    id
  );

  return getUserSubscriptionById(id);
}

export async function updateUserSubscriptionByMercadoPagoId(
  mercadoPagoPreapprovalId: string,
  input: UpdateUserSubscriptionInput
): Promise<UserSubscriptionRecord | null> {
  const current = await getUserSubscriptionByMercadoPagoId(mercadoPagoPreapprovalId);
  if (!current) {
    return null;
  }
  return updateUserSubscriptionRecord(current.id, input);
}

export async function createBillingEvent(input: {
  provider: string;
  eventType: string;
  providerEventId: string;
  rawPayload?: unknown;
}): Promise<string> {
  const now = nowIso();
  const existing = db.prepare(`
    select id from app_billing_events where provider = ? and provider_event_id = ? limit 1
  `).get(input.provider, input.providerEventId) as { id: string } | undefined;
  if (existing) {
    return existing.id;
  }

  const id = randomUUID();
  db.prepare(`
    insert into app_billing_events (
      id, provider, event_type, provider_event_id, processed, failed, error_message, raw_payload, created_at, updated_at
    ) values (?, ?, ?, ?, 0, 0, null, ?, ?, ?)
  `).run(id, input.provider, input.eventType, input.providerEventId, JSON.stringify(input.rawPayload ?? null), now, now);
  return id;
}

export async function markBillingEventProcessed(id: string): Promise<void> {
  db.prepare(`
    update app_billing_events
    set processed = 1, failed = 0, error_message = null, updated_at = ?
    where id = ?
  `).run(nowIso(), id);
}

export async function markBillingEventFailed(id: string, errorMessage: string): Promise<void> {
  db.prepare(`
    update app_billing_events
    set failed = 1, error_message = ?, updated_at = ?
    where id = ?
  `).run(errorMessage, nowIso(), id);
}

export async function setUserPlanOverride(
  uid: string,
  mode: ManualPlanOverrideMode,
  reason: string | null = null
): Promise<void> {
  const now = nowIso();
  db.prepare(`
    insert into app_user_plan_overrides (uid, mode, reason, created_at, updated_at)
    values (?, ?, ?, ?, ?)
    on conflict(uid) do update set
      mode = excluded.mode,
      reason = excluded.reason,
      updated_at = excluded.updated_at
  `).run(uid, mode, reason, now, now);
}

export async function clearUserPlanOverride(uid: string): Promise<void> {
  db.prepare('delete from app_user_plan_overrides where uid = ?').run(uid);
}

export async function getUserPlanAccess(uid: string): Promise<UserPlanAccess> {
  const summary = await getUserPlanAccessSummary(uid);
  const features = buildPremiumFeatureFlags(summary.hasActivePlan);
  const freeWhatsappQuota = await getFreeWhatsAppQuotaState(uid, !summary.hasActivePlan);

  return {
    ...summary,
    features,
    freeWhatsappQuota
  };
}

export async function listAllSubscriptions(): Promise<UserSubscriptionRecord[]> {
  const rows = db.prepare(`
    select * from app_user_subscriptions order by created_at desc
  `).all() as DbUserSubscriptionRow[];
  return rows.map(mapSubscriptionRow);
}

export async function adminGrantSubscription(
  uid: string,
  planCode: string,
  status: UserSubscriptionStatus = 'authorized'
): Promise<UserSubscriptionRecord> {
  if (!isBillingPlanCode(planCode)) {
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
    lastPaymentAt: nowIso()
  });
}
