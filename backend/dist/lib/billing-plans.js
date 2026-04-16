"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBillingPlanCatalog = getBillingPlanCatalog;
exports.isBillingPlanCode = isBillingPlanCode;
exports.getBillingPlanDefinition = getBillingPlanDefinition;
exports.getBillingPlans = getBillingPlans;
exports.ensureBillingPlansSeeded = ensureBillingPlansSeeded;
exports.getBillingPlanByCode = getBillingPlanByCode;
exports.setBillingPlanMercadoPagoId = setBillingPlanMercadoPagoId;
const node_crypto_1 = require("node:crypto");
const local_db_1 = require("./local-db");
const PLAN_CATALOG = [
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
function formatCurrencyBrl(priceCents) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(priceCents / 100);
}
function mapPlanRow(row) {
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
function getBillingPlanCatalog() {
    return PLAN_CATALOG;
}
function isBillingPlanCode(value) {
    return PLAN_CATALOG.some((plan) => plan.code === value);
}
function getBillingPlanDefinition(code) {
    const plan = PLAN_CATALOG.find((entry) => entry.code === code);
    if (!plan) {
        throw new Error(`Unknown billing plan code: ${code}`);
    }
    return plan;
}
async function getBillingPlans() {
    const rows = local_db_1.db
        .prepare('select * from app_subscription_plans order by interval_count asc')
        .all();
    return rows.map(mapPlanRow);
}
async function ensureBillingPlansSeeded() {
    const now = (0, local_db_1.nowIso)();
    const selectByCode = local_db_1.db.prepare('select * from app_subscription_plans where code = ?').pluck(false);
    const insertPlan = local_db_1.db.prepare(`
    insert into app_subscription_plans (
      id, code, name, description, interval_unit, interval_count, price_cents, currency,
      mercado_pago_plan_id, active, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const updatePlan = local_db_1.db.prepare(`
    update app_subscription_plans
    set name = ?, description = ?, interval_unit = ?, interval_count = ?, price_cents = ?, currency = ?, active = ?, updated_at = ?
    where code = ?
  `);
    for (const plan of PLAN_CATALOG) {
        const existing = selectByCode.get(plan.code);
        if (!existing) {
            insertPlan.run((0, node_crypto_1.randomUUID)(), plan.code, plan.name, plan.description, plan.intervalUnit, plan.intervalCount, plan.priceCents, plan.currency, null, plan.active ? 1 : 0, now, now);
            continue;
        }
        updatePlan.run(plan.name, plan.description, plan.intervalUnit, plan.intervalCount, plan.priceCents, plan.currency, plan.active ? 1 : 0, now, plan.code);
    }
    return getBillingPlans();
}
async function getBillingPlanByCode(code) {
    const row = local_db_1.db
        .prepare('select * from app_subscription_plans where code = ? limit 1')
        .get(code);
    return row ? mapPlanRow(row) : null;
}
async function setBillingPlanMercadoPagoId(code, mercadoPagoPlanId) {
    local_db_1.db.prepare(`
    update app_subscription_plans
    set mercado_pago_plan_id = ?, updated_at = ?
    where code = ?
  `).run(mercadoPagoPlanId, (0, local_db_1.nowIso)(), code);
}
