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
    if (isLoading) {
        return (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <LoadingSkeleton variant="card" />
                <LoadingSkeleton variant="card" />
                <LoadingSkeleton variant="card" />
                {budget ? <LoadingSkeleton variant="card" /> : null}
            </div>
        );
    }

    return (
        <div className={`grid grid-cols-1 gap-6 sm:grid-cols-2 ${budget ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
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

            {budget ? (
                <Card
                    title="Orçamento Mensal"
                    value={formatBRL(budget)}
                    subtitle={`${((expense / budget) * 100).toFixed(1)}% utilizado`}
                    icon={Target}
                    iconClassName="bg-purple-500/10 text-purple-500"
                    className="border-purple-500/10"
                />
            ) : null}
        </div>
    );
}
