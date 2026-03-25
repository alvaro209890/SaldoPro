import { useEffect, useMemo, useState } from 'react';
import {
    AlertCircle,
    Check,
    ChevronDown,
    ChevronUp,
    Clock,
    Flame,
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
    high: { chip: 'border-red-500/25 bg-red-500/10 text-red-300', label: 'Alta', icon: Flame },
    medium: { chip: 'border-amber-500/25 bg-amber-500/10 text-amber-300', label: 'Média', icon: Target },
    low: { chip: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300', label: 'Baixa', icon: Target },
} as const;

const STATUS_STYLES = {
    active: { chip: 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20', label: 'Ativa', dot: 'bg-indigo-400' },
    completed: { chip: 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20', label: 'Concluída', dot: 'bg-emerald-400' },
    cancelled: { chip: 'bg-slate-500/10 text-slate-300 border border-slate-500/20', label: 'Pausada', dot: 'bg-slate-400' },
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
        return { label: `Atrasada há ${Math.abs(diffInDays)} dia${Math.abs(diffInDays) === 1 ? '' : 's'}`, urgent: true };
    }

    if (diffInDays === 0) {
        return { label: 'Vence hoje', urgent: true };
    }

    return {
        label: `${diffInDays} dia${diffInDays === 1 ? '' : 's'} restante${diffInDays === 1 ? '' : 's'}`,
        urgent: diffInDays <= 7,
    };
}

/** SVG circular progress ring */
function ProgressRing({ progress, size = 52, strokeWidth = 4 }: { progress: number; size?: number; strokeWidth?: number }) {
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (progress / 100) * circumference;
    const color = progress >= 100 ? '#34d399' : progress >= 60 ? '#fbbf24' : '#818cf8';

    return (
        <div className="relative shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90">
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke="rgba(255,255,255,0.06)"
                    strokeWidth={strokeWidth}
                />
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke={color}
                    strokeWidth={strokeWidth}
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    strokeLinecap="round"
                    className="transition-all duration-1000"
                />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
                {progress.toFixed(0)}%
            </span>
        </div>
    );
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

    const PriorityIcon = priority.icon;

    return (
        <div className={`group rounded-3xl border backdrop-blur transition-all duration-300 ${
            goal.status === 'active'
                ? 'border-surface-700/80 bg-surface-900/60 hover:border-indigo-400/25 hover:shadow-[0_12px_40px_-20px_rgba(99,102,241,0.35)]'
                : goal.status === 'completed'
                    ? 'border-emerald-500/15 bg-surface-900/40'
                    : 'border-surface-800/60 bg-surface-900/30 opacity-75'
        }`}>
            <div className="p-5">
                {/* Header: Title + Chips + Progress ring */}
                <div className="flex items-start gap-4">
                    {/* Progress ring or status icon */}
                    {progress !== null ? (
                        <ProgressRing progress={progress} />
                    ) : (
                        <div className={`flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl ${
                            goal.status === 'completed'
                                ? 'bg-emerald-500/10'
                                : goal.status === 'cancelled'
                                    ? 'bg-slate-500/10'
                                    : 'bg-indigo-500/10'
                        }`}>
                            {goal.status === 'completed' ? (
                                <Check className="h-5 w-5 text-emerald-300" />
                            ) : goal.status === 'cancelled' ? (
                                <PauseCircle className="h-5 w-5 text-slate-400" />
                            ) : (
                                <Target className="h-5 w-5 text-indigo-300" />
                            )}
                        </div>
                    )}

                    <div className="min-w-0 flex-1">
                        {/* Chips row */}
                        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                            {goal.source === 'ai' && (
                                <span className="inline-flex items-center gap-1 rounded-full border border-indigo-400/20 bg-indigo-500/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-indigo-300">
                                    <Sparkles className="h-2.5 w-2.5" />
                                    IA
                                </span>
                            )}
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.15em] ${priority.chip}`}>
                                <PriorityIcon className="h-2.5 w-2.5" />
                                {priority.label}
                            </span>
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.15em] ${status.chip}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                                {status.label}
                            </span>
                        </div>

                        {/* Title */}
                        <h3 className={`text-[15px] font-semibold leading-snug text-white ${goal.status !== 'active' ? 'line-through decoration-white/20' : ''}`}>
                            {goal.title}
                        </h3>

                        {/* Deadline + Amount info */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
                            {targetAmount && (
                                <span className="inline-flex items-center gap-1">
                                    <Target className="h-3 w-3 text-gray-500" />
                                    {formatCurrency(goal.currentAmount)} <span className="text-gray-600">/</span> {formatCurrency(targetAmount)}
                                </span>
                            )}
                            {!targetAmount && goal.currentAmount > 0 && (
                                <span className="inline-flex items-center gap-1">
                                    <TrendingUp className="h-3 w-3 text-gray-500" />
                                    {formatCurrency(goal.currentAmount)} acumulado
                                </span>
                            )}
                            {goal.deadline && (
                                <span className="inline-flex items-center gap-1">
                                    <Clock className="h-3 w-3 text-gray-500" />
                                    {formatDate(goal.deadline)}
                                </span>
                            )}
                            {deadlineMeta && (
                                <span className={`inline-flex items-center gap-1 font-medium ${deadlineMeta.urgent ? 'text-amber-300' : 'text-gray-400'}`}>
                                    <AlertCircle className="h-3 w-3" />
                                    {deadlineMeta.label}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Expand toggle */}
                    <button
                        type="button"
                        onClick={() => setExpanded((current) => !current)}
                        className="rounded-xl border border-white/5 bg-surface-800/70 p-2 text-gray-400 transition-colors hover:text-white"
                    >
                        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                </div>

                {/* Progress bar (linear, for goals with targets) */}
                {targetAmount && progress !== null && (
                    <div className="mt-4">
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
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
                        <div className="mt-1.5 flex items-center justify-between text-[11px]">
                            <span className="text-gray-500">
                                {remainingAmount != null && remainingAmount > 0 ? `Faltam ${formatCurrency(remainingAmount)}` : ''}
                            </span>
                            <span className="text-gray-500">
                                {progress >= 100 ? '✅ Pronta para concluir' : goal.status === 'completed' ? 'Já concluída' : ''}
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Expanded Panel ── */}
            {expanded && (
                <div className="border-t border-surface-800/60 px-5 pb-5 pt-4 animate-fade-in">
                    {goal.description && (
                        <p className="mb-4 text-sm leading-relaxed text-gray-400">{goal.description}</p>
                    )}

                    {/* Quick progress update (only for active goals) */}
                    {goal.status === 'active' && (
                        <div className="mb-4 rounded-2xl border border-white/5 bg-surface-950/30 p-3">
                            <div className="mb-3 flex items-center justify-between gap-2">
                                <p className="text-sm font-medium text-gray-200">Atualizar progresso</p>
                                <p className="text-xs text-gray-500">Atalhos ou ajuste fino</p>
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

                    {/* Action buttons */}
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
