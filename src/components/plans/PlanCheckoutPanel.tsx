import {
  CreditCard,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { BillingPlan, BillingStatusResponse } from '@/services/billing';
import { PREMIUM_UNLOCK_ITEMS } from './constants';

interface PlanCheckoutPanelProps {
  selectedPlan: BillingPlan | null;
  currentPlan: BillingPlan | null;
  billingStatus: BillingStatusResponse | null;
  statusLabel: string;
  statusClassName: string;
  isDesktopLayout: boolean;
  canCancel: boolean;
  checkoutLoading: boolean;
  cancelLoading: boolean;
  sdkLoading: boolean;
  sdkReady: boolean;
  sdkError: string;
  checkoutError: string;
  userEmail: string;
  displayName: string;
  checkoutButtonLabel: string;
  onRefresh: () => void;
  onCancel: () => void;
  onBackToPlans: () => void;
}

export function PlanCheckoutPanel({
  selectedPlan,
  currentPlan,
  billingStatus,
  statusLabel,
  statusClassName,
  isDesktopLayout,
  canCancel,
  checkoutLoading,
  cancelLoading,
  sdkLoading,
  sdkReady,
  sdkError,
  checkoutError,
  userEmail,
  displayName,
  checkoutButtonLabel,
  onRefresh,
  onCancel,
  onBackToPlans,
}: PlanCheckoutPanelProps) {
  return (
    <section className="rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(8,12,24,0.98),rgba(2,6,23,0.98))] p-4 shadow-2xl sm:rounded-[1.8rem] sm:p-6 xl:sticky xl:top-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          {!isDesktopLayout && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-200">
              Etapa 2 de 2
            </p>
          )}
          <h2 className="mt-1 text-xl font-semibold text-white sm:text-2xl">
            Concluir pagamento
          </h2>
          <p className="mt-2 text-sm leading-7 text-slate-400">
            Pagamento recorrente, sem redirecionamento e com tokenizacao protegida pelo Mercado Pago.
          </p>
        </div>

        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-emerald-200">
          <ShieldCheck className="h-5 w-5" />
        </div>
      </div>

      {!isDesktopLayout && (
        <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                Plano escolhido
              </p>
              <p className="mt-2 text-sm font-semibold text-white">
                {selectedPlan?.name ?? 'Escolha um plano'}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {selectedPlan?.priceFormatted ?? 'Selecione um plano para abrir o checkout.'}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={onBackToPlans}
              className="h-10 rounded-xl border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
            >
              <Undo2 className="mr-2 h-4 w-4" />
              Trocar plano
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
              Status atual
            </p>
            <p
              className={`mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusClassName}`}
            >
              {statusLabel}
            </p>
            <p className="mt-3 text-xs leading-6 text-slate-400">
              {currentPlan ? `Plano atual: ${currentPlan.name}` : 'Voce ainda nao tem um plano ativo.'}
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
              Plano selecionado
            </p>
            <p className="mt-2 text-lg font-semibold text-white">
              {selectedPlan?.priceFormatted ?? '--'}
            </p>
            <p className="text-xs text-emerald-200">
              {selectedPlan?.name ?? 'Selecione um plano'}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 p-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {PREMIUM_UNLOCK_ITEMS.map((item) => {
            const Icon = item.icon;

            return (
              <div
                key={item.label}
                className="flex items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2 text-xs text-slate-200"
              >
                <Icon className="h-3.5 w-3.5 text-emerald-300" />
                <span>{item.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {!selectedPlan ? (
        <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Escolha um plano para carregar o checkout.
        </div>
      ) : (
        <form id="plans-checkout-form" className="mt-4 space-y-4">
          <div className="space-y-2">
            <label
              className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400"
              htmlFor="plans-card-number"
            >
              Numero do cartao
            </label>
            <div
              id="plans-card-number"
              className="min-h-12 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label
                className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400"
                htmlFor="plans-card-expiration"
              >
                Validade
              </label>
              <div
                id="plans-card-expiration"
                className="min-h-12 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"
              />
            </div>
            <div className="space-y-2">
              <label
                className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400"
                htmlFor="plans-card-cvc"
              >
                CVV
              </label>
              <div
                id="plans-card-cvc"
                className="min-h-12 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label
              className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400"
              htmlFor="plans-cardholder-name"
            >
              Nome do titular
            </label>
            <input
              id="plans-cardholder-name"
              type="text"
              className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white outline-none transition focus:border-emerald-400/30"
              placeholder="Como esta no cartao"
              autoComplete="cc-name"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label
                className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400"
                htmlFor="plans-cardholder-email"
              >
                E-mail do pagador
              </label>
              <input
                id="plans-cardholder-email"
                type="email"
                defaultValue={userEmail}
                className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white outline-none transition focus:border-emerald-400/30"
                placeholder="voce@email.com"
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <label
                className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400"
                htmlFor="plans-issuer"
              >
                Banco emissor
              </label>
              <select
                id="plans-issuer"
                className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white outline-none transition focus:border-emerald-400/30"
                defaultValue=""
              >
                <option value="" className="bg-slate-950 text-slate-300">
                  Selecione
                </option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label
                className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400"
                htmlFor="plans-identification-type"
              >
                Tipo de documento
              </label>
              <select
                id="plans-identification-type"
                className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white outline-none transition focus:border-emerald-400/30"
                defaultValue=""
              >
                <option value="" className="bg-slate-950 text-slate-300">
                  Selecione
                </option>
              </select>
            </div>

            <div className="space-y-2">
              <label
                className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400"
                htmlFor="plans-identification-number"
              >
                Numero do documento
              </label>
              <input
                id="plans-identification-number"
                type="text"
                className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white outline-none transition focus:border-emerald-400/30"
                placeholder="CPF ou CNPJ"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label
              className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400"
              htmlFor="plans-installments"
            >
              Opcao do emissor
            </label>
            <select
              id="plans-installments"
              className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white outline-none transition focus:border-emerald-400/30"
              defaultValue=""
            >
              <option value="" className="bg-slate-950 text-slate-300">
                O Mercado Pago preenche automaticamente
              </option>
            </select>
          </div>

          {sdkError && (
            <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {sdkError}
            </div>
          )}

          {checkoutError && (
            <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {checkoutError}
            </div>
          )}

          <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <LockKeyhole className="h-4 w-4 text-emerald-300" />
              Antes de confirmar
            </div>
            <ul className="mt-3 space-y-2 text-sm text-slate-300">
              <li>O cartao fica protegido pelo checkout do Mercado Pago.</li>
              <li>O acesso segue a confirmacao oficial do pagamento.</li>
              <li>Voce pode trocar ou cancelar depois.</li>
            </ul>
          </div>

          <div className="space-y-3 pt-1">
            <Button
              type="submit"
              size="lg"
              isLoading={checkoutLoading || sdkLoading}
              disabled={!selectedPlan || !sdkReady || Boolean(sdkError)}
              className="h-14 w-full rounded-2xl bg-[linear-gradient(135deg,#10b981,#0f766e)] text-base font-semibold text-white shadow-[0_18px_40px_rgba(16,185,129,0.24)] hover:brightness-105"
            >
              <CreditCard className="mr-2 h-5 w-5" />
              {checkoutButtonLabel}
            </Button>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                variant="secondary"
                size="lg"
                onClick={onRefresh}
                disabled={checkoutLoading || cancelLoading}
                className="h-12 flex-1 rounded-2xl border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Atualizar status
              </Button>

              {canCancel && (
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={onCancel}
                  isLoading={cancelLoading}
                  disabled={checkoutLoading}
                  className="h-12 flex-1 rounded-2xl border border-rose-400/20 bg-rose-500/10 text-rose-200 hover:bg-rose-500/15"
                >
                  Cancelar assinatura
                </Button>
              )}
            </div>
          </div>
        </form>
      )}

      <p className="mt-4 text-xs leading-6 text-slate-500">
        {displayName ? `${displayName}, ` : ''}
        o painel basico continua disponivel sem plano, mas o premium libera a parte que mais rende no uso real.
      </p>

      {billingStatus?.subscription.status === 'pending' && (
        <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Seu pagamento foi enviado. Assim que o Mercado Pago confirmar, o premium entra automaticamente.
        </div>
      )}
    </section>
  );
}
