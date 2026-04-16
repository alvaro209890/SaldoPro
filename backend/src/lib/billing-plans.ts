import { randomUUID } from 'node:crypto';
import { db, nowIso } from './local-db';

export type BillingPlanCode = 'monthly' | 'quarterly' | 'yearly';

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
] as const;

interface PlanRow {
  id: string;
  code: BillingPlanCode;
  name: string;
  description: string;
  interval_unit: string;
  interval_count: number;
  price_cents: number;
  currency: string;
  mercado_pago_plan_id: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

function formatCurrencyBrl(priceCents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(priceCents / 100);
}

function mapPlanRow(row: PlanRow): BillingPlanRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    intervalUnit: row.interval_unit,
    intervalCount: Number(row.interval_count),
    priceCents: Number(row.price_cents),
    priceFormatted: formatCurrencyBrl(Number(row.price_cents)),
    currency: row.currency,
    mercadoPagoPlanId: row.mercado_pago_plan_id,
    active: Number(row.active) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
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
  const rows = db
    .prepare('select * from app_subscription_plans order by interval_count asc')
    .all() as PlanRow[];
  return rows.map(mapPlanRow);
}

export async function ensureBillingPlansSeeded(): Promise<BillingPlanRecord[]> {
  const now = nowIso();
  const selectByCode = db.prepare('select * from app_subscription_plans where code = ?').pluck(false);
  const insertPlan = db.prepare(`
    insert into app_subscription_plans (
      id, code, name, description, interval_unit, interval_count, price_cents, currency,
      mercado_pago_plan_id, active, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updatePlan = db.prepare(`
    update app_subscription_plans
    set name = ?, description = ?, interval_unit = ?, interval_count = ?, price_cents = ?, currency = ?, active = ?, updated_at = ?
    where code = ?
  `);

  for (const plan of PLAN_CATALOG) {
    const existing = selectByCode.get(plan.code) as PlanRow | undefined;
    if (!existing) {
      insertPlan.run(
        randomUUID(),
        plan.code,
        plan.name,
        plan.description,
        plan.intervalUnit,
        plan.intervalCount,
        plan.priceCents,
        plan.currency,
        null,
        plan.active ? 1 : 0,
        now,
        now
      );
      continue;
    }

    updatePlan.run(
      plan.name,
      plan.description,
      plan.intervalUnit,
      plan.intervalCount,
      plan.priceCents,
      plan.currency,
      plan.active ? 1 : 0,
      now,
      plan.code
    );
  }

  return getBillingPlans();
}

export async function getBillingPlanByCode(code: BillingPlanCode): Promise<BillingPlanRecord | null> {
  const row = db
    .prepare('select * from app_subscription_plans where code = ? limit 1')
    .get(code) as PlanRow | undefined;
  return row ? mapPlanRow(row) : null;
}

export async function setBillingPlanMercadoPagoId(code: BillingPlanCode, mercadoPagoPlanId: string): Promise<void> {
  db.prepare(`
    update app_subscription_plans
    set mercado_pago_plan_id = ?, updated_at = ?
    where code = ?
  `).run(mercadoPagoPlanId, nowIso(), code);
}
