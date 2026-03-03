import { useEffect, useRef, useState } from 'react';
import {
    BadgeCheck,
    Bot,
    Check,
    Crown,
    CreditCard,
    FileArchive,
    FileImage,
    FileText,
    LockKeyhole,
    RefreshCw,
    ShieldCheck,
    Sparkles,
    Star,
    Target,
    Wallet,
    Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { MERCADO_PAGO_PUBLIC_KEY } from '@/config/backend';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import {
    cancelBillingSubscription,
    createBillingSubscriptionCheckout,
    getBillingPlans,
    getBillingStatus,
    type BillingPlan,
    type BillingPlanCode,
    type BillingStatusResponse,
} from '@/services/billing';

type MercadoPagoCardFormData = {
    token?: string;
    paymentMethodId?: string;
    issuerId?: string;
    identificationType?: string;
    identificationNumber?: string;
    cardholderEmail?: string;
};

type MercadoPagoCardFormController = {
    getCardFormData: () => MercadoPagoCardFormData;
    destroy?: () => void;
    unmount?: () => void;
};

type MercadoPagoInstance = {
    cardForm: (config: {
        amount: string;
        iframe: boolean;
        form: {
            id: string;
            cardNumber: { id: string; placeholder?: string };
            expirationDate: { id: string; placeholder?: string };
            securityCode: { id: string; placeholder?: string };
            cardholderName: { id: string; placeholder?: string };
            cardholderEmail: { id: string; placeholder?: string };
            issuer: { id: string; placeholder?: string };
            installments: { id: string; placeholder?: string };
            identificationType: { id: string; placeholder?: string };
            identificationNumber: { id: string; placeholder?: string };
        };
        callbacks: {
            onFormMounted?: (error?: unknown) => void;
            onSubmit: (event: Event) => void;
            onFetching?: (_resource: string) => (() => void) | void;
        };
    }) => MercadoPagoCardFormController;
};

declare global {
    interface Window {
        MercadoPago?: new (publicKey: string, options?: { locale?: string }) => MercadoPagoInstance;
    }
}

const PLAN_BADGES: Record<BillingPlanCode, string> = {
    monthly: 'Entrada rápida',
    quarterly: 'Melhor custo-beneficio',
    yearly: 'Maior economia',
};

const FEATURE_SECTIONS = [
    {
        title: 'IA completa, sem limite diario',
        description: 'Libera o chat com IA no painel, o lancamento por IA e o WhatsApp sem a trava de 1 mensagem por dia.',
        icon: Bot,
    },
    {
        title: 'Metas com acompanhamento inteligente',
        description: 'Crie, acompanhe, conclua e ajuste metas com apoio da IA, tanto no painel quanto pelo WhatsApp.',
        icon: Target,
    },
    {
        title: 'Arquivos e comprovantes sempre acessiveis',
        description: 'Salve imagens, PDFs e ZIPs, recupere pelo chat e mantenha tudo organizado sem depender de buscas manuais.',
        icon: FileText,
    },
    {
        title: 'Automacoes financeiras e historico',
        description: 'Mantenha historico do chat com IA, receba respostas mais completas e use os fluxos premium do assistente.',
        icon: Sparkles,
    },
];

const POWER_FEATURES = [
    { label: 'Salvar imagens', icon: FileImage },
    { label: 'Salvar PDFs', icon: FileText },
    { label: 'Salvar ZIPs', icon: FileArchive },
    { label: 'Metas com IA', icon: Target },
    { label: 'WhatsApp sem limite', icon: Zap },
    { label: 'Chat IA no painel', icon: Bot },
];

function formatDate(value: string | null): string {
    if (!value) return 'Sem data definida';
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return value;
    return new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'long',
        timeStyle: 'short',
    }).format(new Date(parsed));
}

function formatBillingStatus(status: BillingStatusResponse['subscription']['status']): string {
    switch (status) {
        case 'authorized':
            return 'Premium ativo';
        case 'pending':
            return 'Pagamento em analise';
        case 'paused':
            return 'Assinatura pausada';
        case 'cancelled':
            return 'Assinatura cancelada';
        case 'rejected':
            return 'Pagamento recusado';
        default:
            return 'Sem plano ativo';
    }
}

