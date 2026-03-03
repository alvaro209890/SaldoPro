import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CreditCard,
  Crown,
  FileText,
  LockKeyhole,
  MessageCircle,
  Mic,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  X,
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
const iframeCls = 'h-[42px] max-h-[42px] overflow-hidden rounded-lg border border-white/10 bg-white px-3';
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

  /* skeleton */
  if (loading && !plans.length && !billingStatus) {
    return (
      <div className="animate-fade-in space-y-4 p-4 pb-24">
        <div className="h-32 rounded-2xl bg-white/[0.02] border border-white/5 animate-pulse" />
        <div className="h-48 rounded-2xl bg-white/[0.02] border border-white/5 animate-pulse" />
        <div className="h-64 rounded-2xl bg-white/[0.02] border border-white/5 animate-pulse" />
      </div>
    );
  }

  /* ═══════════════════════════════════════════════ */
  /*                    RENDER                       */
  /* ═══════════════════════════════════════════════ */
  return (
    <div ref={topRef} className="animate-fade-in space-y-5 px-2 sm:px-4 pb-28">

      {pageError && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{pageError}</span>
          <button onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* ═══════════════════════════════════════════ */}
      {/*         STEP 1: PLAN SELECTION              */}
      {/* ═══════════════════════════════════════════ */}
      {!showCheckout && (
        <>
          {/* ── HERO ── */}
          <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-emerald-950/60 via-slate-900 to-slate-950 p-5 sm:p-7">
            {/* BG effects */}
            <div className="absolute -left-16 -top-16 h-48 w-48 rounded-full bg-emerald-400/10 blur-[80px]" />
            <div className="absolute -right-20 bottom-0 h-56 w-56 rounded-full bg-teal-400/8 blur-[80px]" />

            <div className="relative">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-200">
                    <Crown className="h-3 w-3" />
                    Premium
                  </div>
                  <h1 className="text-xl sm:text-2xl font-bold text-white leading-tight max-w-lg">
                    A parte mais poderosa do SaldoPro está a um clique.
                  </h1>
                  <p className="text-sm text-slate-300 leading-relaxed max-w-md">
                    Assine e desbloqueie IA ilimitada no WhatsApp, metas inteligentes, armazenamento de arquivos e muito mais.
                  </p>
                </div>

                {/* Status card */}
                <div className="rounded-xl border border-white/10 bg-black/30 backdrop-blur-sm p-3.5 min-w-[180px] shrink-0">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">Seu status</p>
                  <span className={`mt-1.5 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusCls}`}>{statusLabel}</span>
                  {currentPlan && <p className="text-[11px] text-slate-400 mt-1.5">{currentPlan.name}</p>}
                  {sub?.nextBillingDate && <p className="text-[10px] text-slate-500 mt-1">Renova: {formatDate(sub.nextBillingDate)}</p>}

                  {/* WhatsApp quota */}
                  {quota && (
                    <div className="mt-3 pt-3 border-t border-white/8">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="flex items-center gap-1 text-slate-400">
                          <MessageCircle className="h-3 w-3 text-emerald-300" />WhatsApp
                        </span>
                        <span className={`font-bold ${hasPremium ? 'text-emerald-300' : quota.remaining === 0 ? 'text-rose-300' : 'text-amber-300'}`}>
                          {hasPremium ? '∞' : `${quota.remaining}/${quota.limit}`}
                        </span>
                      </div>
                      {!hasPremium && (
                        <div className="mt-1 h-1 rounded-full bg-white/10 overflow-hidden">
                          <div className={`h-full rounded-full ${quota.remaining === 0 ? 'bg-rose-400' : 'bg-amber-400'}`}
                            style={{ width: `${Math.min(100, (quota.remaining / (quota.limit || 1)) * 100)}%` }} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* ── WHATSAPP DESTAQUE ── */}
          {!hasPremium && (
            <section className="rounded-2xl border border-emerald-400/20 bg-gradient-to-r from-emerald-950/50 via-emerald-900/20 to-transparent p-5 sm:p-6">
              <div className="flex items-center gap-2.5 mb-1">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20">
                  <MessageCircle className="h-4 w-4 text-emerald-300" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">WhatsApp + IA Financeira</h2>
                  <p className="text-[11px] text-emerald-200/60">O recurso favorito dos assinantes</p>
                </div>
              </div>
              <p className="text-xs text-slate-300 mb-4 leading-relaxed">
                Faça tudo direto pelo WhatsApp: registre gastos, consulte saldo, receba alertas e peça documentos — sem abrir o app.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {[
                  { icon: MessageCircle, title: 'Mensagens ilimitadas', desc: 'Sem trava diária. Converse com a IA o quanto quiser.' },
                  { icon: Zap, title: 'Registrar gastos por texto', desc: '"Gastei 80 no mercado" e a transação é criada.' },
                  { icon: Mic, title: 'Consultar saldo por áudio', desc: 'Envie áudio perguntando e receba sua posição.' },
                  { icon: Target, title: 'Metas via WhatsApp', desc: 'Receba tarefas e acompanhe progresso por chat.' },
                  { icon: FileText, title: 'Buscar documentos', desc: 'Peça imagens e PDFs salvos direto na conversa.' },
                  { icon: ShieldCheck, title: 'Alertas automáticos', desc: 'Aviso de contas a vencer e resumos financeiros.' },
                ].map(f => (
                  <div key={f.title} className="flex items-start gap-2.5 rounded-xl border border-emerald-400/10 bg-white/[0.03] p-3 hover:bg-white/[0.06] transition">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15">
                      <f.icon className="h-3.5 w-3.5 text-emerald-300" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white">{f.title}</p>
                      <p className="text-[11px] text-slate-400 leading-relaxed mt-0.5">{f.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {!hasPremium && quota && quota.remaining === 0 && (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-400/20 px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-rose-300 shrink-0" />
                  <p className="text-[11px] text-rose-200">Seu limite diário de WhatsApp acabou. Assine agora para voltar a usar!</p>
                </div>
              )}
            </section>
          )}

          {/* ── BENEFÍCIOS PREMIUM ── */}
          <section>
            <h2 className="text-sm font-bold text-white mb-3">O que o premium desbloqueia</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                { icon: MessageCircle, title: 'WhatsApp sem limite', desc: 'IA ilimitada no WhatsApp', color: 'from-emerald-500/15 to-emerald-500/5 border-emerald-400/15' },
                { icon: Bot, title: 'IA no painel', desc: 'Chat com IA no painel web', color: 'from-sky-500/15 to-sky-500/5 border-sky-400/15' },
                { icon: Target, title: 'Metas & tarefas', desc: 'IA gera metas e ajuda a cumprir', color: 'from-purple-500/15 to-purple-500/5 border-purple-400/15' },
                { icon: FileText, title: 'Arquivos', desc: 'Salve imagens, PDFs e ZIPs', color: 'from-amber-500/15 to-amber-500/5 border-amber-400/15' },
              ].map(b => (
                <div key={b.title} className={`rounded-xl border bg-gradient-to-b ${b.color} p-3.5 hover:scale-[1.02] transition-transform`}>
                  <b.icon className="h-5 w-5 text-white/80 mb-2" />
                  <p className="text-xs font-bold text-white">{b.title}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{b.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── COMPARAÇÃO BÁSICO vs PREMIUM ── */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
              <div className="flex items-center gap-2 mb-3">
                <X className="h-4 w-4 text-rose-400" />
                <p className="text-sm font-bold text-white">Plano Grátis</p>
              </div>
              <ul className="space-y-2">
                {['Dashboard básico', 'Categorias e transações', 'Lembretes simples', 'WhatsApp limitado (poucas msgs/dia)', 'Sem metas com IA', 'Sem armazenamento'].map(f => (
                  <li key={f} className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/5">
                      <Check className="h-2.5 w-2.5 text-slate-500" />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.04] p-4">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-4 w-4 text-emerald-300" />
                <p className="text-sm font-bold text-white">Premium</p>
                <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[8px] font-bold uppercase text-black ml-auto">Recomendado</span>
              </div>
              <ul className="space-y-2">
                {[
                  'Tudo do grátis',
                  'WhatsApp com IA ilimitada',
                  'Registrar gastos por mensagem',
                  'Consultar saldo por voz',
                  'Metas inteligentes com IA',
                  'Imagens, PDFs e ZIPs salvos',
                  'Histórico e fluxos premium',
                  'Documentos via WhatsApp',
                ].map(f => (
                  <li key={f} className="flex items-center gap-2 text-xs text-slate-200">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
                      <Check className="h-2.5 w-2.5 text-emerald-300" />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* ── SOCIAL PROOF / URGÊNCIA ── */}
          {!hasPremium && (
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 rounded-xl border border-white/8 bg-white/[0.03] p-3.5 flex items-center gap-3">
                <div className="flex -space-x-2">
                  {['🧑‍💼', '👩‍💻', '👨‍🔧'].map((e, i) => (
                    <div key={i} className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-slate-900 bg-slate-800 text-sm">{e}</div>
                  ))}
                </div>
                <div>
                  <p className="text-xs font-semibold text-white">+200 assinantes ativos</p>
                  <p className="text-[10px] text-slate-400">Usando o WhatsApp com IA todo dia.</p>
                </div>
              </div>
              <div className="flex-1 rounded-xl border border-amber-400/15 bg-amber-500/5 p-3.5 flex items-center gap-3">
                <Zap className="h-5 w-5 text-amber-300 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-white">Ativação instantânea</p>
                  <p className="text-[10px] text-slate-400">Premium libera na hora após pagamento.</p>
                </div>
              </div>
            </div>
          )}

          {/* ── PLAN CARDS ── */}
          {hasPlans && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-white">Escolha seu plano</h2>
                <span className="rounded-full bg-emerald-500/15 border border-emerald-400/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-200">
                  ⭐ Trimestral em destaque
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {plans.map(plan => {
                  const sel = selectedPlan?.code === plan.code;
                  const cur = sub?.planCode === plan.code && sub.status === 'authorized';
                  const eq = getPlanMonthlyEquivalent(plan);
                  const isQ = plan.code === 'quarterly';
                  const isY = plan.code === 'yearly';

                  const borderColor = sel
                    ? isQ ? 'border-emerald-400/50 shadow-lg shadow-emerald-500/15' : isY ? 'border-amber-400/40 shadow-lg shadow-amber-500/10' : 'border-sky-400/40 shadow-lg shadow-sky-500/10'
                    : 'border-white/10 hover:border-white/20';
                  const bgColor = sel
                    ? isQ ? 'bg-emerald-500/[0.08]' : isY ? 'bg-amber-500/[0.06]' : 'bg-sky-500/[0.06]'
                    : 'bg-white/[0.02] hover:bg-white/[0.04]';

                  return (
                    <button key={plan.code} type="button" onClick={() => selectPlan(plan.code)}
                      className={`relative rounded-xl border p-4 text-left transition-all ${borderColor} ${bgColor}`}>
                      {isQ && (
                        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-emerald-500 px-3 py-0.5 text-[9px] font-bold uppercase text-black shadow-md">
                          Mais escolhido
                        </div>
                      )}
                      <div className="flex items-center gap-2 mb-2 mt-1">
                        <Star className={`h-3.5 w-3.5 ${isQ ? 'text-emerald-300' : isY ? 'text-amber-300' : 'text-sky-300'}`} />
                        <span className="text-sm font-bold text-white">{plan.name}</span>
                        {cur && <span className="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-[8px] font-bold text-white uppercase">Atual</span>}
                      </div>
                      <p className="text-2xl font-bold text-white">{plan.priceFormatted}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {plan.intervalCount === 1 ? 'por mês' : plan.intervalCount === 12 ? 'por ano' : `a cada ${plan.intervalCount} meses`}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-2">{eq}</p>
                      <div className={`mt-3 flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-bold transition ${sel ? 'bg-white text-black' : 'bg-white/5 text-slate-300 border border-white/10'}`}>
                        {sel ? <Check className="h-3 w-3" /> : null}
                        {sel ? 'Selecionado' : 'Selecionar'}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* CTA */}
              <div className="mt-4">
                <Button onClick={goCheckout} disabled={!selectedPlan} size="lg"
                  className="w-full h-12 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-sm font-bold text-white shadow-xl shadow-emerald-500/20 hover:brightness-110 hover:scale-[1.01] transition-all">
                  <CreditCard className="mr-2 h-4 w-4" />
                  <span className="hidden sm:inline">Assinar {selectedPlan?.name ?? ''} e desbloquear premium</span>
                  <span className="sm:hidden">Assinar agora</span>
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <p className="text-[10px] text-slate-500 text-center mt-2">
                  Cancele quando quiser. Todos os planos desbloqueiam o mesmo pacote premium completo.
                </p>
              </div>
            </section>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════ */}
      {/*         STEP 2: CHECKOUT (SIMPLE)           */}
      {/* ═══════════════════════════════════════════ */}
      {showCheckout && (
        <div className="max-w-xl mx-auto rounded-xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-950 p-4 sm:p-5">
          <button onClick={goBack} className="text-xs text-slate-400 hover:text-white mb-3 flex items-center gap-1 transition">← Voltar</button>

          {/* Plan summary */}
          <div className="flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.02] p-3 mb-4">
            <div>
              <p className="text-[10px] text-slate-500 uppercase">Plano</p>
              <p className="text-sm font-bold text-white">{selectedPlan?.name}</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-white">{selectedPlan?.priceFormatted}</p>
              <p className="text-[10px] text-emerald-300">{selectedPlan ? getPlanMonthlyEquivalent(selectedPlan) : ''}</p>
            </div>
          </div>

          {/* Form */}
          {selectedPlan ? (
            <form id="plans-checkout-form" className="space-y-2.5">
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
              <div>
                <label className={labelCls} htmlFor="plans-cardholder-email">E-mail</label>
                <input id="plans-cardholder-email" type="email" defaultValue={user?.email ?? ''} className={inputCls} placeholder="voce@email.com" autoComplete="email" />
              </div>
              {/* Hidden: required by Mercado Pago SDK but not relevant for recurring subscriptions */}
              <div className="hidden"><select id="plans-issuer" defaultValue=""><option value="">Selecione</option></select></div>
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
              {/* Hidden: installments not applicable for recurring billing */}
              <div className="hidden"><select id="plans-installments" defaultValue=""><option value="">Automático</option></select></div>

              {sdkError && <div className="rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{sdkError}</div>}
              {checkoutError && <div className="rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{checkoutError}</div>}

              <div className="flex items-start gap-2 rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2">
                <LockKeyhole className="h-3.5 w-3.5 text-emerald-300 mt-0.5 shrink-0" />
                <p className="text-[10px] text-slate-400 leading-relaxed">Pagamento seguro via Mercado Pago. Cancele quando quiser.</p>
              </div>

              <Button type="submit" size="lg" isLoading={checkoutLoading || sdkLoading} disabled={!sdkReady || Boolean(sdkError)}
                className="w-full h-12 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-sm font-bold text-white shadow-lg shadow-emerald-500/15 hover:brightness-110">
                <CreditCard className="mr-2 h-4 w-4" />
                {getCheckoutButtonLabel(selectedPlan.code, subStatus, sub?.planCode ?? null)}
              </Button>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button type="button" onClick={() => void load()} disabled={checkoutLoading || cancelLoading}
                  className="h-9 rounded-lg border border-white/10 bg-white/[0.02] text-xs font-medium text-slate-400 hover:bg-white/[0.05] transition flex items-center justify-center gap-1.5 disabled:opacity-50">
                  <RefreshCw className="h-3 w-3" /> Atualizar
                </button>
                {canCancel && (
                  <button type="button" onClick={() => void cancelPlan()} disabled={checkoutLoading}
                    className="h-9 rounded-lg border border-rose-400/20 bg-rose-500/10 text-xs font-medium text-rose-200 hover:bg-rose-500/15 transition flex items-center justify-center disabled:opacity-50">
                    {cancelLoading ? 'Cancelando...' : 'Cancelar assinatura'}
                  </button>
                )}
              </div>

              {sub?.status === 'pending' && (
                <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  Pagamento enviado. Premium ativa assim que confirmado.
                </div>
              )}
            </form>
          ) : (
            <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">Selecione um plano.</div>
          )}
        </div>
      )}
    </div>
  );
}
