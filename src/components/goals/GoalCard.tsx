import { useEffect, useMemo, useState } from 'react';
import {
    AlertCircle,
    Check,
    ChevronDown,
    ChevronUp,
    Clock,
    PauseCircle,
    Pencil,
    Sparkles,
    Target,
    Trash2,
    TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { Goal } from '@/types';
import { formatCurrencyInput, maskCurrencyInput, parseCurrencyInput } from '@/utils/currencyInput';

interface GoalCardProps {
    goal: Goal;
    onUpdate: (goalId: string, data: Partial<Omit<Goal, 'id' | 'createdAt'>>) => Promise<void>;
    onDelete: (goalId: string) => Promise<void>;
    onEdit: (goal: Goal) => void;
}

const PRIORITY_STYLES = {
    high: { chip: 'border-red-500/25 bg-red-500/10 text-red-300', label: 'Alta' },
    medium: { chip: 'border-amber-500/25 bg-amber-500/10 text-amber-300', label: 'Media' },
    low: { chip: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300', label: 'Baixa' },
} as const;

const STATUS_STYLES = {
    active: { chip: 'bg-indigo-500/10 text-indigo-300', label: 'Ativa' },
    completed: { chip: 'bg-emerald-500/10 text-emerald-300', label: 'Concluida' },
    cancelled: { chip: 'bg-slate-500/10 text-slate-300', label: 'Pausada' },
} as const;

function formatCurrency(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(dateStr: string): string {
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
}

function getDeadlineMeta(deadline: string | null): { label: string; urgent: boolean } | null {
    if (!deadline) {
        return null;
    }

    const target = new Date(`${deadline}T12:00:00`);
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const diffInDays = Math.ceil((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

    if (diffInDays < 0) {
        return { label: `Atrasada ha ${Math.abs(diffInDays)} dia${Math.abs(diffInDays) === 1 ? '' : 's'}`, urgent: true };
    }

    if (diffInDays === 0) {
        return { label: 'Vence hoje', urgent: true };
    }

    return {
        label: `Faltam ${diffInDays} dia${diffInDays === 1 ? '' : 's'}`,
        urgent: diffInDays <= 7,
    };
}

export function GoalCard({ goal, onUpdate, onDelete, onEdit }: GoalCardProps) {
    const [expanded, setExpanded] = useState(false);
    const [editingProgress, setEditingProgress] = useState(false);
    const [progressValue, setProgressValue] = useState(
        formatCurrencyInput(goal.currentAmount, { emptyWhenZero: false })
    );

    useEffect(() => {
        setProgressValue(formatCurrencyInput(goal.currentAmount, { emptyWhenZero: false }));
    }, [goal.currentAmount]);

    const priority = PRIORITY_STYLES[goal.priority];
    const status = STATUS_STYLES[goal.status];
    const deadlineMeta = getDeadlineMeta(goal.deadline);

    const targetAmount = typeof goal.targetAmount === 'number' && goal.targetAmount > 0 ? goal.targetAmount : null;
    const progress = targetAmount ? Math.min(100, (goal.currentAmount / targetAmount) * 100) : null;
    const remainingAmount = targetAmount ? Math.max(0, targetAmount - goal.currentAmount) : null;
    const quickIncrements = useMemo(() => {
        if (!targetAmount) {
            return [100, 300];
        }

        const relativeIncrement = Math.max(50, Math.round(targetAmount * 0.1));
        return [...new Set([relativeIncrement, targetAmount >= 5000 ? 500 : 200])];
    }, [targetAmount]);

    const handleCompleteToggle = async () => {
        await onUpdate(goal.id, {
            status: goal.status === 'completed' ? 'active' : 'completed',
        });
    };

    const handlePauseToggle = async () => {
        if (goal.status !== 'active') {
            await onUpdate(goal.id, { status: 'active' });
            return;
        }

        await onUpdate(goal.id, { status: 'cancelled' });
    };

    const handleSaveProgress = async () => {
        const parsedValue = parseCurrencyInput(progressValue);
        if (Number.isNaN(parsedValue) || parsedValue < 0) {
            return;
        }

        await onUpdate(goal.id, { currentAmount: parsedValue });
        setEditingProgress(false);
    };

    const handleQuickProgress = async (increment: number) => {
        await onUpdate(goal.id, { currentAmount: Math.max(0, goal.currentAmount + increment) });
    };

    const handleDelete = async () => {
        const confirmed = window.confirm(`Excluir a meta "${goal.title}"?`);
        if (!confirmed) {
            return;
        }

        await onDelete(goal.id);
    };

    return (
        <div className={`rounded-3xl border bg-surface-900/60 backdrop-blur transition-all duration-300 ${
            goal.status === 'active'
                ? 'border-surface-700 hover:border-indigo-400/30 hover:shadow-[0_20px_50px_-30px_rgba(99,102,241,0.45)]'
                : 'border-surface-800 opacity-80'
        }`}>
            <div className="p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                            {goal.source === 'ai' && (
                                <span className="inline-flex items-center gap-1 rounded-full border border-indigo-400/20 bg-indigo-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-300">
                                    <Sparkles className="h-3 w-3" />
                                    IA
                                </span>
                            )}
                            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${priority.chip}`}>
                                {priority.label}
                            </span>
                            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${status.chip}`}>
                                {status.label}
                            </span>
                        </div>

                        <h3 className={`text-base font-semibold leading-snug text-white ${goal.status !== 'active' ? 'line-through decoration-white/25' : ''}`}>
                            {goal.title}
                        </h3>

                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-400">
                            {goal.deadline && (
                                <span className="inline-flex items-center gap-1.5">
                                    <Clock className="h-3.5 w-3.5" />
                                    {formatDate(goal.deadline)}
                                </span>
                            )}
                            {deadlineMeta && (
                                <span className={`inline-flex items-center gap-1.5 ${deadlineMeta.urgent ? 'text-amber-300' : 'text-gray-400'}`}>
                                    <AlertCircle className="h-3.5 w-3.5" />
                                    {deadlineMeta.label}
                                </span>
                            )}
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={() => setExpanded((current) => !current)}
                        className="rounded-xl border border-white/5 bg-surface-800/70 p-2 text-gray-400 transition-colors hover:text-white"
                    >
                        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                </div>

                <div className="rounded-2xl border border-white/5 bg-surface-950/35 p-4">
                    <div className="mb-2 flex items-center justify-between gap-3 text-xs text-gray-400">
                        <span className="inline-flex items-center gap-1.5">
                            <Target className="h-3.5 w-3.5" />
                            {targetAmount ? `${formatCurrency(goal.currentAmount)} de ${formatCurrency(targetAmount)}` : formatCurrency(goal.currentAmount)}
                        </span>
                        {progress !== null && (
                            <span className={`font-semibold ${
                                progress >= 100 ? 'text-emerald-300' : progress >= 60 ? 'text-amber-300' : 'text-indigo-300'
                            }`}>
                                {progress.toFixed(0)}%
                            </span>
                        )}
                    </div>

                    {progress !== null ? (
                        <>
                            <div className="h-2.5 overflow-hidden rounded-full bg-surface-800">
                                <div
                                    className={`h-full rounded-full transition-all duration-700 ${
                                        progress >= 100
                                            ? 'bg-gradient-to-r from-emerald-500 to-emerald-300'
                                            : progress >= 60
                                                ? 'bg-gradient-to-r from-amber-500 to-orange-300'
                                                : 'bg-gradient-to-r from-indigo-500 to-cyan-300'
                                    }`}
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <div className="mt-2 flex items-center justify-between text-xs">
                                <span className="text-gray-400">
                                    {remainingAmount != null ? `Faltam ${formatCurrency(remainingAmount)}` : 'Sem alvo financeiro'}
                                </span>
                                <span className="text-gray-500">
                                    {progress >= 100 ? 'Pronta para concluir' : goal.status === 'completed' ? 'Ja concluida' : 'Em andamento'}
                                </span>
                            </div>
                        </>
                    ) : (
                        <p className="text-xs text-gray-400">
                            Meta sem valor alvo definido. Use o progresso para acompanhar o quanto ja foi acumulado.
                        </p>
                    )}
                </div>
            </div>

            {expanded && (
                <div className="border-t border-surface-800 px-5 pb-5 pt-4">
                    {goal.description && (
                        <p className="mb-4 text-sm leading-relaxed text-gray-400">{goal.description}</p>
                    )}

                    {goal.status === 'active' && (
                        <div className="mb-4 rounded-2xl border border-white/5 bg-surface-950/30 p-3">
                            <div className="mb-3 flex items-center justify-between gap-2">
                                <p className="text-sm font-medium text-gray-200">Atualizar progresso</p>
                                <p className="text-xs text-gray-500">Ajuste fino ou atalhos</p>
                            </div>

                            {editingProgress ? (
                                <div className="space-y-3">
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">R$</span>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={progressValue}
                                            onChange={(event) => setProgressValue(maskCurrencyInput(event.target.value))}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter') {
                                                    void handleSaveProgress();
                                                }
                                            }}
                                            className="w-full rounded-xl border border-surface-700 bg-surface-800 py-2.5 pl-8 pr-3 text-sm text-white transition-all focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
                                            autoFocus
                                        />
                                    </div>
                                    <div className="flex flex-col gap-2 sm:flex-row">
                                        <Button size="sm" onClick={() => void handleSaveProgress()} className="flex-1">
                                            Salvar progresso
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => {
                                                setProgressValue(formatCurrencyInput(goal.currentAmount, { emptyWhenZero: false }));
                                                setEditingProgress(false);
                                            }}
                                            className="flex-1"
                                        >
                                            Cancelar
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="grid grid-cols-2 gap-2">
                                        {quickIncrements.map((increment) => (
                                            <button
                                                key={increment}
                                                type="button"
                                                onClick={() => void handleQuickProgress(increment)}
                                                className="rounded-xl border border-white/5 bg-surface-800/80 px-3 py-2 text-xs font-semibold text-gray-200 transition-colors hover:border-indigo-400/30 hover:text-white"
                                            >
                                                + {formatCurrency(increment)}
                                            </button>
                                        ))}
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => setEditingProgress(true)}
                                        className="w-full"
                                    >
                                        <TrendingUp className="mr-2 h-3.5 w-3.5" />
                                        Ajuste manual
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                        <Button size="sm" variant="secondary" onClick={() => onEdit(goal)}>
                            <Pencil className="mr-2 h-3.5 w-3.5" />
                            Editar
                        </Button>
                        <Button
                            size="sm"
                            variant={goal.status === 'completed' ? 'secondary' : 'primary'}
                            onClick={() => void handleCompleteToggle()}
                        >
                            <Check className="mr-2 h-3.5 w-3.5" />
                            {goal.status === 'completed' ? 'Reativar' : 'Concluir'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void handlePauseToggle()}>
                            <PauseCircle className="mr-2 h-3.5 w-3.5" />
                            {goal.status === 'active' ? 'Pausar' : 'Reativar'}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => void handleDelete()}>
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            Excluir
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
