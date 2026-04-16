import { Router, type NextFunction, type Request, type Response } from 'express';
import { env } from '../config/env';
import { ensureBillingPlansSeeded, getBillingPlanByCode, getBillingPlanDefinition, getBillingPlans, isBillingPlanCode, setBillingPlanMercadoPagoId, type BillingPlanCode, type BillingPlanRecord } from '../lib/billing-plans';
import { FREE_WHATSAPP_DAILY_LIMIT } from '../lib/daily-ai-quota';
import {
  cancelMercadoPagoSubscription,
  createMercadoPagoPlan,
  MercadoPagoRequestError,
  createMercadoPagoSubscription,
  getMercadoPagoSubscription,
  mapMercadoPagoSubscriptionStatus,
  validateMercadoPagoWebhookSignature
} from '../lib/mercado-pago';
import {
  createBillingEvent,
  createUserSubscriptionRecord,
  getLatestUserSubscription,
  getUserPlanAccess,
  getUserSubscriptionByMercadoPagoId,
  listUserSubscriptionsByStatuses,
  markBillingEventFailed,
  markBillingEventProcessed,
  updateUserSubscriptionByMercadoPagoId,
  updateUserSubscriptionRecord
} from '../lib/subscription-access';
import { logger } from '../lib/logger';
import { requireSupabaseAuth } from '../middleware/supabase-auth';

interface RawBodyRequest extends Request {
  rawBody?: string;
  uid?: string;
}

interface CheckoutBody {
  planCode?: unknown;
  payerEmail?: unknown;
  cardTokenId?: unknown;
  paymentMethodId?: unknown;
  issuerId?: unknown;
  identificationType?: unknown;
  identificationNumber?: unknown;
}

