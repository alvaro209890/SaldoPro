import { useMemo, useState } from 'react';
import { useFinancialProfile } from '@/hooks/useFinancialProfile';
import { useGoals } from '@/hooks/useGoals';
import { FinancialQuestionnaire } from '@/components/goals/FinancialQuestionnaire';
import { GoalCard } from '@/components/goals/GoalCard';
import { GoalForm } from '@/components/goals/GoalForm';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import {
    ArrowDownRight,
    ArrowUpRight,
    CheckCircle2,
    CircleDollarSign,
    Clock3,
    Filter,
    PiggyBank,
    Plus,
    RefreshCw,
    Sparkles,
    Target,
    TrendingUp,
    Wallet,
} from 'lucide-react';
import type { FinancialProfileFormData, Goal, GoalFormData } from '@/types';

type GoalsViewFilter = 'all' | 'active' | 'focus' | 'completed' | 'cancelled';

function formatCurrency(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function priorityScore(priority: Goal['priority']): number {
    if (priority === 'high') return 3;
    if (priority === 'medium') return 2;
    return 1;
}

function sortGoalsForAttention(a: Goal, b: Goal): number {
    if (a.status !== b.status) {
        if (a.status === 'active') return -1;
        if (b.status === 'active') return 1;
    }

    const priorityDiff = priorityScore(b.priority) - priorityScore(a.priority);
    if (priorityDiff !== 0) {
        return priorityDiff;
    }

    if (a.deadline && b.deadline) {
        return a.deadline.localeCompare(b.deadline);
    }

    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return b.createdAt.localeCompare(a.createdAt);
}

function getGoalProgress(goal: Goal): number | null {
    if (!goal.targetAmount || goal.targetAmount <= 0) {
        return null;
    }

    return Math.min(100, (goal.currentAmount / goal.targetAmount) * 100);
}

function getDaysUntil(dateValue: string | null): number | null {
    if (!dateValue) {
        return null;
    }

    const target = new Date(`${dateValue}T12:00:00`);
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return Math.ceil((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

const FILTER_LABELS: Record<GoalsViewFilter, string> = {
    all: 'Todas',
    active: 'Ativas',
    focus: 'Em foco',
    completed: 'Concluidas',
    cancelled: 'Pausadas',
};

export function Goals() {
    const { profile, loading: profileLoading, hasCompleted, save: saveProfile } = useFinancialProfile();
    const { goals, loading: goalsLoading, generating, add, update, remove, generateAI } = useGoals();
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
    const [submittingProfile, setSubmittingProfile] = useState(false);
    const [viewFilter, setViewFilter] = useState<GoalsViewFilter>('all');

    const isLoading = profileLoading || goalsLoading;

    const sortedGoals = useMemo(() => [...goals].sort(sortGoalsForAttention), [goals]);
    const activeGoals = useMemo(() => sortedGoals.filter((goal) => goal.status === 'active'), [sortedGoals]);
    const completedGoals = useMemo(() => sortedGoals.filter((goal) => goal.status === 'completed'), [sortedGoals]);
    const cancelledGoals = useMemo(() => sortedGoals.filter((goal) => goal.status === 'cancelled'), [sortedGoals]);

    const focusGoals = useMemo(
        () =>
            activeGoals.filter((goal) => {
                const progress = getGoalProgress(goal);
                const daysUntil = getDaysUntil(goal.deadline);
                return goal.priority === 'high' || (progress != null && progress >= 60) || (daysUntil != null && daysUntil <= 14);
            }),
        [activeGoals]
    );

    const filteredGoals = useMemo(() => {
        switch (viewFilter) {
            case 'active':
                return activeGoals;
            case 'focus':
                return focusGoals;
            case 'completed':
                return completedGoals;
            case 'cancelled':
                return cancelledGoals;
            default:
                return sortedGoals;
        }
    }, [activeGoals, cancelledGoals, completedGoals, focusGoals, sortedGoals, viewFilter]);

    const portfolioStats = useMemo(() => {
        const targetGoals = activeGoals.filter((goal) => goal.targetAmount && goal.targetAmount > 0);
        const totalTarget = targetGoals.reduce((sum, goal) => sum + (goal.targetAmount ?? 0), 0);
        const totalCurrent = targetGoals.reduce((sum, goal) => sum + goal.currentAmount, 0);
        const averageProgress = targetGoals.length > 0
            ? targetGoals.reduce((sum, goal) => sum + (getGoalProgress(goal) ?? 0), 0) / targetGoals.length
            : 0;

        const nearestDeadlineGoal = [...activeGoals]
            .filter((goal) => goal.deadline)
            .sort((a, b) => (a.deadline ?? '').localeCompare(b.deadline ?? ''))[0] ?? null;

        const closestToCompleteGoal = [...activeGoals]
            .filter((goal) => getGoalProgress(goal) != null)
            .sort((a, b) => (getGoalProgress(b) ?? 0) - (getGoalProgress(a) ?? 0))[0] ?? null;

        return {
            totalTarget,
            totalCurrent,
            totalRemaining: Math.max(0, totalTarget - totalCurrent),
            averageProgress,
            nearestDeadlineGoal,
            closestToCompleteGoal,
        };
    }, [activeGoals]);

    const handleQuestionnaireSubmit = async (data: FinancialProfileFormData) => {
        setSubmittingProfile(true);
        try {
            await saveProfile(data);
            await generateAI();
        } finally {
            setSubmittingProfile(false);
        }
    };

    const handleRegenerateAI = async () => {
        await generateAI();
    };

    const handleCreate = () => {
        setEditingGoal(null);
        setIsFormOpen(true);
    };

    const handleEdit = (goal: Goal) => {
        setEditingGoal(goal);
        setIsFormOpen(true);
    };

    const handleGoalSubmit = async (data: GoalFormData) => {
        if (editingGoal) {
            await update(editingGoal.id, {
                title: data.title,
                description: data.description || null,
                targetAmount: data.targetAmount,
                currentAmount: data.currentAmount ?? 0,
                deadline: data.deadline || null,
                priority: data.priority,
                status: data.status ?? editingGoal.status,
            });
            return;
        }

        await add(data);
    };

    const handleDeleteEditingGoal = async () => {
        if (!editingGoal) {
            return;
        }

        await remove(editingGoal.id);
        setEditingGoal(null);
        setIsFormOpen(false);
    };

    if (isLoading) {
        return (
            <div className="animate-fade-in space-y-6 pb-20 lg:pb-0">
                <div>
                    <h1 className="text-2xl font-bold text-white">Metas</h1>
                    <p className="mt-1 text-sm text-gray-400">Central de metas e acompanhamento financeiro</p>
                </div>
                <LoadingSkeleton variant="card" />
            </div>
        );
    }

    if (!hasCompleted) {
        return (
            <div className="animate-fade-in space-y-6 pb-20 lg:pb-0">
                <div className="mb-2 text-center">
                    <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-3xl bg-indigo-500/10 text-indigo-300">
                        <Target className="h-8 w-8" />
                    </div>
                    <h1 className="text-2xl font-bold text-white">
                        Vamos definir suas metas
                    </h1>
                    <p className="mx-auto mt-2 max-w-md text-sm text-gray-400">
                        Responda algumas perguntas e a IA vai montar metas personalizadas para voce acompanhar no painel e no WhatsApp.
                    </p>
                </div>
                <FinancialQuestionnaire
                    onSubmit={handleQuestionnaireSubmit}
                    isLoading={submittingProfile || generating}
                />
            </div>
        );
    }

    return (
        <div className="animate-fade-in space-y-6 pb-20 lg:pb-0">
            <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
                <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.22),transparent_45%),radial-gradient(circle_at_85%_30%,rgba(16,185,129,0.14),transparent_35%),linear-gradient(135deg,rgba(15,23,42,0.92),rgba(15,23,42,0.68))] p-6">
                    <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-indigo-400/10 blur-3xl" />
                    <div className="relative space-y-5">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                            <div className="space-y-2">
                                <div className="inline-flex items-center gap-2 rounded-full border border-indigo-400/20 bg-indigo-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-200">
                                    <Sparkles className="h-3.5 w-3.5" />
                                    Painel de metas
                                </div>
                                <div>
                                    <h1 className="text-2xl font-bold text-white">Metas</h1>
                                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">
                                        Organize objetivos, acompanhe o progresso e use o WhatsApp para pedir detalhes, atualizar valores, concluir metas e ajustar prioridades sem abrir o painel.
                                    </p>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <Button variant="secondary" onClick={handleRegenerateAI} isLoading={generating} size="sm">
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    Regenerar IA
                                </Button>
                                <Button onClick={handleCreate} size="sm">
                                    <Plus className="mr-2 h-4 w-4" />
                                    Nova meta
                                </Button>
                            </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Ativas</p>
                                <p className="mt-2 text-2xl font-semibold text-white">{activeGoals.length}</p>
                                <p className="mt-1 text-xs text-slate-400">em acompanhamento agora</p>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Acumulado</p>
                                <p className="mt-2 text-xl font-semibold text-white">{formatCurrency(portfolioStats.totalCurrent)}</p>
                                <p className="mt-1 text-xs text-slate-400">somando metas com alvo</p>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Progresso medio</p>
                                <p className="mt-2 text-2xl font-semibold text-white">{portfolioStats.averageProgress.toFixed(0)}%</p>
                                <p className="mt-1 text-xs text-slate-400">nas metas ativas com alvo</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="rounded-3xl border border-surface-700 bg-surface-900/60 p-5">
                    <div className="mb-4 flex items-center gap-2">
                        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-300">
                            <CircleDollarSign className="h-4.5 w-4.5" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-white">Comandos no WhatsApp</p>
                            <p className="text-xs text-gray-400">agora com mais controle de metas</p>
                        </div>
                    </div>
                    <div className="space-y-2 text-sm text-gray-300">
                        <div className="rounded-2xl border border-white/5 bg-surface-950/30 p-3">"como estao minhas metas?"</div>
                        <div className="rounded-2xl border border-white/5 bg-surface-950/30 p-3">"atualize a meta reserva para 2500"</div>
                        <div className="rounded-2xl border border-white/5 bg-surface-950/30 p-3">"conclui minha meta viagem"</div>
                        <div className="rounded-2xl border border-white/5 bg-surface-950/30 p-3">"mude a prioridade da meta cartao para alta"</div>
                    </div>
                </div>
            </div>

            {profile && (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <div className="rounded-2xl border border-surface-700 bg-surface-900/50 p-4">
                        <div className="mb-2 flex items-center gap-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10">
                                <ArrowUpRight className="h-4 w-4 text-emerald-400" />
                            </div>
                            <span className="text-xs text-gray-500">Renda</span>
                        </div>
                        <p className="text-sm font-semibold text-white">{formatCurrency(profile.monthlyIncome)}</p>
                    </div>
                    <div className="rounded-2xl border border-surface-700 bg-surface-900/50 p-4">
                        <div className="mb-2 flex items-center gap-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-red-500/10">
                                <ArrowDownRight className="h-4 w-4 text-red-400" />
                            </div>
                            <span className="text-xs text-gray-500">Fixos</span>
                        </div>
                        <p className="text-sm font-semibold text-white">{formatCurrency(profile.fixedExpenses)}</p>
                    </div>
                    <div className="rounded-2xl border border-surface-700 bg-surface-900/50 p-4">
                        <div className="mb-2 flex items-center gap-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/10">
                                <Wallet className="h-4 w-4 text-amber-400" />
                            </div>
                            <span className="text-xs text-gray-500">Variaveis</span>
                        </div>
                        <p className="text-sm font-semibold text-white">{formatCurrency(profile.variableExpenses)}</p>
                    </div>
                    <div className="rounded-2xl border border-surface-700 bg-surface-900/50 p-4">
                        <div className="mb-2 flex items-center gap-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/10">
                                <PiggyBank className="h-4 w-4 text-indigo-400" />
                            </div>
                            <span className="text-xs text-gray-500">Meta de economia</span>
                        </div>
                        <p className="text-sm font-semibold text-white">{profile.savingsTargetPct}%</p>
                    </div>
                </div>
            )}

            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="rounded-3xl border border-surface-700 bg-surface-900/55 p-5">
                    <div className="mb-5 flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-300">
                            <TrendingUp className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-sm font-semibold text-white">Radar de progresso</h2>
                            <p className="text-xs text-gray-400">o panorama rapido das metas que pedem atencao</p>
                        </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-2xl border border-white/5 bg-surface-950/30 p-4">
                            <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">Falta total</p>
                            <p className="mt-2 text-lg font-semibold text-white">{formatCurrency(portfolioStats.totalRemaining)}</p>
                            <p className="mt-1 text-xs text-gray-400">para bater as metas ativas com alvo</p>
                        </div>
                        <div className="rounded-2xl border border-white/5 bg-surface-950/30 p-4">
                            <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">Mais proxima</p>
                            <p className="mt-2 text-sm font-semibold text-white">
                                {portfolioStats.nearestDeadlineGoal?.title ?? 'Sem prazo definido'}
                            </p>
                            <p className="mt-1 text-xs text-gray-400">
                                {portfolioStats.nearestDeadlineGoal?.deadline ?? 'Adicione prazos para ganhar mais contexto'}
                            </p>
                        </div>
                        <div className="rounded-2xl border border-white/5 bg-surface-950/30 p-4">
                            <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">Mais perto da linha</p>
                            <p className="mt-2 text-sm font-semibold text-white">
                                {portfolioStats.closestToCompleteGoal?.title ?? 'Sem meta com alvo'}
                            </p>
                            <p className="mt-1 text-xs text-gray-400">
                                {portfolioStats.closestToCompleteGoal
                                    ? `${(getGoalProgress(portfolioStats.closestToCompleteGoal) ?? 0).toFixed(0)}% concluido`
                                    : 'Adicione valores alvo para medir progresso'}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="rounded-3xl border border-surface-700 bg-surface-900/55 p-5">
                    <div className="mb-4 flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-300">
                            <Clock3 className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-sm font-semibold text-white">Visao rapida</h2>
                            <p className="text-xs text-gray-400">saiba onde agir primeiro</p>
                        </div>
                    </div>
                    <div className="space-y-3 text-sm">
                        <div className="rounded-2xl border border-white/5 bg-surface-950/30 p-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Em foco</p>
                            <p className="mt-1 font-medium text-white">{focusGoals.length} meta(s)</p>
                            <p className="mt-1 text-xs text-gray-400">alta prioridade, prazo proximo ou progresso acelerado</p>
                        </div>
                        <div className="rounded-2xl border border-white/5 bg-surface-950/30 p-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Concluidas</p>
                            <p className="mt-1 font-medium text-white">{completedGoals.length} meta(s)</p>
                            <p className="mt-1 text-xs text-gray-400">use o WhatsApp para reativar ou criar a proxima</p>
                        </div>
                        <div className="rounded-2xl border border-white/5 bg-surface-950/30 p-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Pausadas</p>
                            <p className="mt-1 font-medium text-white">{cancelledGoals.length} meta(s)</p>
                            <p className="mt-1 text-xs text-gray-400">retome quando fizer sentido</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="rounded-3xl border border-surface-700 bg-surface-900/50 p-4">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                        <Filter className="h-4 w-4 text-indigo-300" />
                        <p className="text-sm font-semibold text-white">Filtrar metas</p>
                    </div>
                    <p className="text-xs text-gray-400">
                        {filteredGoals.length} meta{filteredGoals.length !== 1 ? 's' : ''} em exibicao
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {(Object.keys(FILTER_LABELS) as GoalsViewFilter[]).map((filterKey) => (
                        <button
                            key={filterKey}
                            type="button"
                            onClick={() => setViewFilter(filterKey)}
                            className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition-all ${
                                viewFilter === filterKey
                                    ? 'border-indigo-400/30 bg-indigo-500/10 text-indigo-200'
                                    : 'border-surface-700 bg-surface-800 text-gray-400 hover:text-gray-200'
                            }`}
                        >
                            {FILTER_LABELS[filterKey]}
                        </button>
                    ))}
                </div>
            </div>

            {goals.length === 0 ? (
                <EmptyState
                    icon={Target}
                    title="Nenhuma meta ainda"
                    description="Crie metas manualmente ou use a IA para gerar metas baseadas no seu perfil financeiro."
                    actionLabel="Criar meta"
                    onAction={handleCreate}
                />
            ) : filteredGoals.length === 0 ? (
                <EmptyState
                    icon={CheckCircle2}
                    title="Nada nesse filtro"
                    description="Mude o filtro acima para ver outras metas ou crie uma nova."
                    actionLabel="Criar meta"
                    onAction={handleCreate}
                />
            ) : (
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    {filteredGoals.map((goal) => (
                        <GoalCard
                            key={goal.id}
                            goal={goal}
                            onUpdate={update}
                            onDelete={remove}
                            onEdit={handleEdit}
                        />
                    ))}
                </div>
            )}

            <button
                onClick={handleCreate}
                className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 transition-transform active:scale-95 lg:hidden"
            >
                <Plus className="h-6 w-6" />
            </button>

            <GoalForm
                isOpen={isFormOpen}
                onClose={() => {
                    setIsFormOpen(false);
                    setEditingGoal(null);
                }}
                onSubmit={handleGoalSubmit}
                initialData={editingGoal}
                onDelete={editingGoal ? handleDeleteEditingGoal : undefined}
            />
        </div>
    );
}
