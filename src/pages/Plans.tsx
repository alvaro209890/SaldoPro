import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { MERCADO_PAGO_PUBLIC_KEY } from '@/config/backend';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { MobileCheckoutBar } from '@/components/plans/MobileCheckoutBar';
import { PlanCard } from '@/components/plans/PlanCard';
import { PlanCheckoutPanel } from '@/components/plans/PlanCheckoutPanel';
import { PlansComparisonSection } from '@/components/plans/PlansComparisonSection';
import { PlansHero } from '@/components/plans/PlansHero';
import { PremiumBenefitsGrid } from '@/components/plans/PremiumBenefitsGrid';
import {
  BASIC_PLAN_FEATURES,
  PREMIUM_BENEFITS,
  PREMIUM_PLAN_FEATURES,
} from '@/components/plans/constants';
import {
  formatBillingStatus,
  formatDate,
  getCheckoutButtonLabel,
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

const DESKTOP_MEDIA_QUERY = '(min-width: 1280px)';

function scrollToElement(element: HTMLElement | null) {
  if (!element) return;
  element.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

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
  const [isDesktopLayout, setIsDesktopLayout] = useState(false);
  const [checkoutStage, setCheckoutStage] = useState<CheckoutStage>('select');
  const cardFormRef = useRef<MercadoPagoCardFormController | null>(null);
  const checkoutLoadingRef = useRef(false);
  const benefitsSectionRef = useRef<HTMLDivElement | null>(null);
  const plansSectionRef = useRef<HTMLElement | null>(null);
  const checkoutSectionRef = useRef<HTMLDivElement | null>(null);

  checkoutLoadingRef.current = checkoutLoading;

  const selectedPlan =
    plans.find((plan) => plan.code === selectedPlanCode) ?? plans[0] ?? null;
  const currentPlan =
    plans.find((plan) => plan.code === billingStatus?.subscription.planCode) ?? null;
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
    : 'Assim que ativar o plano';
  const checkoutVisible = hasPlans && (isDesktopLayout || checkoutStage === 'checkout');
  const showMobileCheckoutBar =
    !isDesktopLayout && checkoutStage === 'select' && Boolean(selectedPlan);

  function destroyCardForm() {
    cardFormRef.current?.unmount?.();
    cardFormRef.current?.destroy?.();
    cardFormRef.current = null;
  }

  async function loadBillingData() {
    setLoading(true);
    setPageError('');

    try {
      const [nextPlans, nextStatus] = await Promise.all([
        getBillingPlans(),
        getBillingStatus(),
      ]);

      setPlans(nextPlans);
      setBillingStatus(nextStatus);

      const preferredCode =
        nextStatus.subscription.planCode ??
        (nextPlans.some((plan) => plan.code === selectedPlanCode)
          ? selectedPlanCode
          : 'quarterly');

      if (nextPlans.some((plan) => plan.code === preferredCode)) {
        setSelectedPlanCode(preferredCode as BillingPlanCode);
      } else if (nextPlans[0]) {
        setSelectedPlanCode(nextPlans[0].code);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Nao foi possivel carregar a area de planos.';

      setPageError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  function handleChoosePlanFromHero() {
    setCheckoutStage('select');
    scrollToElement(plansSectionRef.current);
  }

  function handleShowBenefits() {
    scrollToElement(benefitsSectionRef.current);
  }

  function handleContinueToCheckout() {
    if (!selectedPlan) return;
    setCheckoutStage('checkout');
    setTimeout(() => {
      scrollToElement(checkoutSectionRef.current);
    }, 40);
  }

  function handleBackToPlans() {
    setCheckoutStage('select');
    setTimeout(() => {
      scrollToElement(plansSectionRef.current);
    }, 40);
  }

  function handleSelectPlan(planCode: BillingPlanCode) {
    setSelectedPlanCode(planCode);
    setCheckoutError('');

    if (isDesktopLayout) {
      setTimeout(() => {
        scrollToElement(checkoutSectionRef.current);
      }, 40);
    }
  }

  async function handleCancelPlan() {
    if (!canCancel || cancelLoading) return;

    const confirmed = window.confirm(
      'Cancelar a assinatura agora? O acesso premium segue o status devolvido pelo Mercado Pago.'
    );

    if (!confirmed) return;

    setCancelLoading(true);

    try {
      const nextStatus = await cancelBillingSubscription();
      setBillingStatus(nextStatus);
      toast.success('Assinatura cancelada.');
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Nao foi possivel cancelar a assinatura.';
      toast.error(message);
    } finally {
      setCancelLoading(false);
    }
  }

  useEffect(() => {
    void loadBillingData();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const media = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const syncLayout = () => {
      setIsDesktopLayout(media.matches);
    };

    syncLayout();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', syncLayout);
      return () => media.removeEventListener('change', syncLayout);
    }

    media.addListener(syncLayout);
    return () => media.removeListener(syncLayout);
  }, []);

  useEffect(() => {
    if (!MERCADO_PAGO_PUBLIC_KEY) {
      setSdkError(
        'Configure VITE_MERCADO_PAGO_PUBLIC_KEY para liberar o checkout com cartao.'
      );
      setSdkReady(false);
      setSdkLoading(false);
      return;
    }

    if (typeof window === 'undefined') return undefined;

    if (window.MercadoPago) {
      setSdkReady(true);
      setSdkLoading(false);
      setSdkError('');
      return undefined;
    }

    let cancelled = false;
    setSdkLoading(true);

    const existingScript = document.getElementById(
      'mercado-pago-sdk-v2'
    ) as HTMLScriptElement | null;

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
    if (
      !selectedPlan ||
      !sdkReady ||
      !window.MercadoPago ||
      !MERCADO_PAGO_PUBLIC_KEY ||
      !checkoutVisible
    ) {
      destroyCardForm();
      return undefined;
    }

    const formElement = document.getElementById('plans-checkout-form');
    if (!formElement) {
      return undefined;
    }

    setCheckoutError('');
    setSdkError('');
    destroyCardForm();

    let disposed = false;
    const mercadoPago = new window.MercadoPago(MERCADO_PAGO_PUBLIC_KEY, {
      locale: 'pt-BR',
    });

    const controller = mercadoPago.cardForm({
      amount: (selectedPlan.priceCents / 100).toFixed(2),
      iframe: true,
      form: {
        id: 'plans-checkout-form',
        cardNumber: {
          id: 'plans-card-number',
          placeholder: 'Numero do cartao',
        },
        expirationDate: {
          id: 'plans-card-expiration',
          placeholder: 'MM/AA',
        },
        securityCode: {
          id: 'plans-card-cvc',
          placeholder: 'CVV',
        },
        cardholderName: {
          id: 'plans-cardholder-name',
          placeholder: 'Nome como esta no cartao',
        },
        cardholderEmail: {
          id: 'plans-cardholder-email',
          placeholder: 'voce@email.com',
        },
        issuer: {
          id: 'plans-issuer',
          placeholder: 'Banco emissor',
        },
        installments: {
          id: 'plans-installments',
          placeholder: 'Opcao do emissor',
        },
        identificationType: {
          id: 'plans-identification-type',
          placeholder: 'Documento',
        },
        identificationNumber: {
          id: 'plans-identification-number',
          placeholder: 'Numero do documento',
        },
      },
      callbacks: {
        onFormMounted: (error?: unknown) => {
          if (disposed) return;
          if (error) {
            setSdkError(
              'Nao consegui inicializar os campos protegidos do Mercado Pago.'
            );
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
            const message =
              'Informe um e-mail valido para concluir o pagamento.';
            setCheckoutError(message);
            toast.error(message);
            return;
          }

          if (!cardTokenId) {
            const message =
              'Nao foi possivel validar o cartao. Revise os dados e tente novamente.';
            setCheckoutError(message);
            toast.error(message);
            return;
          }

          if (!paymentMethodId) {
            const message =
              'Nao consegui identificar a bandeira do cartao. Verifique o numero informado.';
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
            ...(formData.identificationType
              ? { identificationType: formData.identificationType }
              : {}),
            ...(formData.identificationNumber
              ? { identificationNumber: formData.identificationNumber }
              : {}),
          })
            .then((nextStatus) => {
              setBillingStatus(nextStatus);

              const successMessage =
                nextStatus.subscription.status === 'authorized'
                  ? 'Plano ativado com sucesso.'
                  : 'Pagamento enviado. Assim que o Mercado Pago confirmar, o acesso premium sera liberado.';

              toast.success(successMessage);
            })
            .catch((error: unknown) => {
              const message =
                error instanceof Error
                  ? error.message
                  : 'Nao foi possivel concluir o pagamento.';

              setCheckoutError(message);
              toast.error(message);
            })
            .finally(() => {
              setCheckoutLoading(false);
            });
        },
      },
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
  }, [checkoutVisible, sdkReady, selectedPlan?.code, selectedPlan?.priceCents]);

  if (loading && plans.length === 0 && !billingStatus) {
    return (
      <div className="animate-fade-in space-y-6 pb-28 xl:pb-0">
        <div className="h-72 rounded-[2rem] border border-white/10 bg-white/[0.03]" />
        <div className="h-56 rounded-[1.8rem] border border-white/10 bg-white/[0.03]" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="h-[26rem] rounded-[1.8rem] border border-white/10 bg-white/[0.03]" />
          <div className="h-[26rem] rounded-[1.8rem] border border-white/10 bg-white/[0.03]" />
          <div className="h-[26rem] rounded-[1.8rem] border border-white/10 bg-white/[0.03]" />
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6 pb-28 xl:pb-0">
      {pageError && (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-rose-400/20 bg-rose-500/10 text-rose-200">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-rose-100">
                  Nao consegui atualizar a area de planos.
                </p>
                <p className="mt-1 text-sm text-rose-200/80">{pageError}</p>
              </div>
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => void loadBillingData()}
              className="h-10 rounded-xl border-white/10 bg-white/[0.05] text-slate-100 hover:bg-white/[0.1]"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Tentar de novo
            </Button>
          </div>
        </div>
      )}

      <PlansHero
        statusLabel={statusLabel}
        statusClassName={statusClassName}
        hasPremium={hasPremium}
        freeQuotaRemaining={billingStatus?.freeWhatsappQuota.remaining ?? 0}
        freeQuotaLimit={billingStatus?.freeWhatsappQuota.limit ?? 1}
        freeQuotaEnabled={billingStatus?.freeWhatsappQuota.enabled ?? true}
        nextBillingDateLabel={nextBillingDateLabel}
        onChoosePlan={handleChoosePlanFromHero}
        onShowBenefits={handleShowBenefits}
      />

      <div className="grid gap-6 xl:grid-cols-[1.06fr_0.94fr] xl:items-start">
        <div className="space-y-6">
          <div ref={benefitsSectionRef}>
            <PremiumBenefitsGrid benefits={PREMIUM_BENEFITS} />
          </div>

          {(isDesktopLayout || checkoutStage === 'select') && (
            <section ref={plansSectionRef} className="space-y-4">
              <div className="rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(8,12,24,0.92),rgba(8,12,24,0.78))] p-4 shadow-2xl sm:rounded-[1.8rem] sm:p-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                      Escolha seu plano
                    </p>
                    <h2 className="mt-2 text-xl font-semibold text-white sm:text-2xl">
                      Escolha o plano que mais acelera seu uso.
                    </h2>
                    <p className="mt-2 text-sm leading-7 text-slate-400">
                      Todos liberam o mesmo premium. Aqui voce escolhe a melhor forma de pagar.
                    </p>
                  </div>
                  <div className="inline-flex rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                    Trimestral em destaque
                  </div>
                </div>

                {!hasPlans ? (
                  <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                    Os planos estao indisponiveis no momento. Atualize a pagina e tente novamente.
                  </div>
                ) : (
                  <div className="mt-5 grid gap-4 lg:grid-cols-3">
                    {plans.map((plan) => (
                      <PlanCard
                        key={plan.code}
                        plan={plan}
                        selected={selectedPlan?.code === plan.code}
                        isCurrentPlan={
                          billingStatus?.subscription.planCode === plan.code &&
                          billingStatus.subscription.status === 'authorized'
                        }
                        onSelect={() => handleSelectPlan(plan.code)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {(isDesktopLayout || checkoutStage === 'select') && (
            <PlansComparisonSection
              basicFeatures={BASIC_PLAN_FEATURES}
              premiumFeatures={PREMIUM_PLAN_FEATURES}
            />
          )}
        </div>

        {checkoutVisible && (
          <div ref={checkoutSectionRef}>
            <PlanCheckoutPanel
              selectedPlan={selectedPlan}
              currentPlan={currentPlan}
              billingStatus={billingStatus}
              statusLabel={statusLabel}
              statusClassName={statusClassName}
              isDesktopLayout={isDesktopLayout}
              canCancel={canCancel}
              checkoutLoading={checkoutLoading}
              cancelLoading={cancelLoading}
              sdkLoading={sdkLoading}
              sdkReady={sdkReady}
              sdkError={sdkError}
              checkoutError={checkoutError}
              userEmail={user?.email ?? ''}
              displayName={displayName ?? ''}
              checkoutButtonLabel={
                selectedPlan
                  ? getCheckoutButtonLabel(
                    selectedPlan.code,
                    subscriptionStatus,
                    billingStatus?.subscription.planCode ?? null
                  )
                  : 'Selecione um plano'
              }
              onRefresh={() => void loadBillingData()}
              onCancel={() => void handleCancelPlan()}
              onBackToPlans={handleBackToPlans}
            />
          </div>
        )}
      </div>

      <MobileCheckoutBar
        selectedPlan={selectedPlan}
        visible={showMobileCheckoutBar}
        onContinue={handleContinueToCheckout}
      />
    </div>
  );
}
