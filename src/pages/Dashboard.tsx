import { useEffect, useMemo, useState } from 'react';
import { useTransactions } from '@/hooks/useTransactions';
import { useRecurringTransactions } from '@/hooks/useRecurringTransactions';
import { useCategories } from '@/hooks/useCategories';
import { useSettings } from '@/hooks/useSettings';
import { getCurrentMonthKey } from '@/utils/date';
import { useAuth } from '@/hooks/useAuth';
import { MonthSelector } from '@/components/MonthSelector';
import { DashboardCards } from '@/components/DashboardCards';
import { ExpensePieChart } from '@/components/ExpensePieChart';
import { BalanceLineChart } from '@/components/BalanceLineChart';
import { RecentTransactions } from '@/components/RecentTransactions';
import { TransactionForm } from '@/components/TransactionForm';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { Plus } from 'lucide-react';
import type { Transaction, TransactionFormData } from '@/types';

export function Dashboard() {
    const { displayName } = useAuth();
    const [monthKey, setMonthKey] = useState(getCurrentMonthKey());
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [transactionToEdit, setTransactionToEdit] = useState<Transaction | null>(null);

    const { transactions, loading: txLoading, add, update, remove } = useTransactions(monthKey);
    const { categories, loading: catLoading } = useCategories();
    const { settings, loading: setLoading } = useSettings();
    const { generateOverdueTransactions, loading: recurringLoading } = useRecurringTransactions();

    const isLoading = txLoading || catLoading || setLoading;

    // Generate overdue recurring transactions on dashboard load
    useEffect(() => {
        if (!recurringLoading) {
            generateOverdueTransactions();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [recurringLoading]);

    const { income, expense, balance } = useMemo(() => {
        let incomeAcc = 0;
        let expenseAcc = 0;
        for (const t of transactions) {
            if (t.type === 'income') incomeAcc += t.amount;
            else expenseAcc += t.amount;
        }
        return { income: incomeAcc, expense: expenseAcc, balance: incomeAcc - expenseAcc };
    }, [transactions]);

    // Calculate last 7-day trends for sparklines
    const { incomeTrend, expenseTrend, balanceTrend } = useMemo(() => {
        if (transactions.length === 0) return { incomeTrend: [], expenseTrend: [], balanceTrend: [] };

        const today = new Date();
        const days: string[] = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            days.push(d.toISOString().split('T')[0]);
        }

        const dailyInc: number[] = [];
        const dailyExp: number[] = [];
        const dailyBal: number[] = [];

        for (const day of days) {
            let dayIncome = 0;
            let dayExpense = 0;
            for (const t of transactions) {
                if (t.date === day) {
                    if (t.type === 'income') dayIncome += t.amount;
                    else dayExpense += t.amount;
                }
            }
            dailyInc.push(dayIncome);
            dailyExp.push(dayExpense);
            dailyBal.push(dayIncome - dayExpense);
        }

        return { incomeTrend: dailyInc, expenseTrend: dailyExp, balanceTrend: dailyBal };
    }, [transactions]);

    const handleEdit = (transaction: Transaction) => {
        setTransactionToEdit(transaction);
        setIsModalOpen(true);
    };

    const handleCreate = () => {
        setTransactionToEdit(null);
        setIsModalOpen(true);
    };

    const handleSubmit = async (data: TransactionFormData) => {
        if (transactionToEdit) {
            await update(transactionToEdit.id, data);
        } else {
            await add(data);
        }
    };

    const handleDelete = async () => {
        if (transactionToEdit) {
            await remove(transactionToEdit.id);
        }
    };

    const defaultDate = useMemo(() => {
        const today = new Date().toISOString().split('T')[0];
        return monthKey === getCurrentMonthKey() ? today : `${monthKey}-01`;
    }, [monthKey]);

    return (
        <div className="space-y-8 pb-20 lg:pb-0 animate-fade-in">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">
                        Olá, <span className="gradient-text-name">{displayName?.split(' ')[0] || 'Usuário'}</span>! 👋
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Aqui está o resumo financeiro do seu mês.
                    </p>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
                    <MonthSelector currentMonthKey={monthKey} onChange={setMonthKey} />
                    <Button onClick={handleCreate} className="hidden lg:flex">
                        <Plus className="mr-2 h-4 w-4" />
                        Nova transação
                    </Button>
                </div>
            </div>

            <DashboardCards
                isLoading={isLoading}
                income={income}
                expense={expense}
                balance={balance}
                budget={settings?.budget}
                incomeTrend={incomeTrend}
                expenseTrend={expenseTrend}
                balanceTrend={balanceTrend}
            />

            {!isLoading && transactions.length === 0 ? (
                <div className="rounded-2xl border border-surface-700/30 bg-[#151921]/40 glass-card p-6">
                    <EmptyState
                        icon={Plus}
                        title="Comece por aqui"
                        description="Registre sua primeira receita ou despesa para ver gráficos e insights neste mês."
                        actionLabel="Criar transação"
                        onAction={handleCreate}
                        className="border-none bg-transparent p-4"
                    />
                </div>
            ) : null}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <BalanceLineChart transactions={transactions} monthKey={monthKey} />
                <ExpensePieChart transactions={transactions} categories={categories} />
            </div>

            <div className="grid grid-cols-1 gap-6">
                <RecentTransactions transactions={transactions} categories={categories} onEdit={handleEdit} />
            </div>

            <button
                onClick={handleCreate}
                className="fixed bottom-6 right-6 lg:hidden z-40 flex h-14 w-14 items-center justify-center rounded-full bg-finance-primary text-white shadow-lg shadow-finance-primary/30 transition-transform active:scale-95"
                aria-label="Nova transação"
            >
                <Plus className="h-6 w-6" />
            </button>

            <TransactionForm
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSubmit={handleSubmit}
                onDelete={transactionToEdit ? handleDelete : undefined}
                initialData={transactionToEdit}
                categories={categories}
                defaultDate={defaultDate}
            />
        </div>
    );
}
