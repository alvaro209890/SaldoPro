"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBillingPlanCatalog = getBillingPlanCatalog;
exports.isBillingPlanCode = isBillingPlanCode;
exports.getBillingPlanDefinition = getBillingPlanDefinition;
exports.getBillingPlans = getBillingPlans;
exports.ensureBillingPlansSeeded = ensureBillingPlansSeeded;
exports.getBillingPlanByCode = getBillingPlanByCode;
exports.setBillingPlanMercadoPagoId = setBillingPlanMercadoPagoId;
const supabase_1 = require("./supabase");
const TABLE_NAME = 'app_subscription_plans';
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
function assertNoError(error, context) {
    if (!error)
        return;
    throw new Error(`${context}: ${error.message}`);
}
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
function buildPlanMutation(seed, nowIso) {
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
    const { data, error } = await supabase_1.supabaseAdmin
        .from(TABLE_NAME)
        .select('*')
        .order('interval_count', { ascending: true });
    assertNoError(error, 'getBillingPlans');
    return (data ?? []).map(mapPlanRow);
}
async function ensureBillingPlansSeeded() {
    const nowIso = new Date().toISOString();
    const codes = PLAN_CATALOG.map((plan) => plan.code);
    const { data: existingRows, error: existingError } = await supabase_1.supabaseAdmin
        .from(TABLE_NAME)
        .select('*')
        .in('code', codes);
    assertNoError(existingError, 'ensureBillingPlansSeeded.select');
    const existingByCode = new Map((existingRows ?? []).map((row) => [row.code, row]));
    const missing = PLAN_CATALOG
        .filter((plan) => !existingByCode.has(plan.code))
        .map((plan) => buildPlanMutation(plan, nowIso));
    if (missing.length > 0) {
        const { error } = await supabase_1.supabaseAdmin.from(TABLE_NAME).insert(missing);
        assertNoError(error, 'ensureBillingPlansSeeded.insert');
    }
    for (const seed of PLAN_CATALOG) {
        const current = existingByCode.get(seed.code);
        if (current &&
            current.name === seed.name &&
            current.description === seed.description &&
            current.interval_unit === seed.intervalUnit &&
            current.interval_count === seed.intervalCount &&
            current.price_cents === seed.priceCents &&
            current.currency === seed.currency &&
            current.active === seed.active) {
            continue;
        }
        const mutation = buildPlanMutation(seed, current?.created_at ?? nowIso);
        const { error } = await supabase_1.supabaseAdmin
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
async function getBillingPlanByCode(code) {
    const { data, error } = await supabase_1.supabaseAdmin
        .from(TABLE_NAME)
        .select('*')
        .eq('code', code)
        .maybeSingle();
    assertNoError(error, 'getBillingPlanByCode');
    if (!data)
        return null;
    return mapPlanRow(data);
}
async function setBillingPlanMercadoPagoId(code, mercadoPagoPlanId) {
    const { error } = await supabase_1.supabaseAdmin
        .from(TABLE_NAME)
        .update({
        mercado_pago_plan_id: mercadoPagoPlanId,
        updated_at: new Date().toISOString()
    })
        .eq('code', code);
    assertNoError(error, 'setBillingPlanMercadoPagoId');
}
