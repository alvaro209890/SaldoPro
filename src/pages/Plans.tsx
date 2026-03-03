import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CreditCard,
  Crown,
  LockKeyhole,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  Star,
  X,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { MERCADO_PAGO_PUBLIC_KEY } from '@/config/backend';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import {
  BASIC_PLAN_FEATURES,
  PREMIUM_BENEFITS,
  PREMIUM_PLAN_FEATURES,
  PREMIUM_UNLOCK_ITEMS,
  WHATSAPP_FEATURES,
} from '@/components/plans/constants';
import {
  formatBillingStatus,
  formatDate,
  getCheckoutButtonLabel,
  getPlanMonthlyEquivalent,
  statusTone,
} from '@/components/plans/presentation';
import type { CheckoutStage } from '@/components/plans/types';
import {
  cancelBillingSubscription,
  createBillingSubscriptionCheckout,
  getBillingPlans,
  getBillingStatus,
  type BillingPlan,
  type BillingPlanCode,
  type BillingStatusResponse,
} from '@/services/billing';

/* ──── Mercado Pago SDK types ──── */
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
    MercadoPago?: new (
      publicKey: string,
      options?: { locale?: string }
    ) => MercadoPagoInstance;
  }
}

/* ──── helpers ──── */
const inputCls =
  'h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/40';
const selectCls = inputCls;
const labelCls = 'block text-xs font-medium text-slate-400 mb-1.5';

