import { MoreVertical, Edit2, Trash2 } from 'lucide-react';
import { formatBRL } from '@/utils/formatBRL';
import { formatDateBR } from '@/utils/date';
import { PAYMENT_METHOD_LABELS } from '@/utils/constants';
import { Badge } from '@/components/ui/Badge';
import { ICON_MAP, type IconName } from '@/utils/constants';
import type { Transaction, Category } from '@/types';
import { useState, useRef, useEffect, type KeyboardEvent } from 'react';

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

    const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        event.preventDefault();
        onEdit();
    };

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onEdit}
            onKeyDown={handleRowKeyDown}
            className={`group flex cursor-pointer flex-col justify-between gap-3 rounded-xl border bg-[#151921]/30 p-3 text-left transition-all duration-300 hover:bg-[#151921]/70 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-finance-primary/60 sm:flex-row sm:items-center sm:gap-4 sm:p-3.5 ${isIncome
                    ? 'border-finance-income/[0.06] hover:border-finance-income/15'
                    : 'border-white/[0.03] hover:border-white/[0.08]'
                }`}
        >
            {/* Left accent bar (mobile) */}
            <div className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl sm:hidden ${isIncome ? 'bg-finance-income/40' : 'bg-finance-expense/30'}`} />

            <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-inner border border-white/[0.04]"
                    style={{
                        backgroundColor: category ? `${category.color}15` : '#2A304020',
                        color: category?.color || '#94a3b8',
                        boxShadow: `inset 0 0 10px ${category ? category.color : '#2A3040'}10`
                    }}
                >
                    {IconComponent && <IconComponent className="h-5 w-5" />}
                </div>

                <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-gray-100">{transaction.description}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-gray-500">
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

            <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end sm:gap-4">
                <div className="flex min-w-0 flex-1 flex-row items-center gap-3 text-left sm:flex-none sm:flex-col sm:items-end sm:gap-1 sm:text-right">
                    <p
                        className={`font-extrabold tracking-tight ${isIncome ? 'text-finance-income drop-shadow-[0_0_8px_rgba(0,201,167,0.25)]' : 'text-gray-100'
                            }`}
                    >
                        {isIncome ? '+' : '-'}{formatBRL(transaction.amount)}
                    </p>
                    <Badge variant="default" className="sm:mt-1 border border-white/[0.04] bg-surface-800/80 text-[10px] px-2 py-0.5 shadow-sm">
                        {PAYMENT_METHOD_LABELS[transaction.paymentMethod] || 'Outro'}
                    </Badge>
                </div>

                <div className="relative" ref={menuRef}>
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            setShowMenu(!showMenu);
                        }}
                        className="rounded-lg p-1.5 text-gray-500 opacity-100 sm:opacity-0 sm:transition-all sm:hover:bg-white/[0.06] sm:hover:text-white sm:group-hover:opacity-100"
                    >
                        <MoreVertical className="h-5 w-5" />
                    </button>

                    {showMenu && (
                        <div className="absolute right-0 top-full mt-1 z-20 w-36 rounded-xl border border-white/[0.06] bg-[#151921]/95 backdrop-blur-xl shadow-2xl overflow-hidden animate-scale-in">
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setShowMenu(false);
                                    onEdit();
                                }}
                                className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-200 hover:bg-white/[0.06] transition-colors"
                            >
                                <Edit2 className="h-4 w-4" />
                                Editar
                            </button>
                            {onDelete && (
                                <button
                                    type="button"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setShowMenu(false);
                                        onDelete();
                                    }}
                                    className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium text-finance-expense hover:bg-finance-expense/10 transition-colors"
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
