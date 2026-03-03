import { ArrowRight, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { BillingPlan } from '@/services/billing';

interface MobileCheckoutBarProps {
  selectedPlan: BillingPlan | null;
  visible: boolean;
  onContinue: () => void;
}

export function MobileCheckoutBar({
  selectedPlan,
  visible,
  onContinue,
}: MobileCheckoutBarProps) {
  if (!visible || !selectedPlan) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-slate-950/95 px-4 py-3 backdrop-blur-xl xl:hidden">
      <div className="mx-auto flex max-w-5xl items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">
            {selectedPlan.name}
          </p>
          <p className="text-xs text-emerald-200">{selectedPlan.priceFormatted}</p>
        </div>

        <Button
          size="lg"
          onClick={onContinue}
          className="h-11 rounded-2xl bg-[linear-gradient(135deg,#10b981,#0f766e)] px-4 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(16,185,129,0.22)] hover:brightness-105"
        >
          <CreditCard className="mr-2 h-4 w-4" />
          Continuar
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
