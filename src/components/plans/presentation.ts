import type {
  BillingPlan,
  BillingPlanCode,
  BillingStatusResponse,
} from '@/services/billing';
import { PLAN_POSITIONING } from './constants';

export function formatDate(value: string | null): string {
  if (!value) return 'Sem data definida';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(parsed));
}

export function formatBillingStatus(
  status: BillingStatusResponse['subscription']['status']
): string {
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

export function statusTone(
  status: BillingStatusResponse['subscription']['status']
): string {
  if (status === 'authorized') {
    return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200';
  }

  if (status === 'pending') {
    return 'border-amber-400/25 bg-amber-500/10 text-amber-200';
  }

  if (
    status === 'paused' ||
    status === 'cancelled' ||
    status === 'rejected'
  ) {
    return 'border-rose-400/25 bg-rose-500/10 text-rose-200';
  }

  return 'border-white/10 bg-white/5 text-slate-200';
}

export function planCardTone(code: BillingPlanCode, selected: boolean): string {
  if (selected && code === 'quarterly') {
    return 'border-emerald-400/40 bg-emerald-500/12 shadow-[0_24px_70px_rgba(16,185,129,0.16)]';
  }

  if (selected && code === 'yearly') {
    return 'border-amber-400/35 bg-amber-500/10 shadow-[0_24px_70px_rgba(245,158,11,0.14)]';
  }

  if (selected) {
    return 'border-sky-400/35 bg-sky-500/10 shadow-[0_24px_70px_rgba(56,189,248,0.12)]';
  }

  return 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]';
}

export function getPlanMonthlyEquivalent(plan: BillingPlan): string {
  if (plan.intervalCount <= 1) {
    return 'Menor entrada para ativar o premium.';
  }

  const monthlyValue = (plan.priceCents / 100 / plan.intervalCount)
    .toFixed(2)
    .replace('.', ',');

  return `Equivale a R$ ${monthlyValue}/mes.`;
}

export function getCheckoutButtonLabel(
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

  return 'Ativar premium agora';
}

export function getPlanPositioning(code: BillingPlanCode) {
  return PLAN_POSITIONING[code];
}
