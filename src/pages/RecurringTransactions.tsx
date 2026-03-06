import { useState, useMemo, useEffect } from 'react';
import { useRecurringTransactions } from '@/hooks/useRecurringTransactions';
import { useCategories } from '@/hooks/useCategories';
import { RecurringTransactionRow } from '@/components/recurring/RecurringTransactionRow';
import { RecurringTransactionForm } from '@/components/recurring/RecurringTransactionForm';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { Button } from '@/components/ui/Button';
import { Plus, Repeat } from 'lucide-react';
import type { RecurringTransaction, RecurringTransactionFormData } from '@/types';

export function RecurringTransactions() {
    const {
        recurringTransactions,
        loading,
        add,
        update,
        remove,
        toggleActive,
        generateOverdueTransactions,
    } = useRecurringTransactions();
    const { categories, loading: catLoading } = useCategories();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<RecurringTransaction | null>(null);

    const isLoading = loading || catLoading;

    // Generate overdue transactions on first load
    useEffect(() => {
        if (!loading) {
            generateOverdueTransactions();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading]);

    const activeItems = useMemo(() => {
        return recurringTransactions.filter((r) => r.active);
    }, [recurringTransactions]);

    const pausedItems = useMemo(() => {
        return recurringTransactions.filter((r) => !r.active);
    }, [recurringTransactions]);

    const handleCreate = () => {
        setEditingItem(null);
        setIsModalOpen(true);
    };

    const handleEdit = (item: RecurringTransaction) => {
        setEditingItem(item);
        setIsModalOpen(true);
    };

    const handleSubmit = async (data: RecurringTransactionFormData) => {
        if (editingItem) {
            await update(editingItem.id, {
                ...data,
                endDate: data.endDate || null,
            });
        } else {
            await add(data);
        }
    };

    const handleDelete = async () => {
        if (editingItem) {
            await remove(editingItem.id);
        }
    };

    const getCategoryName = (categoryId: string) => {
        return categories.find((c) => c.id === categoryId)?.name || categoryId;
    };

    return (
        <div className="space-y-6 pb-20 animate-fade-in lg:pb-0">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Recorrentes</h1>
                    <p className="text-sm text-gray-400 mt-1">
                        Gerencie suas transa\u00e7\u00f5es recorrentes autom\u00e1ticas.
                    </p>
                </div>

                <div className="flex items-center gap-4">
                    <Button onClick={handleCreate} className="hidden lg:flex" autoFocus={false}>
                        <Plus className="mr-2 h-4 w-4" />
                        Nova Recorrente
                    </Button>
                </div>
            </div>

            <div className="rounded-2xl border border-surface-700 bg-surface-900/50 glass-card">
                {isLoading ? (
                    <div className="divide-y divide-surface-800">
                        {[...Array(3)].map((_, i) => (
                            <LoadingSkeleton key={i} variant="row" className="bg-transparent border-none rounded-none" />
                        ))}
                    </div>
                ) : recurringTransactions.length === 0 ? (
                    <div className="p-8">
                        <EmptyState
                            icon={Repeat}
                            title="Nenhuma recorrente"
                            description="Voce nao tem transacoes recorrentes cadastradas. Crie uma para automatizar seus lancamentos fixos."
                            actionLabel="Criar recorrente"
                            onAction={handleCreate}
                        />
                    </div>
                ) : (
                    <>
                        {activeItems.length > 0 && (
                            <div className="mb-4">
                                <h3 className="px-4 pb-2 pt-4 text-xs font-semibold uppercase tracking-wider text-gray-400 sm:px-5">
                                    Ativas
                                </h3>
                                <div className="divide-y divide-surface-800">
                                    {activeItems.map((item) => (
                                        <RecurringTransactionRow
                                            key={item.id}
                                            item={item}
                                            categoryName={getCategoryName(item.category)}
                                            onEdit={() => handleEdit(item)}
                                            onToggleActive={() => toggleActive(item)}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        {pausedItems.length > 0 && (
                            <div>
                                <h3 className="px-4 pb-2 pt-6 text-xs font-semibold uppercase tracking-wider text-gray-400 sm:px-5">
                                    Pausadas
                                </h3>
                                <div className="divide-y divide-surface-800">
                                    {pausedItems.map((item) => (
                                        <RecurringTransactionRow
                                            key={item.id}
                                            item={item}
                                            categoryName={getCategoryName(item.category)}
                                            onEdit={() => handleEdit(item)}
                                            onToggleActive={() => toggleActive(item)}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Floating Action Button for mobile */}
            <button
                onClick={handleCreate}
                className="fixed bottom-6 right-6 lg:hidden z-40 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 transition-transform active:scale-95"
            >
                <Plus className="h-6 w-6" />
            </button>

            <RecurringTransactionForm
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSubmit={handleSubmit}
                onDelete={editingItem ? handleDelete : undefined}
                initialData={editingItem}
                categories={categories}
            />
        </div>
    );
}