interface MercadoPagoWebhookBody {
  id?: string | number;
  action?: string;
  type?: string;
  data?: {
    id?: string | number;
  };
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getUid(req: Request): string {
  const uid = (req as RawBodyRequest).uid;
  if (!uid) {
    throw new Error('Authenticated UID not available.');
  }
  return uid;
}

function buildExternalReference(uid: string, planCode: BillingPlanCode): string {
  return `uid:${uid}|plan:${planCode}|ts:${Date.now()}`;
}

function isMercadoPagoConfigured(): boolean {
  return Boolean(env.mercadoPagoAccessToken && env.mercadoPagoWebhookSecret);
}

async function ensureMercadoPagoPlanForCode(code: BillingPlanCode): Promise<BillingPlanRecord> {
  const existing = await getBillingPlanByCode(code);
  if (!existing) {
    throw new Error(`Billing plan not found locally for code: ${code}`);
  }

  if (existing.mercadoPagoPlanId) {
    return existing;
  }

  const definition = getBillingPlanDefinition(code);
  const remotePlan = await createMercadoPagoPlan({
    reason: definition.name,
    frequency: definition.intervalCount,
    frequencyType: definition.intervalUnit,
    transactionAmount: definition.priceCents / 100,
    currencyId: definition.currency
  });

  if (!remotePlan.id) {
    throw new Error(`Mercado Pago did not return a plan id for ${code}.`);
  }

  await setBillingPlanMercadoPagoId(code, remotePlan.id);
  const refreshed = await getBillingPlanByCode(code);
  if (!refreshed) {
    throw new Error(`Billing plan ${code} disappeared after Mercado Pago sync.`);
  }
  return refreshed;
}

async function ensureAllMercadoPagoPlans(): Promise<BillingPlanRecord[]> {
  await ensureBillingPlansSeeded();
  const plans = await getBillingPlans();
  if (!isMercadoPagoConfigured()) {
    return plans;
  }
  const synced: BillingPlanRecord[] = [];

  for (const plan of plans) {
    synced.push(await ensureMercadoPagoPlanForCode(plan.code));
  }

  return synced;
}

function buildSubscriptionPayload(record: Awaited<ReturnType<typeof getLatestUserSubscription>>) {
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

function isWebhookSubscriptionEvent(body: MercadoPagoWebhookBody): boolean {
  const normalizedType = asString(body.type).toLowerCase();
  return normalizedType === 'preapproval' || normalizedType === 'subscription_preapproval';
}

export function createBillingRouter(): Router {
  const router = Router();

  router.get('/plans', async (_req: Request, res: Response, next) => {
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
    } catch (error) {
      next(error);
    }
  });

  router.get('/subscription', requireSupabaseAuth, async (req: Request, res: Response, next) => {
    try {
      const uid = getUid(req);
      const [subscription, access] = await Promise.all([
        getLatestUserSubscription(uid),
        getUserPlanAccess(uid)
      ]);

      res.json({
        subscription: buildSubscriptionPayload(subscription),
        features: access.features,
        freeWhatsappQuota: {
          enabled: access.freeWhatsappQuota.enabled,
          limit: FREE_WHATSAPP_DAILY_LIMIT,
          used: access.freeWhatsappQuota.used,
          remaining: access.freeWhatsappQuota.remaining,
          resetsAt: access.freeWhatsappQuota.resetsAt
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/subscriptions/checkout', requireSupabaseAuth, async (req: Request, res: Response, next) => {
    try {
      if (!isMercadoPagoConfigured()) {
        res.status(503).json({ error: 'Mercado Pago nao esta configurado neste ambiente local.' });
        return;
      }

      const uid = getUid(req);
      const body = (req.body ?? {}) as CheckoutBody;
      const planCodeRaw = asString(body.planCode);
      const payerEmail = asString(body.payerEmail);
      const cardTokenId = asString(body.cardTokenId);
      const paymentMethodId = asString(body.paymentMethodId);
      const issuerId = asString(body.issuerId);
      const identificationType = asString(body.identificationType);
      const identificationNumber = asString(body.identificationNumber);

      if (!isBillingPlanCode(planCodeRaw)) {
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

      await ensureBillingPlansSeeded();
      const plan = await ensureMercadoPagoPlanForCode(planCodeRaw);
      if (!plan.mercadoPagoPlanId) {
        throw new Error(`Mercado Pago plan id is missing for ${planCodeRaw}.`);
      }

      const replaceable = await listUserSubscriptionsByStatuses(uid, ['pending', 'authorized', 'paused']);
      for (const current of replaceable) {
        if (current.mercadoPagoPreapprovalId) {
          await cancelMercadoPagoSubscription(current.mercadoPagoPreapprovalId);
        }
        await updateUserSubscriptionRecord(current.id, {
          status: 'cancelled',
          statusReason: 'replaced',
          cancelledAt: new Date().toISOString(),
          lastPaymentStatus: 'cancelled'
        });
      }

      const externalReference = buildExternalReference(uid, planCodeRaw);
      const remote = await createMercadoPagoSubscription({
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

      const status = mapMercadoPagoSubscriptionStatus(remote.status);
      const created = await createUserSubscriptionRecord({
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

      const access = await getUserPlanAccess(uid);
      res.status(201).json({
        subscription: buildSubscriptionPayload(created),
        features: access.features,
        freeWhatsappQuota: {
          enabled: access.freeWhatsappQuota.enabled,
          limit: FREE_WHATSAPP_DAILY_LIMIT,
          used: access.freeWhatsappQuota.used,
          remaining: access.freeWhatsappQuota.remaining,
          resetsAt: access.freeWhatsappQuota.resetsAt
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/subscriptions/cancel', requireSupabaseAuth, async (req: Request, res: Response, next) => {
    try {
      if (!isMercadoPagoConfigured()) {
        res.status(503).json({ error: 'Mercado Pago nao esta configurado neste ambiente local.' });
        return;
      }

      const uid = getUid(req);
      const current = await getLatestUserSubscription(uid);

      if (!current) {
        res.status(404).json({ error: 'Nenhuma assinatura encontrada para cancelar.' });
        return;
      }

      if (current.mercadoPagoPreapprovalId) {
        await cancelMercadoPagoSubscription(current.mercadoPagoPreapprovalId);
      }

      const updated = await updateUserSubscriptionRecord(current.id, {
        status: 'cancelled',
        statusReason: 'cancelled_by_user',
        cancelledAt: new Date().toISOString(),
        lastPaymentStatus: 'cancelled'
      });

      const access = await getUserPlanAccess(uid);
      res.json({
        ok: true,
        subscription: buildSubscriptionPayload(updated),
        features: access.features,
        freeWhatsappQuota: {
          enabled: access.freeWhatsappQuota.enabled,
          limit: FREE_WHATSAPP_DAILY_LIMIT,
          used: access.freeWhatsappQuota.used,
          remaining: access.freeWhatsappQuota.remaining,
          resetsAt: access.freeWhatsappQuota.resetsAt
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/webhooks/mercado-pago', async (req: Request, res: Response) => {
    if (!isMercadoPagoConfigured()) {
      res.status(503).json({ error: 'Mercado Pago nao esta configurado neste ambiente local.' });
      return;
    }

    const request = req as RawBodyRequest;
    const body = (req.body ?? {}) as MercadoPagoWebhookBody;
    const providerEventId = String(body.id ?? body.data?.id ?? '').trim() || 'unknown';
    const eventType = [asString(body.type), asString(body.action)].filter(Boolean).join(':') || 'unknown';

    let billingEventId: string | null = null;
    try {
      billingEventId = await createBillingEvent({
        provider: 'mercado_pago',
        eventType,
        providerEventId,
        rawPayload: body
      });

      const signatureValid = validateMercadoPagoWebhookSignature(
        request.rawBody ?? null,
        req.header('x-signature'),
        req.header('x-webhook-secret') ?? req.header('x-mp-webhook-secret')
      );

      if (!signatureValid) {
        await markBillingEventFailed(billingEventId, 'Invalid webhook signature');
        res.status(401).json({ error: 'Invalid webhook signature' });
        return;
      }

      if (!isWebhookSubscriptionEvent(body)) {
        await markBillingEventProcessed(billingEventId);
        res.status(200).json({ ok: true });
        return;
      }

      const preapprovalId = String(body.data?.id ?? '').trim();
      if (!preapprovalId) {
        await markBillingEventProcessed(billingEventId);
        res.status(200).json({ ok: true });
        return;
      }

      const localSubscription = await getUserSubscriptionByMercadoPagoId(preapprovalId);
      if (!localSubscription) {
        await markBillingEventProcessed(billingEventId);
        res.status(200).json({ ok: true });
        return;
      }

      const remote = await getMercadoPagoSubscription(preapprovalId);
      const mappedStatus = mapMercadoPagoSubscriptionStatus(remote.status);

      await updateUserSubscriptionByMercadoPagoId(preapprovalId, {
        status: mappedStatus,
        statusReason: remote.status ?? null,
        nextBillingDate: remote.auto_recurring?.date_of_next_payment ?? null,
        lastPaymentAt: remote.last_modified ?? remote.date_created ?? null,
        lastPaymentStatus: remote.status ?? null,
        cancelledAt: mappedStatus === 'cancelled' ? new Date().toISOString() : null
      });

      await markBillingEventProcessed(billingEventId);
      res.status(200).json({ ok: true });
    } catch (error) {
      logger.error('Failed to process Mercado Pago webhook', {
        error: error instanceof Error ? error.message : 'unknown'
      });

      if (billingEventId) {
        try {
          await markBillingEventFailed(
            billingEventId,
            error instanceof Error ? error.message : 'unknown'
          );
        } catch (markError) {
          logger.error('Failed to mark billing event as failed', {
            eventId: billingEventId,
            error: markError instanceof Error ? markError.message : 'unknown'
          });
        }
      }

      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  router.use(
    (
      error: unknown,
      _req: Request,
      res: Response,
      _next: NextFunction
    ): void => {
      if (error instanceof MercadoPagoRequestError) {
        logger.error('Billing Mercado Pago error', {
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

      logger.error('Billing route error', error);
      const message = error instanceof Error ? error.message : 'Unexpected error';
      res.status(500).json({ error: message });
    }
  );

  return router;
}
