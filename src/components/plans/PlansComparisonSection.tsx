import { Check, X } from 'lucide-react';

interface PlansComparisonSectionProps {
  basicFeatures: string[];
  premiumFeatures: string[];
}

export function PlansComparisonSection({
  basicFeatures,
  premiumFeatures,
}: PlansComparisonSectionProps) {
  return (
    <section className="rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(7,10,18,0.96),rgba(7,10,18,0.82))] p-4 shadow-2xl sm:rounded-[1.8rem] sm:p-6">
      <div className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
          O que muda na pratica
        </p>
        <h2 className="mt-2 text-xl font-semibold text-white sm:text-2xl">
          Voce continua com o basico sem plano, mas o premium libera o que realmente poupa tempo.
        </h2>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <X className="h-4 w-4 text-rose-300" />
            Sem plano
          </div>
          <ul className="mt-4 space-y-2">
            {basicFeatures.map((feature) => (
              <li
                key={feature}
                className="flex items-center gap-2 text-sm text-slate-300"
              >
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/8 bg-white/[0.04] text-slate-400">
                  <Check className="h-3.5 w-3.5" />
                </span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-emerald-400/15 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Check className="h-4 w-4 text-emerald-300" />
            Com premium
          </div>
          <ul className="mt-4 space-y-2">
            {premiumFeatures.map((feature) => (
              <li
                key={feature}
                className="flex items-center gap-2 text-sm text-slate-200"
              >
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-400/15 bg-emerald-500/10 text-emerald-200">
                  <Check className="h-3.5 w-3.5" />
                </span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
