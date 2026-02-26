import { TrendingUp, TrendingDown, Wallet, Target } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { formatBRL } from '@/utils/formatBRL';

interface DashboardCardsProps {
    isLoading: boolean;
    income: number;
    expense: number;
    balance: number;
    budget?: number; // From UserSettings
}

export function DashboardCards({ isLoading, income, expense, balance, budget }: DashboardCardsProps) {
    const hasBudget = typeof budget === 'number' && budget > 0;
    const budgetUsagePct = hasBudget ? (expense / budget!) * 100 : 0;
    const budgetBarPct = Math.min(100, Math.max(0, budgetUsagePct));
    const isOverBudget = hasBudget && expense > budget!;
    const budgetDiff = hasBudget ? budget! - expense : 0;

    if (isLoading) {
        return (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <LoadingSkeleton variant="card" />
                <LoadingSkeleton variant="card" />
                <LoadingSkeleton variant="card" />
                {hasBudget ? <LoadingSkeleton variant="card" /> : null}
            </div>
        );
    }

    return (
        <div className={`grid grid-cols-1 gap-6 sm:grid-cols-2 ${hasBudget ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
            <Card
                title="Receitas"
                value={formatBRL(income)}
                icon={TrendingUp}
                iconClassName="bg-emerald-500/20 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                className="hover:border-emerald-500/30"
            />

            <Card
                title="Despesas"
                value={formatBRL(expense)}
                icon={TrendingDown}
                iconClassName="bg-rose-500/20 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.3)]"
                className="hover:border-rose-500/30"
            />

            <Card
                title="Saldo"
                value={formatBRL(balance)}
                icon={Wallet}
                iconClassName="bg-indigo-500/20 text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.3)]"
                className="hover:border-indigo-500/30"
            />

            {hasBudget ? (
                <Card
                    title="Orçamento mensal"
                    value={formatBRL(budget!)}
                    subtitle={`${budgetUsagePct.toFixed(1)}% utilizado`}
                    icon={Target}
                    iconClassName={isOverBudget ? 'bg-rose-500/20 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.3)]' : 'bg-fuchsia-500/20 text-fuchsia-400 shadow-[0_0_15px_rgba(217,70,239,0.3)]'}
                    className={isOverBudget ? 'border-rose-500/30 shadow-[0_0_20px_rgba(244,63,94,0.1)]' : 'hover:border-fuchsia-500/30'}
                >
                    <div className="mt-5">
                        <div className="h-2.5 w-full rounded-full bg-surface-800/80 shadow-inner overflow-hidden border border-white/5">
                            <div
                                className={`h-full rounded-full shadow-[0_0_10px_currentColor] transition-all duration-700 ease-out ${isOverBudget ? 'bg-gradient-to-r from-red-500 to-rose-400 text-rose-400' : 'bg-gradient-to-r from-emerald-500 to-teal-400 text-teal-400'}`}
                                style={{ width: `${budgetBarPct}%` }}
                            />
                        </div>
                        <div className={`mt-3 flex justify-between text-xs font-semibold ${isOverBudget ? 'text-rose-400' : 'text-slate-400'}`}>
                            {isOverBudget
                                ? <span>Excedido: {formatBRL(Math.abs(budgetDiff))}</span>
                                : <span>Restante: {formatBRL(budgetDiff)}</span>}
                        </div>
                    </div>
                </Card>
            ) : null}
        </div>
    );
}
