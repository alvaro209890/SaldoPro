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
                iconClassName="bg-emerald-500/10 text-emerald-500"
                className="border-emerald-500/10"
            />

            <Card
                title="Despesas"
                value={formatBRL(expense)}
                icon={TrendingDown}
                iconClassName="bg-red-500/10 text-red-500"
                className="border-red-500/10"
            />

            <Card
                title="Saldo"
                value={formatBRL(balance)}
                icon={Wallet}
                iconClassName="bg-indigo-500/10 text-indigo-500"
                className="border-indigo-500/10"
            />

            {hasBudget ? (
                <Card
                    title="Orçamento mensal"
                    value={formatBRL(budget!)}
                    subtitle={`${budgetUsagePct.toFixed(1)}% utilizado`}
                    icon={Target}
                    iconClassName={isOverBudget ? 'bg-red-500/10 text-red-500' : 'bg-purple-500/10 text-purple-500'}
                    className={isOverBudget ? 'border-red-500/20' : 'border-purple-500/10'}
                >
                    <div className="mt-4">
                        <div className="h-2 w-full rounded-full bg-surface-800 overflow-hidden">
                            <div
                                className={`h-full rounded-full ${isOverBudget ? 'bg-red-500' : 'bg-emerald-500'}`}
                                style={{ width: `${budgetBarPct}%` }}
                            />
                        </div>
                        <div className={`mt-2 text-xs ${isOverBudget ? 'text-red-400' : 'text-gray-500'}`}>
                            {isOverBudget
                                ? `Excedido: ${formatBRL(Math.abs(budgetDiff))}`
                                : `Restante: ${formatBRL(budgetDiff)}`}
                        </div>
                    </div>
                </Card>
            ) : null}
        </div>
    );
}
