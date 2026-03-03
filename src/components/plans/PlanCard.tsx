import { BadgeCheck, Check, Star } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { BillingPlan } from '@/services/billing';
import { PLAN_BADGES, PLAN_INCLUDED_ITEMS } from './constants';
import { getPlanMonthlyEquivalent, getPlanPositioning, planCardTone } from './presentation';

interface PlanCardProps {
  plan: BillingPlan;
  selected: boolean;
  isCurrentPlan: boolean;
  onSelect: () => void;
}

export function PlanCard({
  plan,
  selected,
  isCurrentPlan,
  onSelect,
}: PlanCardProps) {
  const positioning = getPlanPositioning(plan.code);
  const monthlyEquivalent = getPlanMonthlyEquivalent(plan);

  return (
    <article
      className={`relative overflow-hidden rounded-[1.5rem] border p-4 transition-all sm:p-5 ${planCardTone(plan.code, selected)}`}
    >
      {plan.code === 'quarterly' && (
        <div className="absolute -right-8 top-5 rotate-12 rounded-full bg-emerald-400/15 px-8 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200">
          Recomendado
        </div>
      )}

      <div className="relative space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">{plan.name}</p>
            <p className="mt-3 text-3xl font-semibold text-white sm:text-4xl">
              {plan.priceFormatted}
            </p>
            <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
              {plan.intervalCount === 1
                ? 'Cobranca mensal'
                : plan.intervalCount === 12
                  ? 'Cobranca anual'
                  : `Cobranca a cada ${plan.intervalCount} meses`}
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                plan.code === 'quarterly'
                  ? 'bg-emerald-500/15 text-emerald-200'
                  : plan.code === 'yearly'
                    ? 'bg-amber-500/15 text-amber-200'
                    : 'bg-sky-500/15 text-sky-200'
              }`}
            >
              <Star className="h-3 w-3" />
              {PLAN_BADGES[plan.code]}
            </span>

            {isCurrentPlan && (
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
                <BadgeCheck className="h-3 w-3" />
                Atual
              </span>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
          <p className="text-sm font-semibold text-white">{positioning.headline}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">{positioning.subline}</p>
          <div className="mt-3 inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">
            {positioning.highlightLabel}
          </div>
        </div>

        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Valor percebido
          </p>
          <p className="mt-2 text-sm font-medium text-white">{monthlyEquivalent}</p>
          <p className="mt-2 text-xs leading-6 text-slate-400">
            O pacote premium liberado e o mesmo. O que muda aqui e a melhor forma de pagar.
          </p>
        </div>

        <ul className="space-y-2">
          {PLAN_INCLUDED_ITEMS.map((item) => {
            const Icon = item.icon;

            return (
              <li key={item.label} className="flex items-center gap-2 text-sm text-slate-300">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-white/8 bg-white/[0.04] text-emerald-200">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span>{item.label}</span>
              </li>
            );
          })}
        </ul>

        <Button
          size="lg"
          onClick={onSelect}
          className={`h-12 w-full rounded-2xl text-sm font-semibold ${
            selected
              ? 'bg-white text-slate-950 hover:bg-slate-100 focus:ring-white'
              : 'bg-white/[0.06] text-white hover:bg-white/[0.1] focus:ring-white border border-white/10 shadow-none'
          }`}
        >
          <Check className="mr-2 h-4 w-4" />
          {selected ? 'Plano selecionado' : 'Selecionar plano'}
        </Button>
      </div>
    </article>
  );
}
