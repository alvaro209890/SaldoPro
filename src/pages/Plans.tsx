import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CreditCard,
  Crown,
  LockKeyhole,
  MessageCircle,
  Mic,
  RefreshCw,
  ShieldCheck,
  Star,
  Target,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { MERCADO_PAGO_PUBLIC_KEY } from '@/config/backend';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
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
  token?: string; paymentMethodId?: string; issuerId?: string;
  identificationType?: string; identificationNumber?: string; cardholderEmail?: string;
};
type MercadoPagoCardFormController = {
  getCardFormData: () => MercadoPagoCardFormData; destroy?: () => void; unmount?: () => void;
};
type MercadoPagoInstance = {
  cardForm: (config: {
    amount: string; iframe: boolean;
    form: { id: string; cardNumber: { id: string; placeholder?: string }; expirationDate: { id: string; placeholder?: string }; securityCode: { id: string; placeholder?: string }; cardholderName: { id: string; placeholder?: string }; cardholderEmail: { id: string; placeholder?: string }; issuer: { id: string; placeholder?: string }; installments: { id: string; placeholder?: string }; identificationType: { id: string; placeholder?: string }; identificationNumber: { id: string; placeholder?: string }; };
    callbacks: { onFormMounted?: (error?: unknown) => void; onSubmit: (event: Event) => void; onFetching?: (_resource: string) => (() => void) | void; };
  }) => MercadoPagoCardFormController;
};
declare global { interface Window { MercadoPago?: new (publicKey: string, options?: { locale?: string }) => MercadoPagoInstance; } }

/* ──── style tokens ──── */
const iframeCls = 'h-[42px] max-h-[42px] overflow-hidden rounded-lg border border-white/10 bg-white/[0.04] px-3';
const inputCls = 'h-[42px] w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/40';
const selectCls = inputCls;
const labelCls = 'block text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1';

