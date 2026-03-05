import { useState, useMemo } from 'react';
import { useTransactions } from '@/hooks/useTransactions';
import { useCategories } from '@/hooks/useCategories';
import { getCurrentMonthKey } from '@/utils/date';
import { MonthSelector } from '@/components/MonthSelector';
import { TransactionRow } from '@/components/TransactionRow';
import { TransactionForm } from '@/components/TransactionForm';
import { TransactionFilters } from '@/components/TransactionFilters';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { Button } from '@/components/ui/Button';
import { Plus, SearchX } from 'lucide-react';
import type { Transaction, TransactionFilters as FilterType, TransactionFormData } from '@/types';

const initialFilters: FilterType = {
    search: '',
    type: 'all',
    category: '',
    paymentMethod: '',
    dateFrom: '',
    dateTo: '',
    amountMin: '',
    amountMax: '',
    sortBy: 'date',
    sortOrder: 'desc',
};

export function Transactions() {
    const [monthKey, setMonthKey] = useState(getCurrentMonthKey());
    const [filters, setFilters] = useState<FilterType>(initialFilters);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

    const { transactions, loading: txLoading, add, update, remove } = useTransactions(monthKey);
    const { categories, loading: catLoading } = useCategories();

    const isLoading = txLoading || catLoading;

    const filteredTransactions = useMemo(() => {
        return transactions
            .filter((t) => {
                // Search
                if (
                    filters.search &&
                    !t.description.toLowerCase().includes(filters.search.toLowerCase())
                )
                    return false;
                // Type
                if (filters.type !== 'all' && t.type !== filters.type) return false;
                // Category
                if (filters.category && t.category !== filters.category) return false;
                // Payment Method
                if (filters.paymentMethod && t.paymentMethod !== filters.paymentMethod)
                    return false;
                // Date Form
                if (filters.dateFrom && t.date < filters.dateFrom) return false;
                // Date To
                if (filters.dateTo && t.date > filters.dateTo) return false;
                // Amount Min
                if (filters.amountMin && t.amount < Number(filters.amountMin)) return false;
                // Amount Max
                if (filters.amountMax && t.amount > Number(filters.amountMax)) return false;

                return true;
            })
            .sort((a, b) => {
                const order = filters.sortOrder === 'asc' ? 1 : -1;
                if (filters.sortBy === 'amount') {
                    return (a.amount - b.amount) * order;
                }
                if (filters.sortBy === 'description') {
                    return a.description.localeCompare(b.description) * order;
                }
                // Default: date
                return (new Date(a.date).getTime() - new Date(b.date).getTime()) * order;
            });
    }, [transactions, filters]);

    const handleCreate = () => {
        setEditingTransaction(null);
        setIsModalOpen(true);
    };

    const handleEdit = (transaction: Transaction) => {
        setEditingTransaction(transaction);
        setIsModalOpen(true);
    };

    const handleQuickDelete = async (transaction: Transaction) => {
        const confirmed = window.confirm(`Excluir a transação "${transaction.description}"?`);
        if (!confirmed) {
            return;
        }

        await remove(transaction.id);

        if (editingTransaction?.id === transaction.id) {
            setEditingTransaction(null);
            setIsModalOpen(false);
        }
    };

    const handleSubmit = async (data: TransactionFormData) => {
        if (editingTransaction) {
            await update(editingTransaction.id, data);
        } else {
            await add(data);
        }
    };

    const handleDelete = async () => {
        if (editingTransaction) {
            await remove(editingTransaction.id);
        }
    };

    return (
        <div className="space-y-6 pb-20 animate-fade-in lg:pb-0">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Transações</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Gerencie suas receitas e despesas.
                    </p>
                </div>

                <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-4">
                    <MonthSelector currentMonthKey={monthKey} onChange={setMonthKey} />
                    <Button onClick={handleCreate} className="hidden lg:flex">
                        <Plus className="mr-2 h-4 w-4" />
                        Nova
                    </Button>
                </div>
            </div>

            <TransactionFilters
                filters={filters}
                onChange={setFilters}
                categories={categories}
            />

            <div className="rounded-2xl border border-surface-700/30 bg-[#151921]/40 glass-card">
                {isLoading ? (
                    <div className="divide-y divide-surface-700/30">
                        {[...Array(5)].map((_, i) => (
                            <LoadingSkeleton key={i} variant="row" className="bg-transparent border-none rounded-none" />
                        ))}
                    </div>
                ) : filteredTransactions.length === 0 ? (
                    <div className="p-8">
                        <EmptyState
                            icon={transactions.length === 0 ? Plus : SearchX}
                            title={transactions.length === 0 ? "Nenhuma transação" : "Nenhum resultado"}
                            description={
                                transactions.length === 0
                                    ? "Você ainda não registrou nenhuma transação neste mês."
                                    : "Não encontramos transações com os filtros atuais."
                            }
                            actionLabel={transactions.length === 0 ? "Criar primeira transação" : "Limpar filtros"}
                            onAction={
                                transactions.length === 0
                                    ? handleCreate
                                    : () => setFilters(initialFilters)
                            }
                        />
                    </div>
                ) : (
                    <div className="divide-y divide-surface-700/30 px-3 py-2 sm:px-4">
                        {filteredTransactions.map((t) => (
                            <TransactionRow
                                key={t.id}
                                transaction={t}
                                category={categories.find((c) => c.id === t.category)}
                                onEdit={() => handleEdit(t)}
                                onDelete={() => {
                                    void handleQuickDelete(t);
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Floating Action Button for mobile */}
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
                onDelete={editingTransaction ? handleDelete : undefined}
                initialData={editingTransaction}
                categories={categories}
            />
        </div>
    );
}
