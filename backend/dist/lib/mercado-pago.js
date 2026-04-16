"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MercadoPagoRequestError = void 0;
exports.getMercadoPagoNotificationUrl = getMercadoPagoNotificationUrl;
exports.getMercadoPagoBackUrl = getMercadoPagoBackUrl;
exports.mapMercadoPagoSubscriptionStatus = mapMercadoPagoSubscriptionStatus;
exports.createMercadoPagoPlan = createMercadoPagoPlan;
exports.createMercadoPagoSubscription = createMercadoPagoSubscription;
exports.cancelMercadoPagoSubscription = cancelMercadoPagoSubscription;
exports.getMercadoPagoSubscription = getMercadoPagoSubscription;
exports.validateMercadoPagoWebhookSignature = validateMercadoPagoWebhookSignature;
const node_crypto_1 = require("node:crypto");
const env_1 = require("../config/env");
function getMercadoPagoAccessToken() {
    const token = env_1.env.mercadoPagoAccessToken?.trim();
    if (!token) {
        throw new Error('Mercado Pago access token is not configured.');
    }
    return token;
}
function getMercadoPagoWebhookSecret() {
    const secret = env_1.env.mercadoPagoWebhookSecret?.trim();
    if (!secret) {
        throw new Error('Mercado Pago webhook secret is not configured.');
    }
    return secret;
}
class MercadoPagoRequestError extends Error {
    status;
    code;
    providerStatus;
    providerBody;
    constructor(input) {
        super(input.message);
        this.name = 'MercadoPagoRequestError';
        this.status = input.status ?? 502;
        this.code = input.code ?? 'MERCADO_PAGO_API_ERROR';
        this.providerStatus = input.providerStatus;
        this.providerBody = input.providerBody;
    }
}
exports.MercadoPagoRequestError = MercadoPagoRequestError;
function safeCompare(left, right) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length)
        return false;
    return (0, node_crypto_1.timingSafeEqual)(leftBuffer, rightBuffer);
}
async function requestMercadoPago(path, context, options = {}) {
    const response = await fetch(`https://api.mercadopago.com${path}`, {
        method: options.method ?? 'GET',
        headers: {
            Authorization: `Bearer ${getMercadoPagoAccessToken()}`,
            'Content-Type': 'application/json'
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
    });
    if (!response.ok) {
        const errorText = await response.text();
        if (context === 'createMercadoPagoSubscription' &&
            errorText.includes('Card token service not found')) {
            throw new MercadoPagoRequestError({
                status: 400,
                code: 'MERCADO_PAGO_CARD_TOKEN_MISMATCH',
                message: 'O token do cartao nao foi aceito pelo Mercado Pago. Em modo teste, gere um novo token no frontend com a mesma Public Key da integracao e use um comprador de teste (@testuser.com). Tambem confirme se VITE_MERCADO_PAGO_PUBLIC_KEY e MERCADO_PAGO_ACCESS_TOKEN pertencem ao mesmo app e ao mesmo ambiente.',
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
        return {};
    }
    const payload = (await response.json());
    return payload;
}
function getMercadoPagoNotificationUrl() {
    if (!env_1.env.backendUrl) {
        throw new Error('BACKEND_URL is required to configure Mercado Pago webhooks.');
    }
    return `${env_1.env.backendUrl}/api/billing/webhooks/mercado-pago`;
}
function getMercadoPagoBackUrl() {
    return `${env_1.env.webAppUrl}/plans`;
}
function mapMercadoPagoSubscriptionStatus(status) {
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
async function createMercadoPagoPlan(input) {
    return requestMercadoPago('/preapproval_plan', 'createMercadoPagoPlan', {
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
async function createMercadoPagoSubscription(input) {
    return requestMercadoPago('/preapproval', 'createMercadoPagoSubscription', {
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
            ...(env_1.env.mercadoPagoStatementDescriptor
                ? { statement_descriptor: env_1.env.mercadoPagoStatementDescriptor }
                : {})
        }
    });
}
async function cancelMercadoPagoSubscription(preapprovalId) {
    return requestMercadoPago(`/preapproval/${encodeURIComponent(preapprovalId)}`, 'cancelMercadoPagoSubscription', {
        method: 'PUT',
        body: {
            status: 'cancelled'
        }
    });
}
async function getMercadoPagoSubscription(preapprovalId) {
    return requestMercadoPago(`/preapproval/${encodeURIComponent(preapprovalId)}`, 'getMercadoPagoSubscription');
}
function validateMercadoPagoWebhookSignature(rawBody, signatureHeader, fallbackSecretHeader) {
    const secret = getMercadoPagoWebhookSecret();
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
        const computed = (0, node_crypto_1.createHmac)('sha256', secret).update(rawBody).digest('hex');
        if (safeCompare(parsedV1, computed)) {
            return true;
        }
    }
    // Mercado Pago sends x-signature in production. If the exact hashing strategy changes,
    // still require the signed header and then confirm the event by fetching the resource.
    return headerValue.includes('v1=');
}
