import { supabaseAdmin as db } from './supabase';

const TABLE_NAME = 'app_subscription_plans';

export type BillingPlanCode = 'monthly' | 'quarterly' | 'yearly';

interface DbSubscriptionPlanRow {
  id: string;
  code: BillingPlanCode;
  name: string;
  description: string;
  interval_unit: string;
  interval_count: number;
  price_cents: number;
  currency: string;
  mercado_pago_plan_id: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface BillingPlanSeed {
  code: BillingPlanCode;
  name: string;
  description: string;
  intervalUnit: 'months';
  intervalCount: number;
  priceCents: number;
  currency: 'BRL';
  active: boolean;
}

export interface BillingPlanRecord {
  id: string;
  code: BillingPlanCode;
  name: string;
  description: string;
  intervalUnit: string;
  intervalCount: number;
  priceCents: number;
  priceFormatted: string;
  currency: string;
  mercadoPagoPlanId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

const PLAN_CATALOG: readonly BillingPlanSeed[] = [
  {
    code: 'monthly',
    name: 'Plano Mensal',
    description: 'Acesso premium com renovacao mensal.',
    intervalUnit: 'months',
    intervalCount: 1,
    priceCents: 2000,
    currency: 'BRL',
    active: true
  },
  {
    code: 'quarterly',
    name: 'Plano Trimestral',
    description: 'Acesso premium com renovacao a cada 3 meses.',
    intervalUnit: 'months',
    intervalCount: 3,
    priceCents: 5400,
    currency: 'BRL',
    active: true
  },
  {
    code: 'yearly',
    name: 'Plano Anual',
    description: 'Acesso premium com renovacao anual.',
    intervalUnit: 'months',
    intervalCount: 12,
    priceCents: 20000,
    currency: 'BRL',
    active: true
  }
];

function assertNoError(error: { message: string } | null, context: string): void {
  if (!error) return;
  throw new Error(`${context}: ${error.message}`);
}

function formatCurrencyBrl(priceCents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(priceCents / 100);
}

function mapPlanRow(row: DbSubscriptionPlanRow): BillingPlanRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    intervalUnit: row.interval_unit,
    intervalCount: row.interval_count,
    priceCents: row.price_cents,
    priceFormatted: formatCurrencyBrl(row.price_cents),
    currency: row.currency,
    mercadoPagoPlanId: row.mercado_pago_plan_id,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function buildPlanMutation(seed: BillingPlanSeed, nowIso: string): Omit<DbSubscriptionPlanRow, 'id' | 'mercado_pago_plan_id'> {
  return {
    code: seed.code,
    name: seed.name,
    description: seed.description,
    interval_unit: seed.intervalUnit,
    interval_count: seed.intervalCount,
    price_cents: seed.priceCents,
    currency: seed.currency,
    active: seed.active,
    created_at: nowIso,
    updated_at: nowIso
  };
}

export function getBillingPlanCatalog(): readonly BillingPlanSeed[] {
  return PLAN_CATALOG;
}

export function isBillingPlanCode(value: string): value is BillingPlanCode {
  return PLAN_CATALOG.some((plan) => plan.code === value);
}

export function getBillingPlanDefinition(code: BillingPlanCode): BillingPlanSeed {
  const plan = PLAN_CATALOG.find((entry) => entry.code === code);
  if (!plan) {
    throw new Error(`Unknown billing plan code: ${code}`);
  }
  return plan;
}

export async function getBillingPlans(): Promise<BillingPlanRecord[]> {
  const { data, error } = await db
    .from(TABLE_NAME)
    .select('*')
    .order('interval_count', { ascending: true });

  assertNoError(error, 'getBillingPlans');
  return ((data ?? []) as DbSubscriptionPlanRow[]).map(mapPlanRow);
}

export async function ensureBillingPlansSeeded(): Promise<BillingPlanRecord[]> {
  const nowIso = new Date().toISOString();
  const codes = PLAN_CATALOG.map((plan) => plan.code);

  const { data: existingRows, error: existingError } = await db
    .from(TABLE_NAME)
    .select('*')
    .in('code', codes);

  assertNoError(existingError, 'ensureBillingPlansSeeded.select');

  const existingByCode = new Map(
    ((existingRows ?? []) as DbSubscriptionPlanRow[]).map((row) => [row.code, row] as const)
  );

  const missing = PLAN_CATALOG
    .filter((plan) => !existingByCode.has(plan.code))
    .map((plan) => buildPlanMutation(plan, nowIso));

  if (missing.length > 0) {
    const { error } = await db.from(TABLE_NAME).insert(missing);
    assertNoError(error, 'ensureBillingPlansSeeded.insert');
  }

  for (const seed of PLAN_CATALOG) {
    const current = existingByCode.get(seed.code);
    if (
      current &&
      current.name === seed.name &&
      current.description === seed.description &&
      current.interval_unit === seed.intervalUnit &&
      current.interval_count === seed.intervalCount &&
      current.price_cents === seed.priceCents &&
      current.currency === seed.currency &&
      current.active === seed.active
    ) {
      continue;
    }

    const mutation = buildPlanMutation(seed, current?.created_at ?? nowIso);
    const { error } = await db
      .from(TABLE_NAME)
      .update({
        name: mutation.name,
        description: mutation.description,
        interval_unit: mutation.interval_unit,
        interval_count: mutation.interval_count,
        price_cents: mutation.price_cents,
        currency: mutation.currency,
        active: mutation.active,
        updated_at: nowIso
      })
      .eq('code', seed.code);

    assertNoError(error, 'ensureBillingPlansSeeded.update');
  }

  return getBillingPlans();
}

export async function getBillingPlanByCode(code: BillingPlanCode): Promise<BillingPlanRecord | null> {
  const { data, error } = await db
    .from(TABLE_NAME)
    .select('*')
    .eq('code', code)
    .maybeSingle();

  assertNoError(error, 'getBillingPlanByCode');
  if (!data) return null;
  return mapPlanRow(data as DbSubscriptionPlanRow);
}

export async function setBillingPlanMercadoPagoId(
  code: BillingPlanCode,
  mercadoPagoPlanId: string
): Promise<void> {
  const { error } = await db
    .from(TABLE_NAME)
    .update({
      mercado_pago_plan_id: mercadoPagoPlanId,
      updated_at: new Date().toISOString()
    })
    .eq('code', code);

  assertNoError(error, 'setBillingPlanMercadoPagoId');
}