function statusTone(status: BillingStatusResponse['subscription']['status']): string {
    if (status === 'authorized') return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200';
    if (status === 'pending') return 'border-amber-400/25 bg-amber-500/10 text-amber-200';
    if (status === 'paused' || status === 'cancelled' || status === 'rejected') return 'border-rose-400/25 bg-rose-500/10 text-rose-200';
    return 'border-white/10 bg-white/5 text-slate-200';
}

function planCardTone(code: BillingPlanCode, selected: boolean): string {
    if (selected && code === 'quarterly') {
        return 'border-emerald-400/35 bg-emerald-500/12 shadow-[0_20px_60px_rgba(16,185,129,0.14)]';
    }
    if (selected && code === 'yearly') {
        return 'border-amber-400/35 bg-amber-500/10 shadow-[0_20px_60px_rgba(245,158,11,0.12)]';
    }
    if (selected) {
        return 'border-indigo-400/35 bg-indigo-500/10 shadow-[0_20px_60px_rgba(99,102,241,0.14)]';
    }
    return 'border-white/10 bg-white/[0.035] hover:border-white/20 hover:bg-white/[0.06]';
}

function checkoutButtonLabel(
    selectedPlanCode: BillingPlanCode,
    status: BillingStatusResponse['subscription']['status'],
    currentPlanCode: BillingPlanCode | null
): string {
    if (status === 'authorized' && currentPlanCode === selectedPlanCode) {
        return 'Atualizar cartao deste plano';
    }
    if (status === 'authorized') {
        return 'Trocar para este plano';
    }
    if (status === 'pending') {
        return 'Enviar nova cobranca';
    }
    return 'Ativar agora';
}

