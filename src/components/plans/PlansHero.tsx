import { ArrowDown, Crown, ShieldCheck, Zap } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface PlansHeroProps {
  statusLabel: string;
  statusClassName: string;
  hasPremium: boolean;
  freeQuotaRemaining: number;
  freeQuotaLimit: number;
  freeQuotaEnabled: boolean;
  nextBillingDateLabel: string;
  onChoosePlan: () => void;
  onShowBenefits: () => void;
}

export function PlansHero({
  statusLabel,
  statusClassName,
  hasPremium,
  freeQuotaRemaining,
  freeQuotaLimit,
  freeQuotaEnabled,
  nextBillingDateLabel,
  onChoosePlan,
  onShowBenefits,
}: PlansHeroProps) {
  return (
    <section className="relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_28%),radial-gradient(circle_at_90%_18%,rgba(14,165,233,0.18),transparent_24%),linear-gradient(145deg,rgba(3,7,18,0.98),rgba(15,23,42,0.92))] px-4 py-5 shadow-2xl sm:rounded-[2rem] sm:px-6 sm:py-7 xl:px-8">
      <div className="absolute -left-10 top-8 h-36 w-36 rounded-full bg-emerald-400/10 blur-3xl" />
      <div className="absolute -right-12 bottom-0 h-40 w-40 rounded-full bg-sky-400/10 blur-3xl" />

      <div className="relative grid gap-5 xl:grid-cols-[1.2fr_0.8fr] xl:items-start">
        <div className="space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-200">
            <Crown className="h-3.5 w-3.5" />
            Premium
          </div>

          <div className="space-y-3">
            <h1 className="max-w-3xl text-2xl font-semibold leading-tight text-white sm:text-4xl">
              Destrave a parte mais forte do SaldoPro sem perder tempo.
            </h1>
            <p className="max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
              Libere IA sem limite diario no WhatsApp, metas com apoio inteligente,
              arquivos sempre acessiveis e o fluxo premium que tira o trabalho manual do seu dia.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                IA premium
              </p>
              <p className="mt-2 text-sm font-semibold text-white">
                Painel + WhatsApp
              </p>
              <p className="mt-2 text-xs leading-6 text-slate-400">
                Sem travas no uso mais valioso do produto.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                Metas
              </p>
              <p className="mt-2 text-sm font-semibold text-white">
                Mais foco e acompanhamento
              </p>
              <p className="mt-2 text-xs leading-6 text-slate-400">
                Com ajuda pratica para ajustar e concluir.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                Arquivos
              </p>
              <p className="mt-2 text-sm font-semibold text-white">
                Imagens, PDFs e ZIPs
              </p>
              <p className="mt-2 text-xs leading-6 text-slate-400">
                Guarde e recupere tudo sem buscas manuais.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              size="lg"
              onClick={onChoosePlan}
              className="h-12 rounded-2xl bg-[linear-gradient(135deg,#10b981,#0f766e)] px-6 text-sm font-semibold text-white shadow-[0_18px_38px_rgba(16,185,129,0.22)] hover:brightness-105 sm:w-auto"
            >
              <Zap className="mr-2 h-4 w-4" />
              Escolher plano
            </Button>

            <Button
              variant="secondary"
              size="lg"
              onClick={onShowBenefits}
              className="h-12 rounded-2xl border-white/10 bg-white/[0.05] px-6 text-sm text-slate-200 hover:bg-white/[0.08] sm:w-auto"
            >
              <ArrowDown className="mr-2 h-4 w-4" />
              Ver o que desbloqueia
            </Button>
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-white/10 bg-black/20 p-4 backdrop-blur-xl sm:p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <ShieldCheck className="h-4 w-4 text-emerald-300" />
            Seu acesso hoje
          </div>

          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                Status
              </p>
              <p
                className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusClassName}`}
              >
                {statusLabel}
              </p>
              <p className="mt-3 text-xs leading-6 text-slate-400">
                {hasPremium
                  ? 'Seu pacote premium ja esta liberado.'
                  : 'Sem plano, voce usa o basico e perde a parte mais poderosa.'}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  WhatsApp gratis hoje
                </p>
                <p className="mt-2 text-2xl font-semibold text-white">
                  {freeQuotaRemaining}/{freeQuotaLimit}
                </p>
                <p className="mt-2 text-xs leading-6 text-slate-400">
                  {freeQuotaEnabled
                    ? 'Sem plano, a IA no WhatsApp fica limitada.'
                    : 'Com premium, essa trava desaparece.'}
                </p>
              </div>

              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Renovacao
                </p>
                <p className="mt-2 text-sm font-semibold text-white">
                  {nextBillingDateLabel}
                </p>
                <p className="mt-2 text-xs leading-6 text-slate-400">
                  Assinatura recorrente com troca ou cancelamento quando quiser.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
