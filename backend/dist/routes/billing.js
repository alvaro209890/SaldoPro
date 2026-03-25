"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBillingRouter = createBillingRouter;
const express_1 = require("express");
const billing_plans_1 = require("../lib/billing-plans");
const daily_ai_quota_1 = require("../lib/daily-ai-quota");
const mercado_pago_1 = require("../lib/mercado-pago");
const subscription_access_1 = require("../lib/subscription-access");
const logger_1 = require("../lib/logger");
const supabase_auth_1 = require("../middleware/supabase-auth");
function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function getUid(req) {
    const uid = req.uid;
    if (!uid) {
        throw new Error('Authenticated UID not available.');
    }
    return uid;
}
function buildExternalReference(uid, planCode) {
    return `uid:${uid}|plan:${planCode}|ts:${Date.now()}`;
}
async function ensureMercadoPagoPlanForCode(code) {
    const existing = await (0, billing_plans_1.getBillingPlanByCode)(code);
    if (!existing) {
        throw new Error(`Billing plan not found locally for code: ${code}`);
    }
    if (existing.mercadoPagoPlanId) {
        return existing;
    }
    const definition = (0, billing_plans_1.getBillingPlanDefinition)(code);
    const remotePlan = await (0, mercado_pago_1.createMercadoPagoPlan)({
        reason: definition.name,
        frequency: definition.intervalCount,
        frequencyType: definition.intervalUnit,
        transactionAmount: definition.priceCents / 100,
        currencyId: definition.currency
    });
    if (!remotePlan.id) {
        throw new Error(`Mercado Pago did not return a plan id for ${code}.`);
    }
    await (0, billing_plans_1.setBillingPlanMercadoPagoId)(code, remotePlan.id);
    const refreshed = await (0, billing_plans_1.getBillingPlanByCode)(code);
    if (!refreshed) {
        throw new Error(`Billing plan ${code} disappeared after Mercado Pago sync.`);
    }
    return refreshed;
}
async function ensureAllMercadoPagoPlans() {
    await (0, billing_plans_1.ensureBillingPlansSeeded)();
    const plans = await (0, billing_plans_1.getBillingPlans)();
    const synced = [];
    for (const plan of plans) {
        synced.push(await ensureMercadoPagoPlanForCode(plan.code));
    }
    return synced;
}
function buildSubscriptionPayload(record) {
    if (!record) {
        return {
            status: 'none',
            planCode: null,
            nextBillingDate: null
        };
    }
    return {
        status: record.status,
        planCode: record.planCode,
        nextBillingDate: record.nextBillingDate
    };
}
function isWebhookSubscriptionEvent(body) {
    const normalizedType = asString(body.type).toLowerCase();
    return normalizedType === 'preapproval' || normalizedType === 'subscription_preapproval';
}
function createBillingRouter() {
    const router = (0, express_1.Router)();
    router.get('/plans', async (_req, res, next) => {
        try {
            const plans = await ensureAllMercadoPagoPlans();
            res.json({
                plans: plans.map((plan) => ({
                    code: plan.code,
                    name: plan.name,
                    description: plan.description,
                    priceCents: plan.priceCents,
                    priceFormatted: plan.priceFormatted,
                    currency: plan.currency,
                    intervalUnit: plan.intervalUnit,
                    intervalCount: plan.intervalCount
                }))
            });
        }
        catch (error) {
            next(error);
        }
    });
    router.get('/subscription', supabase_auth_1.requireSupabaseAuth, async (req, res, next) => {
        try {
            const uid = getUid(req);
            const [subscription, access] = await Promise.all([
                (0, subscription_access_1.getLatestUserSubscription)(uid),
                (0, subscription_access_1.getUserPlanAccess)(uid)
            ]);
            res.json({
                subscription: buildSubscriptionPayload(subscription),
                features: access.features,
                freeWhatsappQuota: {
                    enabled: access.freeWhatsappQuota.enabled,
                    limit: daily_ai_quota_1.FREE_WHATSAPP_DAILY_LIMIT,
                    used: access.freeWhatsappQuota.used,
                    remaining: access.freeWhatsappQuota.remaining,
                    resetsAt: access.freeWhatsappQuota.resetsAt
                }
            });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/subscriptions/checkout', supabase_auth_1.requireSupabaseAuth, async (req, res, next) => {
        try {
            const uid = getUid(req);
            const body = (req.body ?? {});
            const planCodeRaw = asString(body.planCode);
            const payerEmail = asString(body.payerEmail);
            const cardTokenId = asString(body.cardTokenId);
            const paymentMethodId = asString(body.paymentMethodId);
            const issuerId = asString(body.issuerId);
            const identificationType = asString(body.identificationType);
            const identificationNumber = asString(body.identificationNumber);
            if (!(0, billing_plans_1.isBillingPlanCode)(planCodeRaw)) {
                res.status(400).json({ error: '`planCode` invalido.' });
                return;
            }
            if (!payerEmail || !payerEmail.includes('@')) {
                res.status(400).json({ error: '`payerEmail` invalido.' });
                return;
            }
            if (!cardTokenId) {
                res.status(400).json({ error: '`cardTokenId` e obrigatorio.' });
                return;
            }
            await (0, billing_plans_1.ensureBillingPlansSeeded)();
            const plan = await ensureMercadoPagoPlanForCode(planCodeRaw);
            if (!plan.mercadoPagoPlanId) {
                throw new Error(`Mercado Pago plan id is missing for ${planCodeRaw}.`);
            }
            const replaceable = await (0, subscription_access_1.listUserSubscriptionsByStatuses)(uid, ['pending', 'authorized', 'paused']);
            for (const current of replaceable) {
                if (current.mercadoPagoPreapprovalId) {
                    await (0, mercado_pago_1.cancelMercadoPagoSubscription)(current.mercadoPagoPreapprovalId);
                }
                await (0, subscription_access_1.updateUserSubscriptionRecord)(current.id, {
                    status: 'cancelled',
                    statusReason: 'replaced',
                    cancelledAt: new Date().toISOString(),
                    lastPaymentStatus: 'cancelled'
                });
            }
            const externalReference = buildExternalReference(uid, planCodeRaw);
            const remote = await (0, mercado_pago_1.createMercadoPagoSubscription)({
                preapprovalPlanId: plan.mercadoPagoPlanId,
                payerEmail,
                cardTokenId,
                externalReference,
                reason: plan.name,
                ...(paymentMethodId ? { paymentMethodId } : {}),
                ...(issuerId ? { issuerId } : {}),
                ...(identificationType ? { identificationType } : {}),
                ...(identificationNumber ? { identificationNumber } : {})
            });
            const status = (0, mercado_pago_1.mapMercadoPagoSubscriptionStatus)(remote.status);
            const created = await (0, subscription_access_1.createUserSubscriptionRecord)({
                uid,
                planCode: planCodeRaw,
                status,
                statusReason: remote.status ?? null,
                mercadoPagoPreapprovalId: remote.id,
                mercadoPagoPlanId: plan.mercadoPagoPlanId,
                externalReference,
                payerEmail,
                nextBillingDate: remote.auto_recurring?.date_of_next_payment ?? null,
                lastPaymentAt: remote.last_modified ?? remote.date_created ?? null,
                lastPaymentStatus: remote.status ?? null,
                cancelledAt: status === 'cancelled' ? new Date().toISOString() : null
            });
            const access = await (0, subscription_access_1.getUserPlanAccess)(uid);
            res.status(201).json({
                subscription: buildSubscriptionPayload(created),
                features: access.features,
                freeWhatsappQuota: {
                    enabled: access.freeWhatsappQuota.enabled,
                    limit: daily_ai_quota_1.FREE_WHATSAPP_DAILY_LIMIT,
                    used: access.freeWhatsappQuota.used,
                    remaining: access.freeWhatsappQuota.remaining,
                    resetsAt: access.freeWhatsappQuota.resetsAt
                }
            });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/subscriptions/cancel', supabase_auth_1.requireSupabaseAuth, async (req, res, next) => {
        try {
            const uid = getUid(req);
            const current = await (0, subscription_access_1.getLatestUserSubscription)(uid);
            if (!current) {
                res.status(404).json({ error: 'Nenhuma assinatura encontrada para cancelar.' });
                return;
            }
            if (current.mercadoPagoPreapprovalId) {
                await (0, mercado_pago_1.cancelMercadoPagoSubscription)(current.mercadoPagoPreapprovalId);
            }
            const updated = await (0, subscription_access_1.updateUserSubscriptionRecord)(current.id, {
                status: 'cancelled',
                statusReason: 'cancelled_by_user',
                cancelledAt: new Date().toISOString(),
                lastPaymentStatus: 'cancelled'
            });
            const access = await (0, subscription_access_1.getUserPlanAccess)(uid);
            res.json({
                ok: true,
                subscription: buildSubscriptionPayload(updated),
                features: access.features,
                freeWhatsappQuota: {
                    enabled: access.freeWhatsappQuota.enabled,
                    limit: daily_ai_quota_1.FREE_WHATSAPP_DAILY_LIMIT,
                    used: access.freeWhatsappQuota.used,
                    remaining: access.freeWhatsappQuota.remaining,
                    resetsAt: access.freeWhatsappQuota.resetsAt
                }
            });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/webhooks/mercado-pago', async (req, res) => {
        const request = req;
        const body = (req.body ?? {});
        const providerEventId = String(body.id ?? body.data?.id ?? '').trim() || null;
        const eventType = [asString(body.type), asString(body.action)].filter(Boolean).join(':') || 'unknown';
        let billingEventId = null;
        try {
            billingEventId = await (0, subscription_access_1.createBillingEvent)({
                provider: 'mercado_pago',
                eventType,
                providerEventId,
                rawPayload: body
            });
            const signatureValid = (0, mercado_pago_1.validateMercadoPagoWebhookSignature)(request.rawBody ?? null, req.header('x-signature'), req.header('x-webhook-secret') ?? req.header('x-mp-webhook-secret'));
            if (!signatureValid) {
                await (0, subscription_access_1.markBillingEventFailed)(billingEventId, 'Invalid webhook signature');
                res.status(401).json({ error: 'Invalid webhook signature' });
                return;
            }
            if (!isWebhookSubscriptionEvent(body)) {
                await (0, subscription_access_1.markBillingEventProcessed)(billingEventId);
                res.status(200).json({ ok: true });
                return;
            }
            const preapprovalId = String(body.data?.id ?? '').trim();
            if (!preapprovalId) {
                await (0, subscription_access_1.markBillingEventProcessed)(billingEventId);
                res.status(200).json({ ok: true });
                return;
            }
            const localSubscription = await (0, subscription_access_1.getUserSubscriptionByMercadoPagoId)(preapprovalId);
            if (!localSubscription) {
                await (0, subscription_access_1.markBillingEventProcessed)(billingEventId);
                res.status(200).json({ ok: true });
                return;
            }
            const remote = await (0, mercado_pago_1.getMercadoPagoSubscription)(preapprovalId);
            const mappedStatus = (0, mercado_pago_1.mapMercadoPagoSubscriptionStatus)(remote.status);
            await (0, subscription_access_1.updateUserSubscriptionByMercadoPagoId)(preapprovalId, {
                status: mappedStatus,
                statusReason: remote.status ?? null,
                nextBillingDate: remote.auto_recurring?.date_of_next_payment ?? null,
                lastPaymentAt: remote.last_modified ?? remote.date_created ?? null,
                lastPaymentStatus: remote.status ?? null,
                cancelledAt: mappedStatus === 'cancelled' ? new Date().toISOString() : null
            });
            await (0, subscription_access_1.markBillingEventProcessed)(billingEventId);
            res.status(200).json({ ok: true });
        }
        catch (error) {
            logger_1.logger.error('Failed to process Mercado Pago webhook', {
                error: error instanceof Error ? error.message : 'unknown'
            });
            if (billingEventId) {
                try {
                    await (0, subscription_access_1.markBillingEventFailed)(billingEventId, error instanceof Error ? error.message : 'unknown');
                }
                catch (markError) {
                    logger_1.logger.error('Failed to mark billing event as failed', {
                        eventId: billingEventId,
                        error: markError instanceof Error ? markError.message : 'unknown'
                    });
                }
            }
            res.status(500).json({ error: 'Webhook processing failed' });
        }
    });
    router.use((error, _req, res, _next) => {
        if (error instanceof mercado_pago_1.MercadoPagoRequestError) {
            logger_1.logger.error('Billing Mercado Pago error', {
                code: error.code,
                status: error.status,
                providerStatus: error.providerStatus,
                providerBody: error.providerBody
            });
            res.status(error.status).json({
                error: error.message,
                code: error.code
            });
            return;
        }
        logger_1.logger.error('Billing route error', error);
        const message = error instanceof Error ? error.message : 'Unexpected error';
        res.status(500).json({ error: message });
    });
    return router;
}
