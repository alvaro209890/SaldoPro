import { Sparkles } from 'lucide-react';
import type { PremiumBenefit } from './types';

interface PremiumBenefitsGridProps {
  benefits: PremiumBenefit[];
}

export function PremiumBenefitsGrid({ benefits }: PremiumBenefitsGridProps) {
  return (
    <section className="rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(9,14,26,0.94),rgba(9,14,26,0.82))] p-4 shadow-2xl sm:rounded-[1.8rem] sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-200/80">
            O que o premium libera
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white sm:text-2xl">
            Tudo o que acelera seu uso fica destravado aqui.
          </h2>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-slate-300">
          <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
          Sem etapas manuais
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {benefits.map((benefit) => {
          const Icon = benefit.icon;

          return (
            <article
              key={benefit.title}
              className="rounded-2xl border border-white/8 bg-white/[0.03] p-4"
            >
              <div className="flex items-start gap-3">
                <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-2.5 text-emerald-200">
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{benefit.title}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-400">
                    {benefit.description}
                  </p>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
