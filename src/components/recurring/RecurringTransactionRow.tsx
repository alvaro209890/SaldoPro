import { formatBRL } from '@/utils/formatBRL';
import { formatDateBR } from '@/utils/date';
import { FREQUENCY_LABELS } from '@/utils/constants';
import type { RecurringTransaction } from '@/types';
import { Pencil, Pause, Play, Clock, ArrowDown, ArrowUp } from 'lucide-react';

interface RecurringTransactionRowProps {
    item: RecurringTransaction;
    categoryName: string;
    onEdit: () => void;
    onToggleActive: () => void;
}

export function RecurringTransactionRow({ item, categoryName, onEdit, onToggleActive }: RecurringTransactionRowProps) {
    const isIncome = item.type === 'income';
    const isActive = item.active;

    const today = new Date().toISOString().split('T')[0];
    const isOverdue = isActive && item.nextDueDate < today;

    return (
        <div
            className={`group flex items-center justify-between p-4 transition-all hover:bg-surface-800/50 ${!isActive ? 'opacity-50' : ''}`}
        >
            <div className="flex items-center gap-4 min-w-0">
                <button
                    onClick={onToggleActive}
                    className={`flex-shrink-0 transition-colors ${isActive ? 'text-indigo-400 hover:text-amber-400' : 'text-gray-500 hover:text-emerald-400'}`}
                    title={isActive ? 'Pausar' : 'Ativar'}
                >
                    {isActive ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                </button>

                <div className="flex flex-col min-w-0 gap-1">
                    <div className="flex items-center gap-2">
                        <p className={`truncate font-medium ${!isActive ? 'text-gray-400' : 'text-gray-200'}`}>
                            {item.description}
                        </p>
                        <span className="flex-shrink-0 inline-flex items-center rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-400">
                            {FREQUENCY_LABELS[item.frequency] || item.frequency}
                        </span>
                        {isOverdue && (
                            <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">
                                <Clock className="h-3 w-3" />
                                Atrasado
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-3 text-sm text-gray-500">
                        <span className="flex items-center gap-1">
                            {isIncome ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                            {categoryName}
                        </span>
                        <span>Prox: {formatDateBR(item.nextDueDate)}</span>
                        {item.endDate && (
                            <span>Ate: {formatDateBR(item.endDate)}</span>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-4">
                <p className={`font-semibold ${!isActive ? 'text-gray-500' : isIncome ? 'text-emerald-400' : 'text-gray-200'}`}>
                    {isIncome ? '+' : '-'}{formatBRL(item.amount)}
                </p>

                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onEdit();
                        }}
                        className="rounded-lg p-1 text-gray-400 hover:bg-surface-700 hover:text-white"
                        title="Editar"
                    >
                        <Pencil className="h-4 w-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}
