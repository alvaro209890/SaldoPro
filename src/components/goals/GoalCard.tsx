import { useState } from 'react';
import { Check, Trash2, Target, Clock, Sparkles, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { Goal } from '@/types';

interface GoalCardProps {
    goal: Goal;
    onUpdate: (goalId: string, data: Partial<Omit<Goal, 'id' | 'createdAt'>>) => Promise<void>;
    onDelete: (goalId: string) => Promise<void>;
}

const PRIORITY_STYLES = {
    high: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20', label: 'Alta' },
    medium: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', label: 'Média' },
    low: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', label: 'Baixa' },
};

const STATUS_STYLES = {
    active: { bg: 'bg-indigo-500/10', text: 'text-indigo-400', label: 'Ativa' },
    completed: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', label: 'Concluída' },
    cancelled: { bg: 'bg-gray-500/10', text: 'text-gray-400', label: 'Cancelada' },
};

function formatCurrency(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(dateStr: string): string {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

export function GoalCard({ goal, onUpdate, onDelete }: GoalCardProps) {
    const [expanded, setExpanded] = useState(false);
    const [editingProgress, setEditingProgress] = useState(false);
    const [progressValue, setProgressValue] = useState(String(goal.currentAmount));

    const priority = PRIORITY_STYLES[goal.priority];
    const status = STATUS_STYLES[goal.status];
    const progress = goal.targetAmount && goal.targetAmount > 0
        ? Math.min(100, (goal.currentAmount / goal.targetAmount) * 100)
        : null;

    const handleComplete = async () => {
        await onUpdate(goal.id, { status: goal.status === 'completed' ? 'active' : 'completed' });
    };

    const handleSaveProgress = async () => {
        const val = parseFloat(progressValue);
        if (isNaN(val) || val < 0) return;
        await onUpdate(goal.id, { currentAmount: val });
        setEditingProgress(false);
    };

    const isInactive = goal.status !== 'active';

    return (
        <div className={`group rounded-2xl border bg-surface-900/50 backdrop-blur transition-all duration-200 hover:border-surface-600 ${isInactive ? 'opacity-60 border-surface-800' : 'border-surface-700'}`}>
            <div className="p-5">
                {/* Header */}
                <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                            {goal.source === 'ai' && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 text-[10px] font-medium text-indigo-400 uppercase tracking-wide">
                                    <Sparkles className="h-2.5 w-2.5" />
                                    IA
                                </span>
                            )}
                            <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${priority.bg} ${priority.text} ${priority.border}`}>
                                {priority.label}
                            </span>
                            <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${status.bg} ${status.text}`}>
                                {status.label}
                            </span>
                        </div>
                        <h3 className={`font-semibold text-white text-sm leading-snug ${isInactive ? 'line-through' : ''}`}>
                            {goal.title}
                        </h3>
                    </div>

                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="rounded-lg p-1.5 text-gray-500 hover:bg-surface-800 hover:text-gray-300 transition-colors shrink-0"
                    >
                        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                </div>

                {/* Progress bar */}
                {progress !== null && (
                    <div className="mb-3">
                        <div className="flex items-center justify-between text-xs mb-1.5">
                            <span className="text-gray-400">
                                {formatCurrency(goal.currentAmount)} / {formatCurrency(goal.targetAmount!)}
                            </span>
                            <span className={`font-medium ${progress >= 100 ? 'text-emerald-400' : progress >= 50 ? 'text-amber-400' : 'text-indigo-400'}`}>
                                {progress.toFixed(0)}%
                            </span>
                        </div>
                        <div className="h-2 rounded-full bg-surface-800 overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-700 ease-out ${progress >= 100 ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' : progress >= 50 ? 'bg-gradient-to-r from-amber-500 to-amber-400' : 'bg-gradient-to-r from-indigo-500 to-indigo-400'}`}
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    </div>
                )}

                {/* Meta info */}
                <div className="flex items-center gap-3 text-xs text-gray-500">
                    {goal.deadline && (
                        <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDate(goal.deadline)}
                        </span>
                    )}
                    {goal.targetAmount && !progress && (
                        <span className="inline-flex items-center gap-1">
                            <Target className="h-3 w-3" />
                            {formatCurrency(goal.targetAmount)}
                        </span>
                    )}
                </div>
            </div>

            {/* Expanded content */}
            {expanded && (
                <div className="border-t border-surface-700 p-5 animate-fade-in">
                    {goal.description && (
                        <p className="text-sm text-gray-400 mb-4 leading-relaxed">{goal.description}</p>
                    )}

                    {/* Edit progress */}
                    {goal.targetAmount && goal.status === 'active' && (
                        <div className="mb-4">
                            {editingProgress ? (
                                <div className="flex items-center gap-2">
                                    <div className="relative flex-1">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">R$</span>
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            value={progressValue}
                                            onChange={(e) => setProgressValue(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveProgress(); }}
                                            className="w-full rounded-lg border border-surface-700 bg-surface-800 pl-8 pr-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                                            autoFocus
                                        />
                                    </div>
                                    <Button size="sm" onClick={handleSaveProgress}>Salvar</Button>
                                    <Button size="sm" variant="ghost" onClick={() => setEditingProgress(false)}>Cancelar</Button>
                                </div>
                            ) : (
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => {
                                        setProgressValue(String(goal.currentAmount));
                                        setEditingProgress(true);
                                    }}
                                    className="w-full"
                                >
                                    <TrendingUp className="mr-2 h-3.5 w-3.5" />
                                    Atualizar progresso
                                </Button>
                            )}
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            variant={goal.status === 'completed' ? 'secondary' : 'primary'}
                            onClick={handleComplete}
                            className="flex-1"
                        >
                            <Check className="mr-1.5 h-3.5 w-3.5" />
                            {goal.status === 'completed' ? 'Reativar' : 'Concluir'}
                        </Button>
                        <Button
                            size="sm"
                            variant="danger"
                            onClick={() => onDelete(goal.id)}
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
