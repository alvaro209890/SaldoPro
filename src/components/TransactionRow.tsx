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
        <div className="group flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-white/5 bg-surface-900/30 p-3.5 transition-all duration-300 hover:border-white/10 hover:bg-surface-800/60 hover:shadow-lg">
            <div className="flex items-center gap-4 min-w-0">
                <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-inner border border-white/5"
                    style={{
                        backgroundColor: category ? `${category.color}20` : '#33415520',
                        color: category?.color || '#94a3b8',
                        boxShadow: `inset 0 0 10px ${category ? category.color : '#334155'}10`
                    }}
                >
                    {IconComponent && <IconComponent className="h-5 w-5" />}
                </div>

                <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-gray-100">{transaction.description}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-400 font-medium mt-0.5">
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

            <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0 sm:w-auto w-full pl-15 sm:pl-0">
                <div className="text-right flex flex-row sm:flex-col items-center sm:items-end gap-3 sm:gap-1">
                    <p
                        className={`font-extrabold tracking-tight ${isIncome ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]' : 'text-gray-100'
                            }`}
                    >
                        {isIncome ? '+' : '-'}{formatBRL(transaction.amount)}
                    </p>
                    <Badge variant="default" className="sm:mt-1 border border-white/5 bg-surface-800/80 text-[10px] px-2 py-0.5 shadow-sm">
                        {PAYMENT_METHOD_LABELS[transaction.paymentMethod] || 'Outro'}
                    </Badge>
                </div>

                <div className="relative" ref={menuRef}>
                    <button
                        onClick={() => setShowMenu(!showMenu)}
                        className="rounded-lg p-1.5 text-gray-500 opacity-100 sm:opacity-0 sm:transition-all sm:hover:bg-surface-700 sm:hover:text-white sm:group-hover:opacity-100"
                    >
                        <MoreVertical className="h-5 w-5" />
                    </button>

                    {showMenu && (
                        <div className="absolute right-0 top-full mt-1 z-20 w-36 rounded-xl border border-white/10 bg-surface-800/95 backdrop-blur-md shadow-2xl overflow-hidden animate-scale-in">
                            <button
                                onClick={() => {
                                    setShowMenu(false);
                                    onEdit();
                                }}
                                className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-200 hover:bg-surface-700/80 transition-colors"
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
                                    className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium text-rose-400 hover:bg-rose-500/10 transition-colors"
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
