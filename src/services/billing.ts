import { auth } from '@/firebase/config';
import { BACKEND_URL } from '@/config/backend';

export type BillingPlanCode = 'monthly' | 'quarterly' | 'yearly';
export type BillingSubscriptionStatus = 'none' | 'pending' | 'authorized' | 'paused' | 'cancelled' | 'rejected';

export interface BillingPlan {
    code: BillingPlanCode;
    name: string;
    description: string;
    priceCents: number;
    priceFormatted: string;
    currency: string;
    intervalUnit: string;
    intervalCount: number;
}

export interface BillingStatusResponse {
    subscription: {
        status: BillingSubscriptionStatus;
        planCode: BillingPlanCode | null;
        nextBillingDate: string | null;
    };
    features: {
        webAiChat: boolean;
        webAiChatHistory: boolean;
        goals: boolean;
        documentStorage: boolean;
        whatsappUnlimitedAi: boolean;
        whatsappDocumentStorage: boolean;
    };
    freeWhatsappQuota: {
        enabled: boolean;
        limit: number;
        used: number;
        remaining: number;
        resetsAt: string;
    };
}

export interface BillingCheckoutInput {
    planCode: BillingPlanCode;
    payerEmail: string;
    cardTokenId: string;
    paymentMethodId: string;
    issuerId?: string;
    identificationType?: string;
    identificationNumber?: string;
}

interface BillingApiErrorPayload {
    error?: string;
    message?: string;
    code?: string;
    feature?: string;
}

export class BillingApiError extends Error {
    status: number;
    code?: string;
    feature?: string;

    constructor(message: string, status: number, payload?: BillingApiErrorPayload) {
        super(message);
        this.name = 'BillingApiError';
        this.status = status;
        this.code = payload?.code;
        this.feature = payload?.feature;
    }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
    const user = auth.currentUser;
    if (!user) {
        throw new Error('Usu\u00e1rio n\u00e3o autenticado.');
    }

    const idToken = await user.getIdToken();
    return {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
    };
}

async function billingRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BACKEND_URL}${path}`, {
        ...init,
        headers: {
            ...headers,
            ...(init?.headers ?? {}),
        },
    });

    if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: 'Erro ao acessar a area de planos.' })) as BillingApiErrorPayload;
        throw new BillingApiError(
            payload.message || payload.error || 'Erro ao acessar a area de planos.',
            response.status,
            payload
        );
    }

    if (response.status === 204) {
        return null as T;
    }

    return response.json() as Promise<T>;
}

export async function getBillingPlans(): Promise<BillingPlan[]> {
    const response = await billingRequest<{ plans: BillingPlan[] }>('/api/billing/plans');
    return response.plans;
}

export async function getBillingStatus(): Promise<BillingStatusResponse> {
    return billingRequest<BillingStatusResponse>('/api/billing/subscription');
}

export async function createBillingSubscriptionCheckout(
    input: BillingCheckoutInput
): Promise<BillingStatusResponse> {
    return billingRequest<BillingStatusResponse>('/api/billing/subscriptions/checkout', {
        method: 'POST',
        body: JSON.stringify(input),
    });
}

export async function cancelBillingSubscription(): Promise<BillingStatusResponse> {
    return billingRequest<BillingStatusResponse>('/api/billing/subscriptions/cancel', {
        method: 'POST',
    });
}