export function Plans() {
    const { user, displayName } = useAuth();
    const [plans, setPlans] = useState<BillingPlan[]>([]);
    const [billingStatus, setBillingStatus] = useState<BillingStatusResponse | null>(null);
    const [selectedPlanCode, setSelectedPlanCode] = useState<BillingPlanCode>('quarterly');
    const [loading, setLoading] = useState(true);
    const [checkoutLoading, setCheckoutLoading] = useState(false);
    const [cancelLoading, setCancelLoading] = useState(false);
    const [sdkLoading, setSdkLoading] = useState(false);
    const [sdkReady, setSdkReady] = useState(false);
    const [sdkError, setSdkError] = useState('');
    const [checkoutError, setCheckoutError] = useState('');
    const cardFormRef = useRef<MercadoPagoCardFormController | null>(null);
    const checkoutLoadingRef = useRef(false);

    checkoutLoadingRef.current = checkoutLoading;

    const selectedPlan = plans.find((plan) => plan.code === selectedPlanCode) ?? plans[0] ?? null;
    const currentPlan = plans.find((plan) => plan.code === billingStatus?.subscription.planCode) ?? null;
    const hasPremium = Boolean(billingStatus?.features.webAiChat);
    const canCancel = Boolean(
        billingStatus &&
        billingStatus.subscription.status !== 'none' &&
        billingStatus.subscription.status !== 'cancelled' &&
        billingStatus.subscription.status !== 'rejected'
    );

    async function loadBillingData() {
        setLoading(true);
        try {
            const [nextPlans, nextStatus] = await Promise.all([
                getBillingPlans(),
                getBillingStatus(),
            ]);

            setPlans(nextPlans);
            setBillingStatus(nextStatus);

            const preferredCode =
                nextStatus.subscription.planCode ??
                (nextPlans.some((plan) => plan.code === selectedPlanCode) ? selectedPlanCode : 'quarterly');

            if (nextPlans.some((plan) => plan.code === preferredCode)) {
                setSelectedPlanCode(preferredCode as BillingPlanCode);
            } else if (nextPlans[0]) {
                setSelectedPlanCode(nextPlans[0].code);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Nao foi possivel carregar a area de planos.';
            toast.error(message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void loadBillingData();
    }, []);

    useEffect(() => {
        if (!MERCADO_PAGO_PUBLIC_KEY) {
            setSdkError('Configure VITE_MERCADO_PAGO_PUBLIC_KEY para liberar o checkout com cartao.');
            setSdkReady(false);
            setSdkLoading(false);
            return;
        }

        if (typeof window === 'undefined') return;

        if (window.MercadoPago) {
            setSdkReady(true);
            setSdkLoading(false);
            setSdkError('');
            return;
        }

        let cancelled = false;
        setSdkLoading(true);

        const existingScript = document.getElementById('mercado-pago-sdk-v2') as HTMLScriptElement | null;
        const handleLoad = () => {
            if (cancelled) return;
            setSdkReady(true);
            setSdkLoading(false);
            setSdkError('');
        };
        const handleError = () => {
            if (cancelled) return;
            setSdkReady(false);
            setSdkLoading(false);
            setSdkError('Nao foi possivel carregar o checkout do Mercado Pago agora.');
        };

        if (existingScript) {
            existingScript.addEventListener('load', handleLoad);
            existingScript.addEventListener('error', handleError);
            return () => {
                cancelled = true;
                existingScript.removeEventListener('load', handleLoad);
                existingScript.removeEventListener('error', handleError);
            };
        }

        const script = document.createElement('script');
        script.id = 'mercado-pago-sdk-v2';
        script.src = 'https://sdk.mercadopago.com/js/v2';
        script.async = true;
        script.addEventListener('load', handleLoad);
        script.addEventListener('error', handleError);
        document.body.appendChild(script);

        return () => {
            cancelled = true;
            script.removeEventListener('load', handleLoad);
            script.removeEventListener('error', handleError);
        };
    }, []);

    useEffect(() => {
        if (!selectedPlan || !sdkReady || !window.MercadoPago || !MERCADO_PAGO_PUBLIC_KEY) {
            cardFormRef.current?.unmount?.();
            cardFormRef.current?.destroy?.();
            cardFormRef.current = null;
            return;
        }

        const formElement = document.getElementById('plans-checkout-form');
        if (!formElement) {
            return;
        }

        setCheckoutError('');
        setSdkError('');

        cardFormRef.current?.unmount?.();
        cardFormRef.current?.destroy?.();
        cardFormRef.current = null;

        let disposed = false;
        const mercadoPago = new window.MercadoPago(MERCADO_PAGO_PUBLIC_KEY, { locale: 'pt-BR' });
        const controller = mercadoPago.cardForm({
            amount: (selectedPlan.priceCents / 100).toFixed(2),
            iframe: true,
            form: {
                id: 'plans-checkout-form',
                cardNumber: {
                    id: 'plans-card-number',
                    placeholder: 'Numero do cartao'
                },
                expirationDate: {
                    id: 'plans-card-expiration',
                    placeholder: 'MM/AA'
                },
                securityCode: {
                    id: 'plans-card-cvc',
                    placeholder: 'CVV'
                },
                cardholderName: {
                    id: 'plans-cardholder-name',
                    placeholder: 'Nome como esta no cartao'
                },
                cardholderEmail: {
                    id: 'plans-cardholder-email',
                    placeholder: 'voce@email.com'
                },
                issuer: {
                    id: 'plans-issuer',
                    placeholder: 'Banco emissor'
                },
                installments: {
                    id: 'plans-installments',
                    placeholder: 'Opcao do emissor'
                },
                identificationType: {
                    id: 'plans-identification-type',
                    placeholder: 'Documento'
                },
                identificationNumber: {
                    id: 'plans-identification-number',
                    placeholder: 'Numero do documento'
                }
            },
            callbacks: {
                onFormMounted: (error?: unknown) => {
                    if (disposed) return;
                    if (error) {
                        setSdkError('Nao consegui inicializar os campos protegidos do Mercado Pago.');
                    }
                },
                onFetching: () => {
                    return () => undefined;
                },
                onSubmit: (event: Event) => {
                    event.preventDefault();
                    if (checkoutLoadingRef.current || !selectedPlan) {
                        return;
                    }

                    const formData = controller.getCardFormData();
                    const payerEmail = (formData.cardholderEmail ?? '').trim();
                    const cardTokenId = (formData.token ?? '').trim();
                    const paymentMethodId = (formData.paymentMethodId ?? '').trim();

                    if (!payerEmail || !payerEmail.includes('@')) {
                        const message = 'Informe um e-mail valido para concluir o pagamento.';
                        setCheckoutError(message);
                        toast.error(message);
                        return;
                    }

                    if (!cardTokenId) {
                        const message = 'Nao foi possivel validar o cartao. Revise os dados e tente novamente.';
                        setCheckoutError(message);
                        toast.error(message);
                        return;
                    }

                    if (!paymentMethodId) {
                        const message = 'Nao consegui identificar a bandeira do cartao. Verifique o numero informado.';
                        setCheckoutError(message);
                        toast.error(message);
                        return;
                    }

                    setCheckoutLoading(true);
                    setCheckoutError('');

                    void createBillingSubscriptionCheckout({
                        planCode: selectedPlan.code,
                        payerEmail,
                        cardTokenId,
                        paymentMethodId,
                        ...(formData.issuerId ? { issuerId: formData.issuerId } : {}),
                        ...(formData.identificationType ? { identificationType: formData.identificationType } : {}),
                        ...(formData.identificationNumber ? { identificationNumber: formData.identificationNumber } : {}),
                    })
                        .then((nextStatus) => {
                            setBillingStatus(nextStatus);
                            const nextLabel = nextStatus.subscription.status === 'authorized'
                                ? 'Plano ativado com sucesso.'
                                : 'Pagamento enviado. Assim que o Mercado Pago confirmar, o acesso premium sera liberado.';
                            toast.success(nextLabel);
                        })
                        .catch((error: unknown) => {
                            const message = error instanceof Error ? error.message : 'Nao foi possivel concluir o pagamento.';
                            setCheckoutError(message);
                            toast.error(message);
                        })
                        .finally(() => {
                            setCheckoutLoading(false);
                        });
                }
            }
        });

        cardFormRef.current = controller;

        return () => {
            disposed = true;
            controller.unmount?.();
            controller.destroy?.();
            if (cardFormRef.current === controller) {
                cardFormRef.current = null;
            }
        };
    }, [sdkReady, selectedPlan?.code, selectedPlan?.priceCents]);

    async function handleCancelPlan() {
        if (!canCancel || cancelLoading) return;
        const confirmed = window.confirm('Cancelar a assinatura agora? O acesso premium segue o status devolvido pelo Mercado Pago.');
        if (!confirmed) return;

        setCancelLoading(true);
        try {
            const nextStatus = await cancelBillingSubscription();
            setBillingStatus(nextStatus);
            toast.success('Assinatura cancelada.');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Nao foi possivel cancelar a assinatura.';
            toast.error(message);
        } finally {
            setCancelLoading(false);
        }
    }

    if (loading && plans.length === 0 && !billingStatus) {
        return (
            <div className="animate-fade-in space-y-6 pb-20 lg:pb-0">
                <div className="h-44 rounded-3xl border border-white/10 bg-white/[0.03]" />
                <div className="grid gap-4 lg:grid-cols-3">
                    <div className="h-56 rounded-3xl border border-white/10 bg-white/[0.03]" />
                    <div className="h-56 rounded-3xl border border-white/10 bg-white/[0.03]" />
                    <div className="h-56 rounded-3xl border border-white/10 bg-white/[0.03]" />
                </div>
                <div className="h-[32rem] rounded-3xl border border-white/10 bg-white/[0.03]" />
            </div>
        );
    }

    return (
        <div className="animate-fade-in space-y-6 pb-20 lg:pb-0">
            <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_28%),radial-gradient(circle_at_90%_20%,rgba(245,158,11,0.16),transparent_22%),linear-gradient(140deg,rgba(2,6,23,0.98),rgba(15,23,42,0.9))] p-6 sm:p-8">
                <div className="absolute -left-16 top-8 h-44 w-44 rounded-full bg-emerald-400/10 blur-3xl" />
                <div className="absolute -right-12 bottom-0 h-56 w-56 rounded-full bg-amber-400/10 blur-3xl" />

                <div className="relative grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                    <div className="space-y-5">
                        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-200">
                            <Crown className="h-3.5 w-3.5" />
                            Upgrade premium
                        </div>

                        <div>
                            <h1 className="max-w-3xl text-3xl font-semibold leading-tight text-white sm:text-4xl">
                                Destrave a versao completa do SaldoPro e deixe a IA trabalhar de verdade por voce.
                            </h1>
                            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                                O plano premium libera IA sem limite diario no WhatsApp, metas com apoio inteligente, armazenamento de imagens, PDFs e ZIPs, historico do chat e os fluxos que mais economizam tempo no dia a dia.
                            </p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Status</p>
                                <p className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(billingStatus?.subscription.status ?? 'none')}`}>
                                    {formatBillingStatus(billingStatus?.subscription.status ?? 'none')}
                                </p>
                                <p className="mt-3 text-xs leading-6 text-slate-400">
                                    {hasPremium ? 'Seu acesso premium ja esta ativo.' : 'Sem plano, voce usa so o basico e fica sem os recursos premium.'}
                                </p>
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">WhatsApp gratis hoje</p>
                                <p className="mt-2 text-2xl font-semibold text-white">
                                    {billingStatus?.freeWhatsappQuota.remaining ?? 0}/{billingStatus?.freeWhatsappQuota.limit ?? 1}
                                </p>
                                <p className="mt-2 text-xs leading-6 text-slate-400">
                                    {billingStatus?.freeWhatsappQuota.enabled ? 'Sem plano, a IA no WhatsApp fica limitada.' : 'Com premium, o limite diario some.'}
                                </p>
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Renovacao</p>
                                <p className="mt-2 text-sm font-semibold text-white">
                                    {billingStatus?.subscription.nextBillingDate ? formatDate(billingStatus.subscription.nextBillingDate) : 'Assim que ativar o plano'}
                                </p>
                                <p className="mt-2 text-xs leading-6 text-slate-400">
                                    A cobranca e recorrente e voce pode trocar ou cancelar quando quiser.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-[1.7rem] border border-white/10 bg-white/[0.05] p-5 backdrop-blur-xl">
                        <div className="flex items-center gap-2 text-sm font-semibold text-white">
                            <ShieldCheck className="h-5 w-5 text-emerald-300" />
                            O que entra no premium
                        </div>
                        <div className="mt-5 space-y-3">
                            {FEATURE_SECTIONS.map((item) => {
                                const Icon = item.icon;
                                return (
                                    <div key={item.title} className="flex gap-3 rounded-2xl border border-white/8 bg-black/20 p-3">
                                        <div className="mt-0.5 rounded-2xl bg-white/6 p-2 text-emerald-200">
                                            <Icon className="h-4 w-4" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-semibold text-white">{item.title}</p>
                                            <p className="mt-1 text-xs leading-6 text-slate-400">{item.description}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
                {plans.map((plan) => {
                    const selected = selectedPlan?.code === plan.code;
                    const activeCurrent = billingStatus?.subscription.planCode === plan.code && billingStatus.subscription.status === 'authorized';
                    const monthlyEquivalent = plan.intervalCount > 1
                        ? `Equivale a R$ ${(plan.priceCents / 100 / plan.intervalCount).toFixed(2).replace('.', ',')}/mes`
                        : 'Comece no menor investimento';

                    return (
                        <button
                            key={plan.code}
                            type="button"
                            onClick={() => setSelectedPlanCode(plan.code)}
                            className={`group relative overflow-hidden rounded-[1.8rem] border p-5 text-left transition-all ${planCardTone(plan.code, selected)}`}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-sm font-semibold text-white">{plan.name}</p>
                                    <p className="mt-3 text-4xl font-semibold text-white">{plan.priceFormatted}</p>
                                    <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-400">
                                        {plan.intervalCount === 1 ? 'cobranca mensal' : plan.intervalCount === 12 ? 'cobranca anual' : `cobranca a cada ${plan.intervalCount} meses`}
                                    </p>
                                </div>
                                <div className="flex flex-col items-end gap-2">
                                    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${plan.code === 'quarterly' ? 'bg-emerald-500/15 text-emerald-200' : plan.code === 'yearly' ? 'bg-amber-500/15 text-amber-200' : 'bg-indigo-500/15 text-indigo-200'}`}>
                                        <Star className="h-3 w-3" />
                                        {PLAN_BADGES[plan.code]}
                                    </span>
                                    {activeCurrent && (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
                                            <BadgeCheck className="h-3 w-3" />
                                            Atual
                                        </span>
                                    )}
                                </div>
                            </div>

                            <p className="mt-4 text-sm leading-6 text-slate-300">{plan.description}</p>

                            <div className="mt-5 rounded-2xl border border-white/8 bg-black/20 p-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Motivo para assinar</p>
                                <p className="mt-2 text-sm font-medium text-white">{monthlyEquivalent}</p>
                                <p className="mt-2 text-xs leading-6 text-slate-400">
                                    Libera os recursos que fazem a plataforma render mais e te poupam o trabalho manual.
                                </p>
                            </div>

                            <div className="mt-5 flex items-center justify-between text-xs text-slate-400">
                                <span>Selecione para pagar agora</span>
                                <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${selected ? 'border-white/20 bg-white/10 text-white' : 'border-white/10 text-slate-500'}`}>
                                    <Check className="h-3.5 w-3.5" />
                                </span>
                            </div>
                        </button>
                    );
                })}
            </section>

            <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                <div className="space-y-6">
                    <div className="rounded-[1.8rem] border border-white/10 bg-[linear-gradient(145deg,rgba(15,23,42,0.98),rgba(15,23,42,0.78))] p-6">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Resumo da assinatura</p>
                                <h2 className="mt-2 text-2xl font-semibold text-white">Seu acesso fica muito mais forte com um plano ativo</h2>
                            </div>
                            <div className={`rounded-2xl border px-4 py-3 text-sm ${statusTone(billingStatus?.subscription.status ?? 'none')}`}>
                                <p className="font-semibold">{formatBillingStatus(billingStatus?.subscription.status ?? 'none')}</p>
                                <p className="mt-1 text-xs opacity-80">{currentPlan ? currentPlan.name : 'Sem plano ativo'}</p>
                            </div>
                        </div>

                        <div className="mt-6 grid gap-4 sm:grid-cols-2">
                            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Plano selecionado</p>
                                <p className="mt-2 text-lg font-semibold text-white">{selectedPlan?.name ?? 'Escolha um plano'}</p>
                                <p className="mt-1 text-sm text-emerald-200">{selectedPlan?.priceFormatted ?? '—'}</p>
                                <p className="mt-3 text-xs leading-6 text-slate-400">
                                    Checkout no proprio painel, sem redirecionar para outra pagina.
                                </p>
                            </div>

                            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Liberado na hora certa</p>
                                <div className="mt-3 grid grid-cols-2 gap-2">
                                    {POWER_FEATURES.map((item) => {
                                        const Icon = item.icon;
                                        return (
                                            <div key={item.label} className="flex items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2 text-xs text-slate-200">
                                                <Icon className="h-3.5 w-3.5 text-emerald-300" />
                                                <span>{item.label}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <div className="mt-5 grid gap-4 md:grid-cols-2">
                            <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                                <p className="text-sm font-semibold text-white">Sem plano voce ainda usa o basico</p>
                                <p className="mt-2 text-sm leading-7 text-slate-400">
                                    Configuracoes, categorias, transacoes, lembretes, recorrencias e perfil financeiro continuam liberados.
                                </p>
                            </div>
                            <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                                <p className="text-sm font-semibold text-white">Com premium voce para de perder tempo</p>
                                <p className="mt-2 text-sm leading-7 text-slate-400">
                                    A IA, os arquivos e as metas passam a funcionar juntos, sem travas e sem precisar voltar para processos manuais.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="rounded-[1.8rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.95),rgba(2,6,23,0.98))] p-6">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Pagamento seguro</p>
                            <h2 className="mt-2 text-2xl font-semibold text-white">Concluir checkout</h2>
                        </div>
                        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-emerald-200">
                            <ShieldCheck className="h-5 w-5" />
                        </div>
                    </div>

                    <p className="mt-3 text-sm leading-7 text-slate-400">
                        O cartao e tokenizado pelo Mercado Pago e o acesso premium segue a confirmacao oficial do pagamento.
                    </p>

                    <div className="mt-5 rounded-2xl border border-white/8 bg-white/[0.035] p-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-sm font-semibold text-white">{selectedPlan?.name ?? 'Escolha um plano'}</p>
                                <p className="mt-1 text-xs text-slate-400">{selectedPlan?.description ?? 'Selecione um plano para carregar o checkout.'}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-xl font-semibold text-white">{selectedPlan?.priceFormatted ?? '—'}</p>
                                <p className="text-xs uppercase tracking-[0.16em] text-emerald-200">Recorrente</p>
                            </div>
                        </div>
                    </div>

                    <form id="plans-checkout-form" className="mt-6 space-y-4">
                        <div className="space-y-2">
                            <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400" htmlFor="plans-card-number">Numero do cartao</label>
                            <div id="plans-card-number" className="min-h-12 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3" />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400" htmlFor="plans-card-expiration">Validade</label>
                                <div id="plans-card-expiration" className="min-h-12 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400" htmlFor="plans-card-cvc">CVV</label>
                                <div id="plans-card-cvc" className="min-h-12 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400" htmlFor="plans-cardholder-name">Nome do titular</label>
                            <input id="plans-cardholder-name" type="text" className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white outline-none transition focus:border-emerald-400/30" placeholder="Como esta no cartao" autoComplete="cc-name" />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400" htmlFor="plans-cardholder-email">E-mail do pagador</label>
                                <input id="plans-cardholder-email" type="email" defaultValue={user?.email ?? ''} className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white outline-none transition focus:border-emerald-400/30" placeholder="voce@email.com" autoComplete="email" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400" htmlFor="plans-issuer">Banco emissor</label>
                                <select id="plans-issuer" className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white outline-none transition focus:border-emerald-400/30" defaultValue="">
                                    <option value="" className="bg-slate-950 text-slate-300">Selecione</option>
                                </select>
                            </div>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400" htmlFor="plans-identification-type">Tipo de documento</label>
                                <select id="plans-identification-type" className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white outline-none transition focus:border-emerald-400/30" defaultValue="">
                                    <option value="" className="bg-slate-950 text-slate-300">Selecione</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400" htmlFor="plans-identification-number">Numero do documento</label>
                                <input id="plans-identification-number" type="text" className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white outline-none transition focus:border-emerald-400/30" placeholder="CPF ou CNPJ" autoComplete="off" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400" htmlFor="plans-installments">Opcao do emissor</label>
                            <select id="plans-installments" className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white outline-none transition focus:border-emerald-400/30" defaultValue="">
                                <option value="" className="bg-slate-950 text-slate-300">O Mercado Pago preenche automaticamente</option>
                            </select>
                        </div>

                        {sdkError && <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{sdkError}</div>}
                        {checkoutError && <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{checkoutError}</div>}

                        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                            <div className="flex items-center gap-2 text-sm font-semibold text-white">
                                <LockKeyhole className="h-4 w-4 text-emerald-300" />
                                O que libera imediatamente com um plano ativo
                            </div>
                            <ul className="mt-3 space-y-2 text-sm text-slate-300">
                                <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 text-emerald-300" /> IA no painel e no WhatsApp com muito menos atrito</li>
                                <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 text-emerald-300" /> Metas, arquivos, comprovantes e resgates de documentos</li>
                                <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 text-emerald-300" /> Fluxo premium completo para centralizar tudo em um lugar</li>
                            </ul>
                        </div>

                        <div className="space-y-3 pt-2">
                            <Button
                                type="submit"
                                size="lg"
                                isLoading={checkoutLoading || sdkLoading}
                                disabled={!selectedPlan || !sdkReady || Boolean(sdkError)}
                                className="h-14 w-full rounded-2xl bg-[linear-gradient(135deg,#10b981,#0f766e)] text-base font-semibold text-white shadow-[0_18px_40px_rgba(16,185,129,0.24)] hover:brightness-105"
                            >
                                <CreditCard className="mr-2 h-5 w-5" />
                                {selectedPlan
                                    ? checkoutButtonLabel(selectedPlan.code, billingStatus?.subscription.status ?? 'none', billingStatus?.subscription.planCode ?? null)
                                    : 'Selecione um plano'}
                            </Button>

                            <div className="flex flex-col gap-3 sm:flex-row">
                                <Button variant="secondary" size="lg" onClick={() => void loadBillingData()} disabled={loading || checkoutLoading || cancelLoading} className="h-12 flex-1 rounded-2xl border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]">
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    Atualizar status
                                </Button>

                                {canCancel && (
                                    <Button variant="ghost" size="lg" onClick={() => void handleCancelPlan()} isLoading={cancelLoading} disabled={checkoutLoading} className="h-12 flex-1 rounded-2xl border border-rose-400/20 bg-rose-500/10 text-rose-200 hover:bg-rose-500/15">
                                        Cancelar assinatura
                                    </Button>
                                )}
                            </div>
                        </div>
                    </form>

                    <p className="mt-4 text-xs leading-6 text-slate-500">
                        {displayName ? `${displayName},` : 'Voce'} ainda pode usar o painel basico sem plano, mas o premium libera a parte mais poderosa e util do SaldoPro.
                    </p>
                </div>
            </section>
        </div>
    );
}