/* ════════════════════════════════════════ */
/*                PLANS PAGE               */
/* ════════════════════════════════════════ */
export function Plans() {
  const { user, displayName } = useAuth();

  /* ── state ── */
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [billingStatus, setBillingStatus] = useState<BillingStatusResponse | null>(null);
  const [selectedPlanCode, setSelectedPlanCode] = useState<BillingPlanCode>('quarterly');
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [sdkLoading, setSdkLoading] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState('');
  const [checkoutError, setCheckoutError] = useState('');
  const [checkoutStage, setCheckoutStage] = useState<CheckoutStage>('select');

  const cardFormRef = useRef<MercadoPagoCardFormController | null>(null);
  const checkoutLoadingRef = useRef(false);
  const checkoutRef = useRef<HTMLDivElement | null>(null);

  checkoutLoadingRef.current = checkoutLoading;

  /* ── derived ── */
  const selectedPlan = plans.find((p) => p.code === selectedPlanCode) ?? plans[0] ?? null;
  const currentPlan = plans.find((p) => p.code === billingStatus?.subscription.planCode) ?? null;
  const hasPlans = plans.length > 0;
  const subscriptionStatus = billingStatus?.subscription.status ?? 'none';
  const hasPremium = Boolean(billingStatus?.features.webAiChat);
  const canCancel = Boolean(
    billingStatus &&
    billingStatus.subscription.status !== 'none' &&
    billingStatus.subscription.status !== 'cancelled' &&
    billingStatus.subscription.status !== 'rejected'
  );
  const statusLabel = formatBillingStatus(subscriptionStatus);
  const statusClassName = statusTone(subscriptionStatus);
  const nextBillingDateLabel = billingStatus?.subscription.nextBillingDate
    ? formatDate(billingStatus.subscription.nextBillingDate)
    : '—';
  const showCheckout = hasPlans && checkoutStage === 'checkout';

  /* ── actions ── */
  function destroyCardForm() {
    cardFormRef.current?.unmount?.();
    cardFormRef.current?.destroy?.();
    cardFormRef.current = null;
  }

  async function loadBillingData() {
    setLoading(true);
    setPageError('');
    try {
      const [nextPlans, nextStatus] = await Promise.all([getBillingPlans(), getBillingStatus()]);
      setPlans(nextPlans);
      setBillingStatus(nextStatus);
      const preferredCode =
        nextStatus.subscription.planCode ??
        (nextPlans.some((p) => p.code === selectedPlanCode) ? selectedPlanCode : 'quarterly');
      if (nextPlans.some((p) => p.code === preferredCode)) {
        setSelectedPlanCode(preferredCode as BillingPlanCode);
      } else if (nextPlans[0]) {
        setSelectedPlanCode(nextPlans[0].code);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Nao foi possivel carregar os planos.';
      setPageError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  function handleSelectPlan(code: BillingPlanCode) {
    setSelectedPlanCode(code);
    setCheckoutError('');
  }

  function handleGoToCheckout() {
    if (!selectedPlan) return;
    setCheckoutStage('checkout');
    setTimeout(() => checkoutRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  function handleBackToPlans() {
    setCheckoutStage('select');
  }

  async function handleCancelPlan() {
    if (!canCancel || cancelLoading) return;
    if (!window.confirm('Tem certeza que deseja cancelar sua assinatura?')) return;
    setCancelLoading(true);
    try {
      const nextStatus = await cancelBillingSubscription();
      setBillingStatus(nextStatus);
      toast.success('Assinatura cancelada.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao cancelar.');
    } finally {
      setCancelLoading(false);
    }
  }

  /* ── effects ── */
  useEffect(() => { void loadBillingData(); }, []);

  // SDK loader
  useEffect(() => {
    if (!MERCADO_PAGO_PUBLIC_KEY) {
      setSdkError('Configure VITE_MERCADO_PAGO_PUBLIC_KEY.');
      setSdkReady(false);
      setSdkLoading(false);
      return;
    }
    if (typeof window === 'undefined') return undefined;
    if (window.MercadoPago) { setSdkReady(true); setSdkLoading(false); setSdkError(''); return undefined; }

    let cancelled = false;
    setSdkLoading(true);
    const existing = document.getElementById('mercado-pago-sdk-v2') as HTMLScriptElement | null;
    const onLoad = () => { if (!cancelled) { setSdkReady(true); setSdkLoading(false); setSdkError(''); } };
    const onError = () => { if (!cancelled) { setSdkReady(false); setSdkLoading(false); setSdkError('Nao foi possivel carregar o checkout.'); } };

    if (existing) {
      existing.addEventListener('load', onLoad);
      existing.addEventListener('error', onError);
      return () => { cancelled = true; existing.removeEventListener('load', onLoad); existing.removeEventListener('error', onError); };
    }
    const script = document.createElement('script');
    script.id = 'mercado-pago-sdk-v2';
    script.src = 'https://sdk.mercadopago.com/js/v2';
    script.async = true;
    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
    document.body.appendChild(script);
    return () => { cancelled = true; script.removeEventListener('load', onLoad); script.removeEventListener('error', onError); };
  }, []);

  // Card form mount
  useEffect(() => {
    if (!selectedPlan || !sdkReady || !window.MercadoPago || !MERCADO_PAGO_PUBLIC_KEY || !showCheckout) {
      destroyCardForm();
      return undefined;
    }
    const formElement = document.getElementById('plans-checkout-form');
    if (!formElement) return undefined;

    setCheckoutError('');
    setSdkError('');
    destroyCardForm();

    let disposed = false;
    const mp = new window.MercadoPago(MERCADO_PAGO_PUBLIC_KEY, { locale: 'pt-BR' });
    const controller = mp.cardForm({
      amount: (selectedPlan.priceCents / 100).toFixed(2),
      iframe: true,
      form: {
        id: 'plans-checkout-form',
        cardNumber: { id: 'plans-card-number', placeholder: 'Numero do cartao' },
        expirationDate: { id: 'plans-card-expiration', placeholder: 'MM/AA' },
        securityCode: { id: 'plans-card-cvc', placeholder: 'CVV' },
        cardholderName: { id: 'plans-cardholder-name', placeholder: 'Nome como esta no cartao' },
        cardholderEmail: { id: 'plans-cardholder-email', placeholder: 'voce@email.com' },
        issuer: { id: 'plans-issuer', placeholder: 'Banco emissor' },
        installments: { id: 'plans-installments', placeholder: 'Opcao do emissor' },
        identificationType: { id: 'plans-identification-type', placeholder: 'Documento' },
        identificationNumber: { id: 'plans-identification-number', placeholder: 'Numero do documento' },
      },
      callbacks: {
        onFormMounted: (error?: unknown) => {
          if (disposed) return;
          if (error) setSdkError('Nao consegui inicializar os campos do Mercado Pago.');
        },
        onFetching: () => () => undefined,
        onSubmit: (event: Event) => {
          event.preventDefault();
          if (checkoutLoadingRef.current || !selectedPlan) return;
          const fd = controller.getCardFormData();
          const payerEmail = (fd.cardholderEmail ?? '').trim();
          const cardTokenId = (fd.token ?? '').trim();
          const paymentMethodId = (fd.paymentMethodId ?? '').trim();

          if (!payerEmail || !payerEmail.includes('@')) { setCheckoutError('Informe um e-mail valido.'); toast.error('E-mail invalido.'); return; }
          if (!cardTokenId) { setCheckoutError('Nao foi possivel validar o cartao.'); toast.error('Revise os dados do cartao.'); return; }
          if (!paymentMethodId) { setCheckoutError('Bandeira nao identificada.'); toast.error('Verifique o numero do cartao.'); return; }

          setCheckoutLoading(true);
          setCheckoutError('');
          void createBillingSubscriptionCheckout({
            planCode: selectedPlan.code,
            payerEmail,
            cardTokenId,
            paymentMethodId,
            ...(fd.issuerId ? { issuerId: fd.issuerId } : {}),
            ...(fd.identificationType ? { identificationType: fd.identificationType } : {}),
            ...(fd.identificationNumber ? { identificationNumber: fd.identificationNumber } : {}),
          })
            .then((nextStatus) => {
              setBillingStatus(nextStatus);
              toast.success(nextStatus.subscription.status === 'authorized' ? 'Plano ativado!' : 'Pagamento enviado. Aguardando confirmacao.');
            })
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : 'Erro no pagamento.';
              setCheckoutError(msg);
              toast.error(msg);
            })
            .finally(() => setCheckoutLoading(false));
        },
      },
    });
    cardFormRef.current = controller;
    return () => { disposed = true; controller.unmount?.(); controller.destroy?.(); if (cardFormRef.current === controller) cardFormRef.current = null; };
  }, [showCheckout, sdkReady, selectedPlan?.code, selectedPlan?.priceCents]);

  /* ──── Loading skeleton ──── */
  if (loading && plans.length === 0 && !billingStatus) {
    return (
      <div className="animate-fade-in space-y-4 pb-24">
        <div className="h-40 rounded-2xl border border-white/8 bg-white/[0.02]" />
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="h-52 rounded-2xl border border-white/8 bg-white/[0.02]" />
          <div className="h-52 rounded-2xl border border-white/8 bg-white/[0.02]" />
          <div className="h-52 rounded-2xl border border-white/8 bg-white/[0.02]" />
        </div>
      </div>
    );
  }

  /* ════════════════════════════════════════ */
  /*                 RENDER                  */
  /* ════════════════════════════════════════ */
  return (
    <div className="animate-fade-in space-y-5 pb-24">
      {/* ── Error banner ── */}
      {pageError && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-rose-300 shrink-0" />
          <p className="flex-1 text-sm text-rose-200">{pageError}</p>
          <button onClick={() => void loadBillingData()} className="text-xs font-semibold text-rose-200 hover:text-white">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ═══════════════════════════════════ */}
      {/* ── STATUS HEADER ── */}
      {/* ═══════════════════════════════════ */}
      <section className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-950/90 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-500/10">
              <Crown className="h-5 w-5 text-emerald-300" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white sm:text-xl">Planos Premium</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${statusClassName}`}>
                  {statusLabel}
                </span>
                {currentPlan && <span className="text-xs text-slate-400">{currentPlan.name}</span>}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-slate-400">
            <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
              <span className="text-slate-500">Renovação: </span>
              <span className="text-white font-medium">{nextBillingDateLabel}</span>
            </div>
          </div>
        </div>

        {/* WhatsApp Quota Bar */}
        <div className="mt-4 rounded-xl border border-emerald-400/15 bg-emerald-500/[0.06] p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-emerald-300" />
              <span className="text-sm font-semibold text-white">WhatsApp IA</span>
            </div>
            <span className="text-sm font-bold text-emerald-300">
              {billingStatus?.freeWhatsappQuota.remaining ?? 0} / {billingStatus?.freeWhatsappQuota.limit ?? 1} msgs restantes
            </span>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${hasPremium ? 'bg-emerald-400' : (billingStatus?.freeWhatsappQuota.remaining ?? 0) <= 1 ? 'bg-rose-400' : 'bg-amber-400'}`}
              style={{ width: `${Math.min(100, ((billingStatus?.freeWhatsappQuota.remaining ?? 0) / (billingStatus?.freeWhatsappQuota.limit ?? 1)) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {hasPremium
              ? '✅ Premium ativo — uso ilimitado no WhatsApp.'
              : (billingStatus?.freeWhatsappQuota.remaining ?? 0) === 0
                ? '⚠️ Limite atingido! Ative o premium para continuar usando a IA no WhatsApp.'
                : 'Sem premium, você tem poucas mensagens por dia. Com premium, o limite desaparece.'}
          </p>
        </div>

        {!hasPremium && (
          <p className="mt-3 text-sm text-slate-400 leading-relaxed max-w-2xl">
            Com o premium, a IA no WhatsApp fica ilimitada. Registre gastos, consulte saldo, peça documentos e acompanhe metas — tudo por mensagem.
          </p>
        )}
      </section>

      {/* ═══════════════════════════════════ */}
      {/* ── WHATSAPP HIGHLIGHT ── */}
      {/* ═══════════════════════════════════ */}
      {!showCheckout && !hasPremium && (
        <section className="rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-950/40 to-slate-950/90 p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 border border-emerald-400/25">
              <MessageCircle className="h-5 w-5 text-emerald-300" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">WhatsApp + IA Financeira</h2>
              <p className="text-xs text-emerald-200/70">O recurso mais usado pelos assinantes premium</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {WHATSAPP_FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="rounded-xl border border-emerald-400/10 bg-white/[0.03] p-3.5 hover:bg-white/[0.05] transition">
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-400/15">
                      <Icon className="h-4 w-4 text-emerald-300" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{f.title}</p>
                      <p className="mt-0.5 text-xs text-slate-400 leading-relaxed">{f.description}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ═══════════════════════════════════ */}
      {/* ── BENEFITS GRID ── */}
      {/* ═══════════════════════════════════ */}
      {!showCheckout && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PREMIUM_BENEFITS.map((b) => {
            const Icon = b.icon;
            return (
              <div key={b.title} className="rounded-xl border border-white/8 bg-white/[0.03] p-4 hover:bg-white/[0.05] transition">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-400/15 bg-emerald-500/10">
                  <Icon className="h-4 w-4 text-emerald-300" />
                </div>
                <p className="mt-3 text-sm font-semibold text-white">{b.title}</p>
                <p className="mt-1 text-xs text-slate-400 leading-relaxed">{b.description}</p>
              </div>
            );
          })}
        </section>
      )}

      {/* ═══════════════════════════════════ */}
      {/* ── PLAN CARDS ── */}
      {/* ═══════════════════════════════════ */}
      {!showCheckout && (
        <section>
          {!hasPlans ? (
            <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
              Planos indisponíveis no momento. Tente novamente.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-white">Escolha seu plano</h2>
                <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
                  Trimestral em destaque
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {plans.map((plan) => {
                  const isSelected = selectedPlan?.code === plan.code;
                  const isCurrent = billingStatus?.subscription.planCode === plan.code && billingStatus.subscription.status === 'authorized';
                  const monthlyEq = getPlanMonthlyEquivalent(plan);

                  const borderCls = isSelected
                    ? plan.code === 'quarterly'
                      ? 'border-emerald-400/40 bg-emerald-500/[0.08] shadow-lg shadow-emerald-500/10'
                      : plan.code === 'yearly'
                        ? 'border-amber-400/35 bg-amber-500/[0.06] shadow-lg shadow-amber-500/10'
                        : 'border-sky-400/35 bg-sky-500/[0.06] shadow-lg shadow-sky-500/10'
                    : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]';

                  const badgeCls = plan.code === 'quarterly'
                    ? 'bg-emerald-500/15 text-emerald-200'
                    : plan.code === 'yearly'
                      ? 'bg-amber-500/15 text-amber-200'
                      : 'bg-sky-500/15 text-sky-200';

                  return (
                    <button
                      key={plan.code}
                      type="button"
                      onClick={() => handleSelectPlan(plan.code)}
                      className={`relative rounded-xl border p-4 text-left transition-all ${borderCls}`}
                    >
                      {plan.code === 'quarterly' && (
                        <div className="absolute -right-2 top-3 rounded-l-lg bg-emerald-500 px-2 py-0.5 text-[9px] font-bold uppercase text-black">
                          Popular
                        </div>
                      )}

                      <div className="flex items-center gap-2 mb-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeCls}`}>
                          <Star className="h-3 w-3" />
                          {plan.code === 'quarterly' ? 'Mais escolhido' : plan.code === 'yearly' ? 'Maior economia' : 'Entrada rápida'}
                        </span>
                        {isCurrent && (
                          <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-white">
                            Atual
                          </span>
                        )}
                      </div>

                      <p className="text-sm font-semibold text-white">{plan.name}</p>
                      <p className="mt-1 text-2xl font-bold text-white">{plan.priceFormatted}</p>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {plan.intervalCount === 1 ? 'por mês' : plan.intervalCount === 12 ? 'por ano' : `a cada ${plan.intervalCount} meses`}
                      </p>

                      <p className="mt-3 text-xs text-slate-400 leading-relaxed">{monthlyEq}</p>

                      <div className={`mt-3 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${isSelected ? 'bg-white text-slate-950' : 'bg-white/[0.06] text-slate-300 border border-white/10'}`}>
                        <Check className="h-3.5 w-3.5" />
                        {isSelected ? 'Selecionado' : 'Selecionar'}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* CTA to checkout */}
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-slate-500">
                  Todos os planos dão acesso ao mesmo pacote premium. A diferença é a forma de pagamento.
                </p>
                <Button
                  size="lg"
                  onClick={handleGoToCheckout}
                  disabled={!selectedPlan}
                  className="h-11 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-6 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 hover:brightness-110 shrink-0"
                >
                  <CreditCard className="mr-2 h-4 w-4" />
                  Continuar com {selectedPlan?.name ?? 'o plano'}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </section>
      )}

      {/* ═══════════════════════════════════ */}
      {/* ── COMPARISON ── */}
      {/* ═══════════════════════════════════ */}
      {!showCheckout && (
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white mb-3">
              <X className="h-4 w-4 text-rose-300" />
              Sem plano
            </div>
            <ul className="space-y-2">
              {BASIC_PLAN_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-slate-400">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border border-white/8 bg-white/[0.04]">
                    <Check className="h-3 w-3 text-slate-500" />
                  </span>
                  {f}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-emerald-400/15 bg-emerald-500/5 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white mb-3">
              <Zap className="h-4 w-4 text-emerald-300" />
              Com premium
            </div>
            <ul className="space-y-2">
              {PREMIUM_PLAN_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-slate-200">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border border-emerald-400/15 bg-emerald-500/10">
                    <Check className="h-3 w-3 text-emerald-300" />
                  </span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ═══════════════════════════════════ */}
      {/* ── CHECKOUT ── */}
      {/* ═══════════════════════════════════ */}
      {showCheckout && (
        <section ref={checkoutRef} className="max-w-2xl mx-auto">
          <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/90 to-slate-950 p-5 sm:p-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 mb-5">
              <div>
                <button onClick={handleBackToPlans} className="text-xs text-slate-400 hover:text-white transition mb-2 flex items-center gap-1">
                  ← Voltar para planos
                </button>
                <h2 className="text-lg font-bold text-white">Finalizar pagamento</h2>
                <p className="text-sm text-slate-400 mt-1">Checkout protegido pelo Mercado Pago.</p>
              </div>
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-2.5">
                <ShieldCheck className="h-5 w-5 text-emerald-300" />
              </div>
            </div>

            {/* Plan summary */}
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4 mb-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400">Plano selecionado</p>
                  <p className="text-sm font-semibold text-white mt-1">{selectedPlan?.name ?? '—'}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-white">{selectedPlan?.priceFormatted ?? '—'}</p>
                  <p className="text-xs text-emerald-300">{selectedPlan ? getPlanMonthlyEquivalent(selectedPlan) : ''}</p>
                </div>
              </div>
              {/* What unlocks */}
              <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {PREMIUM_UNLOCK_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.label} className="flex items-center gap-1.5 rounded-lg bg-white/[0.03] px-2 py-1.5 text-[11px] text-slate-300">
                      <Icon className="h-3 w-3 text-emerald-300" />
                      {item.label}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Status row */}
            <div className="flex items-center gap-2 mb-5">
              <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${statusClassName}`}>
                {statusLabel}
              </span>
              {currentPlan && <span className="text-xs text-slate-400">Plano atual: {currentPlan.name}</span>}
            </div>

            {/* Form */}
            {!selectedPlan ? (
              <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                Escolha um plano para abrir o checkout.
              </div>
            ) : (
              <form id="plans-checkout-form" className="space-y-3.5">
                <div>
                  <label className={labelCls} htmlFor="plans-card-number">Número do cartão</label>
                  <div id="plans-card-number" className="min-h-11 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5" />
                </div>

                <div className="grid gap-3 grid-cols-2">
                  <div>
                    <label className={labelCls} htmlFor="plans-card-expiration">Validade</label>
                    <div id="plans-card-expiration" className="min-h-11 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5" />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="plans-card-cvc">CVV</label>
                    <div id="plans-card-cvc" className="min-h-11 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5" />
                  </div>
                </div>

                <div>
                  <label className={labelCls} htmlFor="plans-cardholder-name">Nome do titular</label>
                  <input id="plans-cardholder-name" type="text" className={inputCls} placeholder="Como está no cartão" autoComplete="cc-name" />
                </div>

                <div className="grid gap-3 grid-cols-2">
                  <div>
                    <label className={labelCls} htmlFor="plans-cardholder-email">E-mail</label>
                    <input id="plans-cardholder-email" type="email" defaultValue={user?.email ?? ''} className={inputCls} placeholder="voce@email.com" autoComplete="email" />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="plans-issuer">Banco emissor</label>
                    <select id="plans-issuer" className={selectCls} defaultValue="">
                      <option value="" className="bg-slate-950">Selecione</option>
                    </select>
                  </div>
                </div>

                <div className="grid gap-3 grid-cols-2">
                  <div>
                    <label className={labelCls} htmlFor="plans-identification-type">Tipo de documento</label>
                    <select id="plans-identification-type" className={selectCls} defaultValue="">
                      <option value="" className="bg-slate-950">Selecione</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="plans-identification-number">Nº do documento</label>
                    <input id="plans-identification-number" type="text" className={inputCls} placeholder="CPF ou CNPJ" autoComplete="off" />
                  </div>
                </div>

                <div>
                  <label className={labelCls} htmlFor="plans-installments">Parcelamento</label>
                  <select id="plans-installments" className={selectCls} defaultValue="">
                    <option value="" className="bg-slate-950">Preenchido automaticamente</option>
                  </select>
                </div>

                {/* Errors */}
                {sdkError && (
                  <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{sdkError}</div>
                )}
                {checkoutError && (
                  <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{checkoutError}</div>
                )}

                {/* Info */}
                <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <LockKeyhole className="h-3.5 w-3.5 text-emerald-300" />
                    Pagamento seguro
                  </div>
                  <ul className="mt-2 space-y-1 text-[11px] text-slate-400 leading-relaxed">
                    <li>• Cartão protegido pelo checkout do Mercado Pago.</li>
                    <li>• Acesso liberado após confirmação do pagamento.</li>
                    <li>• Cancele ou troque de plano quando quiser.</li>
                  </ul>
                </div>

                {/* Submit */}
                <Button
                  type="submit"
                  size="lg"
                  isLoading={checkoutLoading || sdkLoading}
                  disabled={!selectedPlan || !sdkReady || Boolean(sdkError)}
                  className="h-12 w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 hover:brightness-110"
                >
                  <CreditCard className="mr-2 h-5 w-5" />
                  {selectedPlan
                    ? getCheckoutButtonLabel(selectedPlan.code, subscriptionStatus, billingStatus?.subscription.planCode ?? null)
                    : 'Selecione um plano'}
                </Button>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => void loadBillingData()}
                    disabled={checkoutLoading || cancelLoading}
                    className="flex-1 h-10 rounded-xl border border-white/10 bg-white/[0.04] text-xs font-semibold text-slate-300 hover:bg-white/[0.08] transition flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Atualizar status
                  </button>

                  {canCancel && (
                    <button
                      type="button"
                      onClick={() => void handleCancelPlan()}
                      disabled={checkoutLoading}
                      className="flex-1 h-10 rounded-xl border border-rose-400/20 bg-rose-500/10 text-xs font-semibold text-rose-200 hover:bg-rose-500/15 transition flex items-center justify-center disabled:opacity-50"
                    >
                      {cancelLoading ? 'Cancelando...' : 'Cancelar assinatura'}
                    </button>
                  )}
                </div>
              </form>
            )}

            <p className="mt-4 text-[11px] text-slate-500 leading-relaxed">
              {displayName ? `${displayName}, ` : ''}
              O painel básico continua disponível sem plano. O premium libera todo o potencial do SaldoPro.
            </p>

            {billingStatus?.subscription.status === 'pending' && (
              <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                Pagamento enviado. Assim que o Mercado Pago confirmar, o premium será ativado automaticamente.
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
