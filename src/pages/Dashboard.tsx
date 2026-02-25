import { useState } from 'react';
import { useTransactions } from '@/hooks/useTransactions';
import { useCategories } from '@/hooks/useCategories';
import { useSettings } from '@/hooks/useSettings';
import { getCurrentMonthKey } from '@/utils/date';
import { useAuth } from '@/hooks/useAuth';
import { MonthSelector } from '@/components/MonthSelector';
import { DashboardCards } from '@/components/DashboardCards';
import { ExpensePieChart } from '@/components/ExpensePieChart';
import { BalanceLineChart } from '@/components/BalanceLineChart';
import { RecentTransactions } from '@/components/RecentTransactions';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';

// Placeholder for TransactionForm modal component that will be built in Batch 9
const TransactionFormModal = ({ isOpen, onClose, transactionToEdit }: any) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-surface-900 p-6 rounded-xl border border-surface-700 w-full max-w-md">
                <h2 className="text-xl font-bold mb-4 text-white">Transação</h2>
                <p className="text-gray-400 mb-6">Formulário será implementado no Batch 9.</p>
                <Button onClick={onClose} className="w-full">Fechar</Button>
            </div>
        </div>
    );
};

export function Dashboard() {
    const { displayName } = useAuth();
    const [monthKey, setMonthKey] = useState(getCurrentMonthKey());
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [transactionToEdit, setTransactionToEdit] = useState<any>(null);

    const { transactions, loading: txLoading } = useTransactions(monthKey);
    const { categories, loading: catLoading } = useCategories();
    const { settings, loading: setLoading } = useSettings();

    const isLoading = txLoading || catLoading || setLoading;

    // Calculate aggregates
    const income = transactions
        .filter((t) => t.type === 'income')
        .reduce((acc, curr) => acc + curr.amount, 0);

    const expense = transactions
        .filter((t) => t.type === 'expense')
        .reduce((acc, curr) => acc + curr.amount, 0);

    const balance = income - expense;

    const handleEdit = (transaction: any) => {
        setTransactionToEdit(transaction);
        setIsModalOpen(true);
    };

    const handleCreate = () => {
        setTransactionToEdit(null);
        setIsModalOpen(true);
    };

    return (
        <div className="space-y-6 pb-20 lg:pb-0 animate-fade-in">
            {/* Header sections */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">
                        Olá, {displayName?.split(' ')[0] || 'Usuário'}! 👋
                    </h1>
                    <p className="text-sm text-gray-400 mt-1">
                        Aqui está o resumo financeiro do seu mês.
                    </p>
                </div>

                <div className="flex items-center gap-4">
                    <MonthSelector currentMonthKey={monthKey} onChange={setMonthKey} />
                    <Button onClick={handleCreate} className="hidden lg:flex">
                        <Plus className="mr-2 h-4 w-4" />
                        Nova Transação
                    </Button>
                </div>
            </div>

            {/* Aggregate Cards */}
            <DashboardCards
                isLoading={isLoading}
                income={income}
                expense={expense}
                balance={balance}
                budget={settings?.budget}
            />

            {/* Charts List area */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <BalanceLineChart transactions={transactions} monthKey={monthKey} />
                <ExpensePieChart transactions={transactions} categories={categories} />
            </div>

            {/* Recent Transactions List */}
            <div className="grid grid-cols-1 gap-6">
                <RecentTransactions
                    transactions={transactions}
                    categories={categories}
                    onEdit={handleEdit}
                />
            </div>

            {/* Floating Action Button for mobile */}
            <button
                onClick={handleCreate}
                className="fixed bottom-6 right-6 lg:hidden z-40 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 transition-transform active:scale-95"
            >
                <Plus className="h-6 w-6" />
            </button>

            {/* Transaction Modal Placeholder */}
            <TransactionFormModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                transactionToEdit={transactionToEdit}
            />
        </div>
    );
}
