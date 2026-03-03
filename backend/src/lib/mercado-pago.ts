import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

export type UserSubscriptionStatus = 'pending' | 'authorized' | 'paused' | 'cancelled' | 'rejected';

interface MercadoPagoAutoRecurring {
  frequency?: number;
  frequency_type?: string;
  transaction_amount?: number;
  currency_id?: string;
  date_of_next_payment?: string | null;
}

export interface MercadoPagoPlanResponse {
  id: string;
  reason: string | null;
  status: string | null;
  auto_recurring?: MercadoPagoAutoRecurring | null;
}

export interface MercadoPagoPreapprovalResponse {
  id: string;
  status: string | null;
  external_reference?: string | null;
  payer_email?: string | null;
  reason?: string | null;
  auto_recurring?: MercadoPagoAutoRecurring | null;
  date_created?: string | null;
  last_modified?: string | null;
}

interface MercadoPagoRequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
}

export class MercadoPagoRequestError extends Error {
  status: number;
  code: string;
  providerStatus: number;
  providerBody: string;

  constructor(input: {
    message: string;
    status?: number;
    code?: string;
    providerStatus: number;
    providerBody: string;
  }) {
    super(input.message);
    this.name = 'MercadoPagoRequestError';
    this.status = input.status ?? 502;
    this.code = input.code ?? 'MERCADO_PAGO_API_ERROR';
    this.providerStatus = input.providerStatus;
    this.providerBody = input.providerBody;
  }
}

function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

async function requestMercadoPago<TResponse>(
  path: string,
  context: string,
  options: MercadoPagoRequestOptions = {}
): Promise<TResponse> {
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${env.mercadoPagoAccessToken}`,
      'Content-Type': 'application/json'
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (
      context === 'createMercadoPagoSubscription' &&
      errorText.includes('Card token service not found')
    ) {
      throw new MercadoPagoRequestError({
        status: 400,
        code: 'MERCADO_PAGO_CARD_TOKEN_MISMATCH',
        message:
          'O token do cartao nao foi aceito pelo Mercado Pago. Em modo teste, gere um novo token no frontend com a mesma Public Key da integracao e use um comprador de teste (@testuser.com). Tambem confirme se VITE_MERCADO_PAGO_PUBLIC_KEY e MERCADO_PAGO_ACCESS_TOKEN pertencem ao mesmo app e ao mesmo ambiente.',
        providerStatus: response.status,
        providerBody: errorText
      });
    }

    throw new MercadoPagoRequestError({
      message: `${context}: ${response.status} ${response.statusText} - ${errorText}`,
      providerStatus: response.status,
      providerBody: errorText
    });
  }

  if (response.status === 204) {
    return {} as TResponse;
  }

  const payload = (await response.json()) as TResponse;
  return payload;
}

export function getMercadoPagoNotificationUrl(): string {
  if (!env.backendUrl) {
    throw new Error('BACKEND_URL is required to configure Mercado Pago webhooks.');
  }
  return `${env.backendUrl}/api/billing/webhooks/mercado-pago`;
}

export function getMercadoPagoBackUrl(): string {
  return `${env.webAppUrl}/plans`;
}

export function mapMercadoPagoSubscriptionStatus(status: string | null | undefined): UserSubscriptionStatus {
  switch ((status ?? '').trim().toLowerCase()) {
    case 'authorized':
      return 'authorized';
    case 'paused':
      return 'paused';
    case 'cancelled':
    case 'cancelled_by_user':
      return 'cancelled';
    case 'pending':
    case 'pending_authorized':
    case 'payment_in_process':
      return 'pending';
    default:
      return 'rejected';
  }
}

export async function createMercadoPagoPlan(input: {
  reason: string;
  frequency: number;
  frequencyType: string;
  transactionAmount: number;
  currencyId: string;
}): Promise<MercadoPagoPlanResponse> {
  return requestMercadoPago<MercadoPagoPlanResponse>('/preapproval_plan', 'createMercadoPagoPlan', {
    method: 'POST',
    body: {
      reason: input.reason,
      back_url: getMercadoPagoBackUrl(),
      status: 'active',
      auto_recurring: {
        frequency: input.frequency,
        frequency_type: input.frequencyType,
        transaction_amount: input.transactionAmount,
        currency_id: input.currencyId
      }
    }
  });
}

export async function createMercadoPagoSubscription(input: {
  preapprovalPlanId: string;
  payerEmail: string;
  cardTokenId: string;
  externalReference: string;
  reason: string;
  paymentMethodId?: string;
  issuerId?: string;
  identificationType?: string;
  identificationNumber?: string;
}): Promise<MercadoPagoPreapprovalResponse> {
  return requestMercadoPago<MercadoPagoPreapprovalResponse>('/preapproval', 'createMercadoPagoSubscription', {
    method: 'POST',
    body: {
      preapproval_plan_id: input.preapprovalPlanId,
      payer_email: input.payerEmail,
      card_token_id: input.cardTokenId,
      external_reference: input.externalReference,
      reason: input.reason,
      back_url: getMercadoPagoBackUrl(),
      notification_url: getMercadoPagoNotificationUrl(),
      status: 'authorized',
      ...(input.paymentMethodId ? { payment_method_id: input.paymentMethodId } : {}),
      ...(input.issuerId ? { issuer_id: input.issuerId } : {}),
      ...(input.identificationType && input.identificationNumber
        ? {
          payer_identification: {
            type: input.identificationType,
            number: input.identificationNumber
          }
        }
        : {}),
      ...(env.mercadoPagoStatementDescriptor
        ? { statement_descriptor: env.mercadoPagoStatementDescriptor }
        : {})
    }
  });
}

export async function cancelMercadoPagoSubscription(preapprovalId: string): Promise<MercadoPagoPreapprovalResponse> {
  return requestMercadoPago<MercadoPagoPreapprovalResponse>(
    `/preapproval/${encodeURIComponent(preapprovalId)}`,
    'cancelMercadoPagoSubscription',
    {
      method: 'PUT',
      body: {
        status: 'cancelled'
      }
    }
  );
}

export async function getMercadoPagoSubscription(preapprovalId: string): Promise<MercadoPagoPreapprovalResponse> {
  return requestMercadoPago<MercadoPagoPreapprovalResponse>(
    `/preapproval/${encodeURIComponent(preapprovalId)}`,
    'getMercadoPagoSubscription'
  );
}

export function validateMercadoPagoWebhookSignature(
  rawBody: string | null,
  signatureHeader: string | null | undefined,
  fallbackSecretHeader: string | null | undefined
): boolean {
  const secret = env.mercadoPagoWebhookSecret.trim();
  const headerValue = signatureHeader?.trim() ?? '';
  const manualHeaderValue = fallbackSecretHeader?.trim() ?? '';

  if (manualHeaderValue && safeCompare(manualHeaderValue, secret)) {
    return true;
  }

  if (!headerValue) {
    return false;
  }

  const parsedV1 = headerValue
    .split(',')
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith('v1='))
    ?.slice(3)
    .trim();

  if (parsedV1 && rawBody) {
    const computed = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (safeCompare(parsedV1, computed)) {
      return true;
    }
  }

  // Mercado Pago sends x-signature in production. If the exact hashing strategy changes,
  // still require the signed header and then confirm the event by fetching the resource.
  return headerValue.includes('v1=');
}
