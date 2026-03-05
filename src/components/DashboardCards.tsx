import { TrendingUp, TrendingDown, Wallet, Target } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { Sparkline } from '@/components/ui/Sparkline';
import { formatBRL } from '@/utils/formatBRL';

interface DashboardCardsProps {
    isLoading: boolean;
    income: number;
    expense: number;
    balance: number;
    budget?: number;
    incomeTrend?: number[];
    expenseTrend?: number[];
    balanceTrend?: number[];
}

export function DashboardCards({ isLoading, income, expense, balance, budget, incomeTrend, expenseTrend, balanceTrend }: DashboardCardsProps) {
    const hasBudget = typeof budget === 'number' && budget > 0;
    const budgetUsagePct = hasBudget ? (expense / budget!) * 100 : 0;
    const budgetBarPct = Math.min(100, Math.max(0, budgetUsagePct));
    const isOverBudget = hasBudget && expense > budget!;
    const budgetDiff = hasBudget ? budget! - expense : 0;

    if (isLoading) {
        return (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                <LoadingSkeleton variant="card" />
                <LoadingSkeleton variant="card" />
                <LoadingSkeleton variant="card" />
                {hasBudget ? <LoadingSkeleton variant="card" /> : null}
            </div>
        );
    }

    return (
        <div className={`grid grid-cols-1 gap-5 sm:grid-cols-2 ${hasBudget ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
            <Card
                title="Receitas"
                value={formatBRL(income)}
                icon={TrendingUp}
                iconClassName="bg-finance-income/15 text-finance-income shadow-[0_0_20px_rgba(0,201,167,0.2)]"
                className="hover:border-finance-income/20"
                sparkline={incomeTrend && incomeTrend.length >= 2 ? <Sparkline data={incomeTrend} color="#00C9A7" /> : undefined}
            />

            <Card
                title="Despesas"
                value={formatBRL(expense)}
                icon={TrendingDown}
                iconClassName="bg-finance-expense/15 text-finance-expense shadow-[0_0_20px_rgba(255,107,107,0.2)]"
                className="hover:border-finance-expense/20"
                sparkline={expenseTrend && expenseTrend.length >= 2 ? <Sparkline data={expenseTrend} color="#FF6B6B" /> : undefined}
            />

            <Card
                title="Saldo"
                value={formatBRL(balance)}
                icon={Wallet}
                iconClassName="bg-finance-primary/15 text-finance-primary-light shadow-[0_0_20px_rgba(124,58,237,0.2)]"
                className="hover:border-finance-primary/20"
                sparkline={balanceTrend && balanceTrend.length >= 2 ? <Sparkline data={balanceTrend} color="#7C3AED" /> : undefined}
            />

            {hasBudget ? (
                <Card
                    title="Orçamento mensal"
                    value={formatBRL(budget!)}
                    subtitle={`${budgetUsagePct.toFixed(1)}% utilizado`}
                    icon={Target}
                    iconClassName={isOverBudget ? 'bg-finance-expense/15 text-finance-expense shadow-[0_0_20px_rgba(255,107,107,0.2)]' : 'bg-fuchsia-500/15 text-fuchsia-400 shadow-[0_0_20px_rgba(217,70,239,0.2)]'}
                    className={isOverBudget ? 'border-finance-expense/20 shadow-[0_0_20px_rgba(255,107,107,0.06)]' : 'hover:border-fuchsia-500/20'}
                >
                    <div className="mt-5">
                        <div className="h-2.5 w-full rounded-full bg-surface-800/80 shadow-inner overflow-hidden border border-white/[0.04]">
                            <div
                                className={`h-full rounded-full shadow-[0_0_10px_currentColor] transition-all duration-700 ease-out ${isOverBudget ? 'bg-gradient-to-r from-finance-expense to-rose-400 text-rose-400' : 'bg-gradient-to-r from-finance-income to-teal-400 text-teal-400'}`}
                                style={{ width: `${budgetBarPct}%` }}
                            />
                        </div>
                        <div className={`mt-3 flex justify-between text-xs font-semibold ${isOverBudget ? 'text-finance-expense' : 'text-slate-400'}`}>
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
