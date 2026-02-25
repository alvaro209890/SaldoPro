import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTransactions } from '@/hooks/useTransactions';
import { useCategories } from '@/hooks/useCategories';
import { getCurrentMonthKey, getMonthLabel } from '@/utils/date';
import { formatBRL } from '@/utils/formatBRL';
import { MonthSelector } from '@/components/MonthSelector';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Download, PieChart, TrendingDown, TrendingUp, Tags, CreditCard, LayoutList, Plus } from 'lucide-react';
import { PAYMENT_METHOD_LABELS, ICON_MAP, type IconName } from '@/utils/constants';

export function Reports() {
    const navigate = useNavigate();
    const [monthKey, setMonthKey] = useState(getCurrentMonthKey());
    const { transactions, loading: txLoading } = useTransactions(monthKey);
    const { categories, loading: catLoading } = useCategories();

    const isLoading = txLoading || catLoading;

    const categoryById = useMemo(() => {
        return new Map(categories.map((c) => [c.id, c]));
    }, [categories]);

    const summary = useMemo(() => {
        let income = 0;
        let expense = 0;
        let incomeCount = 0;
        let expenseCount = 0;

        for (const t of transactions) {
            if (t.type === 'income') {
                income += t.amount;
                incomeCount += 1;
            } else {
                expense += t.amount;
                expenseCount += 1;
            }
        }

        return { income, expense, incomeCount, expenseCount, balance: income - expense };
    }, [transactions]);

    const categoryStats = useMemo(() => {
        const expenses = transactions.filter((t) => t.type === 'expense');
        const total = expenses.reduce((acc, t) => acc + t.amount, 0);

        const stats = expenses.reduce((acc, t) => {
            if (!acc[t.category]) acc[t.category] = { amount: 0, count: 0 };
            acc[t.category].amount += t.amount;
            acc[t.category].count += 1;
            return acc;
        }, {} as Record<string, { amount: number; count: number }>);

        return Object.entries(stats)
            .map(([categoryId, data]) => {
                const category = categoryById.get(categoryId);
                return {
                    id: categoryId,
                    name: category?.name || 'Sem categoria',
                    color: category?.color || '#6b7280',
                    iconName: category?.icon as IconName | undefined,
                    amount: data.amount,
                    count: data.count,
                    percentage: total > 0 ? (data.amount / total) * 100 : 0,
                };
            })
            .sort((a, b) => b.amount - a.amount);
    }, [transactions, categoryById]);

    const paymentStats = useMemo(() => {
        const expenses = transactions.filter((t) => t.type === 'expense');
        const stats = expenses.reduce((acc, t) => {
            if (!acc[t.paymentMethod]) acc[t.paymentMethod] = { amount: 0, count: 0 };
            acc[t.paymentMethod].amount += t.amount;
            acc[t.paymentMethod].count += 1;
            return acc;
        }, {} as Record<string, { amount: number; count: number }>);

        return Object.entries(stats)
            .map(([method, data]) => ({
                method,
                label: PAYMENT_METHOD_LABELS[method] || method,
                ...data,
            }))
            .sort((a, b) => b.amount - a.amount);
    }, [transactions]);

    const topTransactions = useMemo(() => {
        return [...transactions]
            .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
            .slice(0, 8)
            .map((t) => ({
                ...t,
                categoryName: categoryById.get(t.category)?.name || 'Sem categoria',
                categoryColor: categoryById.get(t.category)?.color || '#6b7280',
            }));
    }, [transactions, categoryById]);

    const exportCSV = () => {
        const delimiter = ';';
        const headers = ['Data', 'Tipo', 'Categoria', 'Descrição', 'Valor', 'Método de pagamento'];

        const escapeCSV = (value: string) => {
            const needsQuotes = value.includes('"') || value.includes('\n') || value.includes(delimiter);
            const escaped = value.replace(/"/g, '""');
            return needsQuotes ? `"${escaped}"` : escaped;
        };

        const rows = transactions.map((t) => {
            const category = categoryById.get(t.category)?.name || 'Sem categoria';
            const type = t.type === 'income' ? 'Receita' : 'Despesa';
            const payment = PAYMENT_METHOD_LABELS[t.paymentMethod] || t.paymentMethod;
            const amount = t.amount.toString().replace('.', ',');

            return [t.date, type, category, t.description, amount, payment].map(escapeCSV).join(delimiter);
        });

        const csvContent = `\uFEFF${[headers.map(escapeCSV).join(delimiter), ...rows].join('\n')}`;
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', `saldopro-${monthKey}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    if (isLoading) {
        return (
            <div className="space-y-6 animate-fade-in">
                <LoadingSkeleton variant="text" className="w-48 h-8" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <LoadingSkeleton variant="card" />
                    <LoadingSkeleton variant="card" />
                    <LoadingSkeleton variant="card" />
                </div>
                <LoadingSkeleton variant="card" className="h-[400px]" />
            </div>
        );
    }

    return (
        <div className="space-y-6 pb-20 lg:pb-0 animate-fade-in">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Relatórios</h1>
                    <p className="text-sm text-gray-400 mt-1">Análise detalhada das suas finanças.</p>
                </div>

                <div className="flex items-center gap-4">
                    <MonthSelector currentMonthKey={monthKey} onChange={setMonthKey} />
                    <Button
                        onClick={exportCSV}
                        variant="secondary"
                        className="hidden lg:flex"
                        disabled={transactions.length === 0}
                    >
                        <Download className="mr-2 h-4 w-4" />
                        CSV
                    </Button>
                </div>
            </div>

            {transactions.length === 0 ? (
                <EmptyState
                    icon={PieChart}
                    title="Sem dados suficientes"
                    description={`Você não tem transações registradas em ${getMonthLabel(monthKey)} para gerar relatórios.`}
                    actionLabel="Adicionar transação"
                    onAction={() => navigate('/app/transactions')}
                />
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                        <Card
                            title="Receitas"
                            value={formatBRL(summary.income)}
                            icon={TrendingUp}
                            className="border-t-4 border-t-emerald-500"
                            subtitle={`${summary.incomeCount} lançamento${summary.incomeCount === 1 ? '' : 's'}`}
                        />
                        <Card
                            title="Despesas"
                            value={formatBRL(summary.expense)}
                            icon={TrendingDown}
                            className="border-t-4 border-t-red-500"
                            subtitle={`${summary.expenseCount} lançamento${summary.expenseCount === 1 ? '' : 's'}`}
                        />
                        <Card
                            title="Saldo"
                            value={formatBRL(summary.balance)}
                            icon={summary.balance >= 0 ? TrendingUp : TrendingDown}
                            className="border-t-4 border-t-indigo-500"
                            subtitle={
                                summary.income > 0
                                    ? `Taxa de economia: ${((summary.balance / summary.income) * 100).toFixed(1)}%`
                                    : undefined
                            }
                        />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="rounded-2xl border border-surface-700 bg-surface-900/50 glass-card overflow-hidden">
                            <div className="p-6 border-b border-surface-800 flex items-center gap-3">
                                <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
                                    <Tags className="w-5 h-5" />
                                </div>
                                <h2 className="text-lg font-semibold text-white">Despesas por Categoria</h2>
                            </div>

                            <div className="p-2 overflow-x-auto">
                                {categoryStats.length === 0 ? (
                                    <div className="p-8 text-center text-gray-400">Nenhuma despesa para analisar.</div>
                                ) : (
                                    <table className="w-full text-left text-sm text-gray-300">
                                        <thead className="text-xs uppercase bg-surface-800/50 text-gray-400">
                                            <tr>
                                                <th className="px-6 py-3 rounded-tl-lg w-full">Categoria</th>
                                                <th className="px-6 py-3 text-right whitespace-nowrap">Qtd</th>
                                                <th className="px-6 py-3 rounded-tr-lg text-right whitespace-nowrap">Valor</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {categoryStats.map((stat) => {
                                                const Icon = stat.iconName ? ICON_MAP[stat.iconName] : null;
                                                return (
                                                    <tr
                                                        key={stat.id}
                                                        className="border-b border-surface-800 last:border-0 hover:bg-surface-800/30"
                                                    >
                                                        <td className="px-6 py-4">
                                                            <div className="flex items-center gap-3">
                                                                <div
                                                                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                                                                    style={{
                                                                        backgroundColor: `${stat.color}20`,
                                                                        color: stat.color,
                                                                    }}
                                                                >
                                                                    {Icon && <Icon className="w-4 h-4" />}
                                                                </div>
                                                                <span className="font-medium text-gray-200">{stat.name}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4 text-right">{stat.count}</td>
                                                        <td className="px-6 py-4 text-right">
                                                            <div className="flex flex-col items-end gap-1.5">
                                                                <span className="font-medium">{formatBRL(stat.amount)}</span>
                                                                <div className="flex items-center gap-2 text-xs text-gray-400">
                                                                    <span>{stat.percentage.toFixed(1)}%</span>
                                                                    <div className="w-16 h-1.5 bg-surface-700 rounded-full overflow-hidden shrink-0">
                                                                        <div
                                                                            className="h-full rounded-full"
                                                                            style={{
                                                                                width: `${Math.min(100, stat.percentage)}%`,
                                                                                backgroundColor: stat.color,
                                                                            }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>

                        <div className="rounded-2xl border border-surface-700 bg-surface-900/50 glass-card overflow-hidden">
                            <div className="p-6 border-b border-surface-800 flex items-center gap-3">
                                <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
                                    <CreditCard className="w-5 h-5" />
                                </div>
                                <h2 className="text-lg font-semibold text-white">Despesas por Pagamento</h2>
                            </div>

                            <div className="p-2 overflow-x-auto">
                                {paymentStats.length === 0 ? (
                                    <div className="p-8 text-center text-gray-400">Nenhuma despesa para analisar.</div>
                                ) : (
                                    <table className="w-full text-left text-sm text-gray-300">
                                        <thead className="text-xs uppercase bg-surface-800/50 text-gray-400">
                                            <tr>
                                                <th className="px-6 py-3 rounded-tl-lg">Método</th>
                                                <th className="px-6 py-3 text-right">Qtd</th>
                                                <th className="px-6 py-3 rounded-tr-lg text-right">Valor total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {paymentStats.map((stat) => (
                                                <tr
                                                    key={stat.method}
                                                    className="border-b border-surface-800 last:border-0 hover:bg-surface-800/30"
                                                >
                                                    <td className="px-6 py-4">
                                                        <span className="font-medium text-gray-200 bg-surface-800 px-3 py-1 rounded-full border border-surface-700">
                                                            {stat.label}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 text-right">{stat.count}</td>
                                                    <td className="px-6 py-4 text-right font-medium">{formatBRL(stat.amount)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="rounded-2xl border border-surface-700 bg-surface-900/50 glass-card overflow-hidden">
                        <div className="p-6 border-b border-surface-800 flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
                                    <LayoutList className="w-5 h-5" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-semibold text-white">Maiores lançamentos</h2>
                                    <p className="text-sm text-gray-400 mt-0.5">Top 8 por valor absoluto</p>
                                </div>
                            </div>
                            <Button
                                variant="ghost"
                                className="hidden sm:flex"
                                onClick={() => navigate('/app/transactions')}
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                Ver transações
                            </Button>
                        </div>

                        <div className="divide-y divide-surface-800">
                            {topTransactions.map((t) => (
                                <div key={t.id} className="flex items-center justify-between gap-4 px-6 py-4">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div
                                                className="h-2.5 w-2.5 rounded-full shrink-0"
                                                style={{ backgroundColor: t.categoryColor }}
                                            />
                                            <p className="truncate font-medium text-gray-200">{t.description}</p>
                                        </div>
                                        <p className="mt-1 text-xs text-gray-500 truncate">
                                            {t.categoryName} • {t.date}
                                        </p>
                                    </div>
                                    <div
                                        className={`shrink-0 text-right font-semibold ${t.type === 'income' ? 'text-emerald-400' : 'text-gray-200'}`}
                                    >
                                        {t.type === 'income' ? '+' : '-'}
                                        {formatBRL(t.amount)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="lg:hidden mt-8">
                        <Button onClick={exportCSV} className="w-full" disabled={transactions.length === 0}>
                            <Download className="mr-2 h-4 w-4" />
                            Exportar para CSV
                        </Button>
                    </div>
                </>
            )}
        </div>
    );
}
