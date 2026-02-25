import { Link } from 'react-router-dom';
import { ArrowRight, ListOrdered } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { TransactionRow } from './TransactionRow';
import type { Transaction, Category } from '@/types';

interface RecentTransactionsProps {
    transactions: Transaction[];
    categories: Category[];
    onEdit: (transaction: Transaction) => void;
}

export function RecentTransactions({
    transactions,
    categories,
    onEdit,
}: RecentTransactionsProps) {
    const recent = transactions.slice(0, 5);

    return (
        <Card
            title="Transações Recentes"
            icon={ListOrdered}
            className="h-full flex flex-col"
        >
            <div className="mt-4 flex-1 flex flex-col">
                {recent.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center py-8">
                        <EmptyState
                            icon={ListOrdered}
                            title="Nenhuma transação"
                            description="Suas últimas transações aparecerão aqui."
                            className="border-none bg-transparent shadow-none"
                        />
                    </div>
                ) : (
                    <div className="space-y-1">
                        {recent.map((t) => (
                            <TransactionRow
                                key={t.id}
                                transaction={t}
                                category={categories.find((c) => c.id === t.category)}
                                onEdit={() => onEdit(t)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {transactions.length > 5 && (
                <div className="mt-6 pt-4 border-t border-surface-800">
                    <Link
                        to="/app/transactions"
                        className="flex items-center justify-center gap-2 text-sm font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                        Ver todas as transações
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                </div>
            )}
        </Card>
    );
}
