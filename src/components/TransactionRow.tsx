import { MoreVertical, Edit2, Trash2 } from 'lucide-react';
import { formatBRL } from '@/utils/formatBRL';
import { formatDateBR } from '@/utils/date';
import { PAYMENT_METHOD_LABELS } from '@/utils/constants';
import { Badge } from '@/components/ui/Badge';
import { ICON_MAP, type IconName } from '@/utils/constants';
import type { Transaction, Category } from '@/types';
import { useState, useRef, useEffect } from 'react';

interface TransactionRowProps {
    transaction: Transaction;
    category?: Category;
    onEdit: () => void;
    onDelete?: () => void;
    showDate?: boolean;
}

export function TransactionRow({
    transaction,
    category,
    onEdit,
    onDelete,
    showDate = true,
}: TransactionRowProps) {
    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const isIncome = transaction.type === 'income';
    const IconComponent = category ? ICON_MAP[category.icon as IconName] : null;

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setShowMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="group flex items-center justify-between gap-4 rounded-xl border border-transparent p-3 transition-colors hover:border-surface-700 hover:bg-surface-800/50">
            <div className="flex items-center gap-4 min-w-0">
                <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                    style={{
                        backgroundColor: category ? `${category.color}20` : '#33415520',
                        color: category?.color || '#94a3b8',
                    }}
                >
                    {IconComponent && <IconComponent className="h-5 w-5" />}
                </div>

                <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-gray-200">{transaction.description}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className="truncate">{category?.name || 'Sem categoria'}</span>
                        {showDate && (
                            <>
                                <span>•</span>
                                <span>{formatDateBR(transaction.date)}</span>
                            </>
                        )}
                        <span className="hidden sm:inline">•</span>
                        <span className="hidden sm:inline">{PAYMENT_METHOD_LABELS[transaction.paymentMethod] || transaction.paymentMethod}</span>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-4 shrink-0">
                <div className="text-right">
                    <p
                        className={`font-semibold ${isIncome ? 'text-emerald-400' : 'text-gray-200'
                            }`}
                    >
                        {isIncome ? '+' : '-'}{formatBRL(transaction.amount)}
                    </p>
                    <Badge variant="default" className="mt-1 hidden sm:inline-flex text-[10px] px-2">
                        {PAYMENT_METHOD_LABELS[transaction.paymentMethod] || 'Outro'}
                    </Badge>
                </div>

                <div className="relative" ref={menuRef}>
                    <button
                        onClick={() => setShowMenu(!showMenu)}
                        className="rounded-lg p-1.5 text-gray-500 opacity-0 transition-all hover:bg-surface-700 hover:text-white group-hover:opacity-100 focus:opacity-100"
                    >
                        <MoreVertical className="h-5 w-5" />
                    </button>

                    {showMenu && (
                        <div className="absolute right-0 top-full mt-1 z-10 w-36 rounded-xl border border-surface-700 bg-surface-900 shadow-xl overflow-hidden animate-scale-in">
                            <button
                                onClick={() => {
                                    setShowMenu(false);
                                    onEdit();
                                }}
                                className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:bg-surface-800 transition-colors"
                            >
                                <Edit2 className="h-4 w-4" />
                                Editar
                            </button>
                            {onDelete && (
                                <button
                                    onClick={() => {
                                        setShowMenu(false);
                                        onDelete();
                                    }}
                                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                                >
                                    <Trash2 className="h-4 w-4" />
                                    Excluir
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