/* ══════════════════════════════════ */
export function Plans() {
  const { user, displayName } = useAuth();
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
  const [stage, setStage] = useState<CheckoutStage>('select');
  const cardFormRef = useRef<MercadoPagoCardFormController | null>(null);
  const checkoutLoadingRef = useRef(false);
  const topRef = useRef<HTMLDivElement | null>(null);
  checkoutLoadingRef.current = checkoutLoading;

  const selectedPlan = plans.find(p => p.code === selectedPlanCode) ?? plans[0] ?? null;
  const currentPlan = plans.find(p => p.code === billingStatus?.subscription.planCode) ?? null;
  const hasPlans = plans.length > 0;
  const sub = billingStatus?.subscription;
  const subStatus = sub?.status ?? 'none';
  const hasPremium = Boolean(billingStatus?.features.webAiChat);
  const canCancel = Boolean(sub && sub.status !== 'none' && sub.status !== 'cancelled' && sub.status !== 'rejected');
  const statusLabel = formatBillingStatus(subStatus);
  const statusCls = statusTone(subStatus);
  const quota = billingStatus?.freeWhatsappQuota;
  const showCheckout = hasPlans && stage === 'checkout';

  function destroyCardForm() { cardFormRef.current?.unmount?.(); cardFormRef.current?.destroy?.(); cardFormRef.current = null; }

  async function load() {
    setLoading(true); setPageError('');
    try {
      const [p, s] = await Promise.all([getBillingPlans(), getBillingStatus()]);
      setPlans(p); setBillingStatus(s);
      const pref = s.subscription.planCode ?? (p.some(x => x.code === selectedPlanCode) ? selectedPlanCode : 'quarterly');
      if (p.some(x => x.code === pref)) setSelectedPlanCode(pref as BillingPlanCode);
      else if (p[0]) setSelectedPlanCode(p[0].code);
    } catch (e) { const m = e instanceof Error ? e.message : 'Erro ao carregar planos.'; setPageError(m); toast.error(m); }
    finally { setLoading(false); }
  }

  function selectPlan(code: BillingPlanCode) { setSelectedPlanCode(code); setCheckoutError(''); }
  function goCheckout() { if (!selectedPlan) return; setStage('checkout'); setTimeout(() => topRef.current?.scrollIntoView({ behavior: 'smooth' }), 50); }
  function goBack() { setStage('select'); }
  async function cancelPlan() {
    if (!canCancel || cancelLoading) return;
    if (!window.confirm('Deseja cancelar sua assinatura?')) return;
    setCancelLoading(true);
    try { setBillingStatus(await cancelBillingSubscription()); toast.success('Assinatura cancelada.'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Erro.'); }
    finally { setCancelLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  // SDK
  useEffect(() => {
    if (!MERCADO_PAGO_PUBLIC_KEY) { setSdkError('Configure VITE_MERCADO_PAGO_PUBLIC_KEY.'); return; }
    if (typeof window === 'undefined') return;
    if (window.MercadoPago) { setSdkReady(true); return; }
    let c = false; setSdkLoading(true);
    const el = document.getElementById('mercado-pago-sdk-v2') as HTMLScriptElement | null;
    const ok = () => { if (!c) { setSdkReady(true); setSdkLoading(false); } };
    const fail = () => { if (!c) { setSdkReady(false); setSdkLoading(false); setSdkError('Erro ao carregar checkout.'); } };
    if (el) { el.addEventListener('load', ok); el.addEventListener('error', fail); return () => { c = true; el.removeEventListener('load', ok); el.removeEventListener('error', fail); }; }
    const s = document.createElement('script'); s.id = 'mercado-pago-sdk-v2'; s.src = 'https://sdk.mercadopago.com/js/v2'; s.async = true;
    s.addEventListener('load', ok); s.addEventListener('error', fail); document.body.appendChild(s);
    return () => { c = true; s.removeEventListener('load', ok); s.removeEventListener('error', fail); };
  }, []);

  // Card form
  useEffect(() => {
    if (!selectedPlan || !sdkReady || !window.MercadoPago || !MERCADO_PAGO_PUBLIC_KEY || !showCheckout) { destroyCardForm(); return; }
    const f = document.getElementById('plans-checkout-form'); if (!f) return;
    setCheckoutError(''); setSdkError(''); destroyCardForm();
    let disposed = false;
    const mp = new window.MercadoPago(MERCADO_PAGO_PUBLIC_KEY, { locale: 'pt-BR' });
    const ctrl = mp.cardForm({
      amount: (selectedPlan.priceCents / 100).toFixed(2), iframe: true,
      form: {
        id: 'plans-checkout-form',
        cardNumber: { id: 'plans-card-number', placeholder: 'Numero do cartao' },
        expirationDate: { id: 'plans-card-expiration', placeholder: 'MM/AA' },
        securityCode: { id: 'plans-card-cvc', placeholder: 'CVV' },
        cardholderName: { id: 'plans-cardholder-name', placeholder: 'Nome impresso no cartao' },
        cardholderEmail: { id: 'plans-cardholder-email', placeholder: 'voce@email.com' },
        issuer: { id: 'plans-issuer', placeholder: 'Banco emissor' },
        installments: { id: 'plans-installments', placeholder: 'Parcelas' },
        identificationType: { id: 'plans-identification-type', placeholder: 'Tipo' },
        identificationNumber: { id: 'plans-identification-number', placeholder: 'CPF ou CNPJ' },
      },
      callbacks: {
        onFormMounted: (err?: unknown) => { if (!disposed && err) setSdkError('Erro ao montar campos do Mercado Pago.'); },
        onFetching: () => () => undefined,
        onSubmit: (event: Event) => {
          event.preventDefault();
          if (checkoutLoadingRef.current || !selectedPlan) return;
          const fd = ctrl.getCardFormData();
          const email = (fd.cardholderEmail ?? '').trim();
          const token = (fd.token ?? '').trim();
          const method = (fd.paymentMethodId ?? '').trim();
          if (!email || !email.includes('@')) { setCheckoutError('E-mail inválido.'); toast.error('E-mail inválido.'); return; }
          if (!token) { setCheckoutError('Cartão inválido.'); toast.error('Revise os dados.'); return; }
          if (!method) { setCheckoutError('Bandeira não identificada.'); toast.error('Verifique o número.'); return; }
          setCheckoutLoading(true); setCheckoutError('');
          void createBillingSubscriptionCheckout({
            planCode: selectedPlan.code, payerEmail: email, cardTokenId: token, paymentMethodId: method,
            ...(fd.issuerId ? { issuerId: fd.issuerId } : {}),
            ...(fd.identificationType ? { identificationType: fd.identificationType } : {}),
            ...(fd.identificationNumber ? { identificationNumber: fd.identificationNumber } : {}),
          }).then(ns => { setBillingStatus(ns); toast.success(ns.subscription.status === 'authorized' ? 'Plano ativado!' : 'Pagamento enviado.'); })
            .catch((e: unknown) => { const m = e instanceof Error ? e.message : 'Erro.'; setCheckoutError(m); toast.error(m); })
            .finally(() => setCheckoutLoading(false));
        },
      },
    });
    cardFormRef.current = ctrl;
    return () => { disposed = true; ctrl.unmount?.(); ctrl.destroy?.(); if (cardFormRef.current === ctrl) cardFormRef.current = null; };
  }, [showCheckout, sdkReady, selectedPlan?.code, selectedPlan?.priceCents]);

  /* ── skeleton ── */
  if (loading && !plans.length && !billingStatus) {
    return (
      <div className="animate-fade-in max-w-3xl mx-auto space-y-4 p-4">
        <div className="h-20 rounded-xl bg-white/[0.02] border border-white/5" />
        <div className="h-48 rounded-xl bg-white/[0.02] border border-white/5" />
        <div className="h-32 rounded-xl bg-white/[0.02] border border-white/5" />
      </div>
    );
  }

  /* ══════════════ RENDER ══════════════ */
  return (
    <div ref={topRef} className="animate-fade-in max-w-3xl mx-auto space-y-4 p-4 pb-24">

      {/* Error */}
      {pageError && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{pageError}</span>
          <button onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* ══ STATUS BAR ══ */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Crown className="h-5 w-5 text-emerald-400" />
            <div>
              <h1 className="text-base font-bold text-white">Planos Premium</h1>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusCls}`}>{statusLabel}</span>
                {currentPlan && <span className="text-[11px] text-slate-400">{currentPlan.name}</span>}
              </div>
            </div>
          </div>
          {sub?.nextBillingDate && (
            <div className="text-right hidden sm:block">
              <p className="text-[10px] text-slate-500 uppercase">Renovação</p>
              <p className="text-xs text-white font-medium">{formatDate(sub.nextBillingDate)}</p>
            </div>
          )}
        </div>

        {/* WhatsApp quota */}
        {quota && (
          <div className="mt-3 rounded-lg bg-emerald-500/[0.06] border border-emerald-400/15 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <MessageCircle className="h-3.5 w-3.5 text-emerald-300" />
                <span className="text-xs font-semibold text-white">WhatsApp IA</span>
              </div>
              <span className="text-xs font-bold text-emerald-300">{quota.remaining}/{quota.limit}</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className={`h-full rounded-full transition-all ${hasPremium ? 'bg-emerald-400' : quota.remaining === 0 ? 'bg-rose-400' : 'bg-amber-400'}`}
                style={{ width: `${Math.min(100, (quota.remaining / (quota.limit || 2)) * 100)}%` }} />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              {hasPremium ? 'Premium ativo — sem limite.' : quota.remaining === 0 ? 'Limite atingido! Ative o premium.' : 'Com premium, o limite desaparece.'}
            </p>
          </div>
        )}
      </div>

      {/* ══ STEP 1: PLAN SELECTION ══ */}
      {!showCheckout && (
        <>
          {/* WhatsApp features */}
          {!hasPremium && (
            <div className="rounded-xl border border-emerald-400/15 bg-gradient-to-br from-emerald-950/30 to-transparent p-4">
              <div className="flex items-center gap-2 mb-3">
                <MessageCircle className="h-4 w-4 text-emerald-300" />
                <span className="text-sm font-bold text-white">O que o Premium destrava</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { i: MessageCircle, t: 'WhatsApp sem limite' },
                  { i: Mic, t: 'Saldo por áudio' },
                  { i: Zap, t: 'Gastos por mensagem' },
                  { i: Target, t: 'Metas financeiras' },
                  { i: ShieldCheck, t: 'Arquivos e PDFs' },
                  { i: Star, t: 'IA no painel' },
                ].map(f => (
                  <div key={f.t} className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-2 text-[11px] text-slate-300">
                    <f.i className="h-3.5 w-3.5 text-emerald-300 shrink-0" />
                    {f.t}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Plan cards */}
          {hasPlans ? (
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-white">Escolha o plano</h2>
              <div className="space-y-2">
                {plans.map(plan => {
                  const sel = selectedPlan?.code === plan.code;
                  const cur = sub?.planCode === plan.code && sub.status === 'authorized';
                  const eq = getPlanMonthlyEquivalent(plan);
                  return (
                    <button key={plan.code} type="button" onClick={() => selectPlan(plan.code)}
                      className={`w-full rounded-xl border p-3.5 text-left transition-all flex items-center gap-3 ${sel
                        ? 'border-emerald-400/40 bg-emerald-500/[0.08] shadow-md shadow-emerald-500/10'
                        : 'border-white/10 bg-white/[0.03] hover:border-white/20'}`}>
                      {/* Radio */}
                      <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${sel ? 'border-emerald-400 bg-emerald-400' : 'border-white/20'}`}>
                        {sel && <Check className="h-3 w-3 text-black" />}
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-white">{plan.name}</span>
                          {plan.code === 'quarterly' && <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold uppercase text-black">Popular</span>}
                          {cur && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold text-white uppercase">Atual</span>}
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">{eq}</p>
                      </div>
                      {/* Price */}
                      <div className="text-right shrink-0">
                        <p className="text-lg font-bold text-white">{plan.priceFormatted}</p>
                        <p className="text-[10px] text-slate-400">
                          {plan.intervalCount === 1 ? '/mês' : plan.intervalCount === 12 ? '/ano' : `/${plan.intervalCount} meses`}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>

              <Button onClick={goCheckout} disabled={!selectedPlan} size="lg"
                className="w-full h-11 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-sm font-bold text-white shadow-lg shadow-emerald-500/15 hover:brightness-110">
                <CreditCard className="mr-2 h-4 w-4" />
                Assinar {selectedPlan?.name ?? ''}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">Planos indisponíveis no momento.</div>
          )}
        </>
      )}

      {/* ══ STEP 2: CHECKOUT ══ */}
      {showCheckout && (
        <div className="rounded-xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-950 p-4">
          <button onClick={goBack} className="text-xs text-slate-400 hover:text-white mb-3 flex items-center gap-1 transition">
            ← Voltar
          </button>

          {/* Selected plan summary */}
          <div className="flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.03] p-3 mb-4">
            <div>
              <p className="text-[10px] text-slate-500 uppercase">Plano</p>
              <p className="text-sm font-bold text-white">{selectedPlan?.name}</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-white">{selectedPlan?.priceFormatted}</p>
              <p className="text-[10px] text-emerald-300">{selectedPlan ? getPlanMonthlyEquivalent(selectedPlan) : ''}</p>
            </div>
          </div>

          {/* Checkout form */}
          {selectedPlan ? (
            <form id="plans-checkout-form" className="space-y-3">
              <div>
                <label className={labelCls} htmlFor="plans-card-number">Número do cartão</label>
                <div id="plans-card-number" className={iframeCls} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls} htmlFor="plans-card-expiration">Validade</label>
                  <div id="plans-card-expiration" className={iframeCls} />
                </div>
                <div>
                  <label className={labelCls} htmlFor="plans-card-cvc">CVV</label>
                  <div id="plans-card-cvc" className={iframeCls} />
                </div>
              </div>

              <div>
                <label className={labelCls} htmlFor="plans-cardholder-name">Nome no cartão</label>
                <input id="plans-cardholder-name" type="text" className={inputCls} placeholder="Nome impresso no cartão" autoComplete="cc-name" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className={labelCls} htmlFor="plans-cardholder-email">E-mail</label>
                  <input id="plans-cardholder-email" type="email" defaultValue={user?.email ?? ''} className={inputCls} placeholder="voce@email.com" autoComplete="email" />
                </div>
                <div>
                  <label className={labelCls} htmlFor="plans-issuer">Banco emissor</label>
                  <select id="plans-issuer" className={selectCls} defaultValue=""><option value="" className="bg-slate-950">Selecione</option></select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className={labelCls} htmlFor="plans-identification-type">Documento</label>
                  <select id="plans-identification-type" className={selectCls} defaultValue=""><option value="" className="bg-slate-950">Selecione</option></select>
                </div>
                <div>
                  <label className={labelCls} htmlFor="plans-identification-number">Nº do documento</label>
                  <input id="plans-identification-number" type="text" className={inputCls} placeholder="CPF ou CNPJ" autoComplete="off" />
                </div>
              </div>

              <div>
                <label className={labelCls} htmlFor="plans-installments">Parcelamento</label>
                <select id="plans-installments" className={selectCls} defaultValue=""><option value="" className="bg-slate-950">Automático</option></select>
              </div>

              {sdkError && <div className="rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{sdkError}</div>}
              {checkoutError && <div className="rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{checkoutError}</div>}

              {/* Security info */}
              <div className="flex items-start gap-2 rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2.5">
                <LockKeyhole className="h-3.5 w-3.5 text-emerald-300 mt-0.5 shrink-0" />
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Cartão protegido pelo Mercado Pago. Cancele ou troque de plano quando quiser.
                </p>
              </div>

              {/* Submit */}
              <Button type="submit" size="lg" isLoading={checkoutLoading || sdkLoading} disabled={!sdkReady || Boolean(sdkError)}
                className="w-full h-12 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-sm font-bold text-white shadow-lg shadow-emerald-500/15 hover:brightness-110">
                <CreditCard className="mr-2 h-4 w-4" />
                {getCheckoutButtonLabel(selectedPlan.code, subStatus, sub?.planCode ?? null)}
              </Button>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button type="button" onClick={() => void load()} disabled={checkoutLoading || cancelLoading}
                  className="h-9 rounded-lg border border-white/10 bg-white/[0.03] text-xs font-semibold text-slate-300 hover:bg-white/[0.06] transition flex items-center justify-center gap-1.5 disabled:opacity-50">
                  <RefreshCw className="h-3 w-3" /> Atualizar
                </button>
                {canCancel && (
                  <button type="button" onClick={() => void cancelPlan()} disabled={checkoutLoading}
                    className="h-9 rounded-lg border border-rose-400/20 bg-rose-500/10 text-xs font-semibold text-rose-200 hover:bg-rose-500/15 transition flex items-center justify-center disabled:opacity-50">
                    {cancelLoading ? 'Cancelando...' : 'Cancelar assinatura'}
                  </button>
                )}
              </div>

              {sub?.status === 'pending' && (
                <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  Pagamento enviado. O premium ativa assim que o Mercado Pago confirmar.
                </div>
              )}

              <p className="text-[10px] text-slate-500 text-center">
                {displayName ? `${displayName}, ` : ''}O painel básico continua disponível sem plano.
              </p>
            </form>
          ) : (
            <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">Selecione um plano.</div>
          )}
        </div>
      )}
    </div>
  );
}
