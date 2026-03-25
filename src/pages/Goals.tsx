import { useMemo, useState } from 'react';
import { useFinancialProfile } from '@/hooks/useFinancialProfile';
import { useGoals } from '@/hooks/useGoals';
import { FinancialQuestionnaire } from '@/components/goals/FinancialQuestionnaire';
import { FinancialProfileEditor } from '@/components/goals/FinancialProfileEditor';
import { GoalCard } from '@/components/goals/GoalCard';
import { GoalForm } from '@/components/goals/GoalForm';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { toast } from 'sonner';
import {
    ArrowDownRight,
    ArrowUpRight,
    Award,
    CalendarClock,
    CheckCircle2,
    ChevronRight,
    CircleDollarSign,
    Clock3,
    Filter,
    Flame,
    MessageCircle,
    PiggyBank,
    Plus,
    RefreshCw,
    Rocket,
    Sparkles,
    Target,
    TrendingUp,
    Trophy,
    Wallet,
    Zap,
} from 'lucide-react';
import type { FinancialProfileFormData, Goal, GoalFormData } from '@/types';

type GoalsViewFilter = 'all' | 'active' | 'focus' | 'completed' | 'cancelled';
type GoalsTab = 'goals' | 'financialProfile';

function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message.trim()) {
        return error.message;
    }

    return fallback;
}

function formatCurrency(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatCompactCurrency(value: number): string {
    if (value >= 1000) {
        return `R$ ${(value / 1000).toFixed(1).replace('.0', '')}k`;
    }
    return formatCurrency(value);
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

const FILTER_LABELS: Record<GoalsViewFilter, { label: string; icon: typeof Target }> = {
    all: { label: 'Todas', icon: Target },
    active: { label: 'Ativas', icon: Zap },
    focus: { label: 'Em foco', icon: Flame },
    completed: { label: 'Concluidas', icon: Trophy },
    cancelled: { label: 'Pausadas', icon: Clock3 },
};

function SmartInsightBanner({ goals, activeGoals, completedGoals, focusGoals }: {
    goals: Goal[];
    activeGoals: Goal[];
    completedGoals: Goal[];
    focusGoals: Goal[];
}) {
    if (goals.length === 0) return null;

    // Pick the most relevant insight
    const urgentGoal = activeGoals.find(g => {
        const days = getDaysUntil(g.deadline);
        return days !== null && days <= 3 && days >= 0;
    });

    const almostDoneGoal = activeGoals.find(g => {
        const progress = getGoalProgress(g);
        return progress !== null && progress >= 85 && progress < 100;
    });

    const overdueGoal = activeGoals.find(g => {
        const days = getDaysUntil(g.deadline);
        return days !== null && days < 0;
    });

    if (overdueGoal) {
        const days = Math.abs(getDaysUntil(overdueGoal.deadline)!);
        return (
            <div className="flex items-center gap-3 rounded-2xl border border-red-400/20 bg-gradient-to-r from-red-500/10 via-red-900/5 to-transparent p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/15">
                    <CalendarClock className="h-5 w-5 text-red-300" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white">Meta atrasada</p>
                    <p className="mt-0.5 text-xs text-red-200/80">
                        <span className="font-medium text-red-200">"{overdueGoal.title}"</span> está {days} dia{days !== 1 ? 's' : ''} atrasada. Atualize o prazo ou conclua.
                    </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-red-400/50" />
            </div>
        );
    }

    if (urgentGoal) {
        const days = getDaysUntil(urgentGoal.deadline)!;
        return (
            <div className="flex items-center gap-3 rounded-2xl border border-amber-400/20 bg-gradient-to-r from-amber-500/10 via-amber-900/5 to-transparent p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15">
                    <Flame className="h-5 w-5 text-amber-300" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white">Prazo chegando</p>
                    <p className="mt-0.5 text-xs text-amber-200/80">
                        <span className="font-medium text-amber-200">"{urgentGoal.title}"</span> vence em {days === 0 ? 'hoje' : `${days} dia${days !== 1 ? 's' : ''}`}!
                    </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-amber-400/50" />
            </div>
        );
    }

    if (almostDoneGoal) {
        const progress = getGoalProgress(almostDoneGoal)!;
        return (
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-400/20 bg-gradient-to-r from-emerald-500/10 via-emerald-900/5 to-transparent p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15">
                    <Rocket className="h-5 w-5 text-emerald-300" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white">Quase lá! 🎉</p>
                    <p className="mt-0.5 text-xs text-emerald-200/80">
                        <span className="font-medium text-emerald-200">"{almostDoneGoal.title}"</span> está em {progress.toFixed(0)}%. Falta pouco para concluir!
                    </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-emerald-400/50" />
            </div>
        );
    }

    if (completedGoals.length > 0 && activeGoals.length > 0) {
        return (
            <div className="flex items-center gap-3 rounded-2xl border border-indigo-400/15 bg-gradient-to-r from-indigo-500/8 via-purple-900/5 to-transparent p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15">
                    <Award className="h-5 w-5 text-indigo-300" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white">
                        {completedGoals.length} meta{completedGoals.length !== 1 ? 's' : ''} concluída{completedGoals.length !== 1 ? 's' : ''}
                    </p>
                    <p className="mt-0.5 text-xs text-indigo-200/70">
                        Continue assim! Você tem {activeGoals.length} meta{activeGoals.length !== 1 ? 's' : ''} ativa{activeGoals.length !== 1 ? 's' : ''} e {focusGoals.length} em foco.
                    </p>
                </div>
            </div>
        );
    }

    return null;
}

export function Goals() {
    const { profile, loading: profileLoading, hasCompleted, save: saveProfile } = useFinancialProfile();
    const { goals, loading: goalsLoading, generating, add, update, remove, generateAI } = useGoals();
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
    const [submittingProfile, setSubmittingProfile] = useState(false);
    const [savingProfile, setSavingProfile] = useState(false);
    const [viewFilter, setViewFilter] = useState<GoalsViewFilter>('all');
    const [activeTab, setActiveTab] = useState<GoalsTab>('goals');

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
            toast.success('Perfil financeiro salvo com sucesso.');

            try {
                await generateAI();
                toast.success('Metas geradas com IA.');
            } catch (error) {
                toast.error(getErrorMessage(error, 'Perfil salvo, mas não foi possível gerar metas agora.'));
            }
        } catch (error) {
            toast.error(getErrorMessage(error, 'Não foi possível salvar o perfil financeiro.'));
        } finally {
            setSubmittingProfile(false);
        }
    };

    const regenerateAIGoals = async () => {
        try {
            await generateAI();
            toast.success('Novas metas adicionadas com IA.');
        } catch (error) {
            const message = getErrorMessage(error, 'Não foi possível regenerar metas com IA.');
            toast.error(message);
            throw error;
        }
    };

    const handleRegenerateAI = async () => {
        try {
            await regenerateAIGoals();
        } catch {
            // Feedback ja exibido para o usuario.
        }
    };

    const handleSaveFinancialProfile = async (data: FinancialProfileFormData) => {
        setSavingProfile(true);
        try {
            await saveProfile(data);
            toast.success('Perfil financeiro atualizado.');
        } catch (error) {
            const message = getErrorMessage(error, 'Não foi possível salvar o perfil financeiro.');
            toast.error(message);
            throw error;
        } finally {
            setSavingProfile(false);
        }
    };

    const handleRegenerateFromProfile = async () => {
        await regenerateAIGoals();
        setActiveTab('goals');
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
                        Responda algumas perguntas e a IA vai montar metas personalizadas para você acompanhar no painel e no WhatsApp.
                    </p>
                </div>
                <FinancialQuestionnaire
                    onSubmit={handleQuestionnaireSubmit}
                    isLoading={submittingProfile || generating}
                />
            </div>
        );
    }

    const filterCounts: Record<GoalsViewFilter, number> = {
        all: sortedGoals.length,
        active: activeGoals.length,
        focus: focusGoals.length,
        completed: completedGoals.length,
        cancelled: cancelledGoals.length,
    };

    return (
        <div className="animate-fade-in space-y-5 pb-20 lg:pb-0">
            {/* ── Tab switcher ── */}
            <div className="flex w-full flex-col gap-1 rounded-2xl border border-surface-700/40 bg-surface-900/60 p-1 sm:w-auto sm:flex-row sm:gap-0">
                <button
                    type="button"
                    onClick={() => setActiveTab('goals')}
                    className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${activeTab === 'goals'
                            ? 'bg-indigo-500/15 text-indigo-200 shadow-sm'
                            : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-200'
                        }`}
                >
                    <Target className="h-4 w-4" />
                    Metas
                </button>
                <button
                    type="button"
                    onClick={() => {
                        setActiveTab('financialProfile');
                        setIsFormOpen(false);
                        setEditingGoal(null);
                    }}
                    className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${activeTab === 'financialProfile'
                            ? 'bg-indigo-500/15 text-indigo-200 shadow-sm'
                            : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-200'
                        }`}
                >
                    <Wallet className="h-4 w-4" />
                    Perfil financeiro
                </button>
            </div>

            {activeTab === 'goals' ? (
                <>
                    {/* ══════════════════════════════════════════════ */}
                    {/*               COMPACT HERO + STATS           */}
                    {/* ══════════════════════════════════════════════ */}
                    <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.18),transparent_50%),radial-gradient(circle_at_85%_15%,rgba(16,185,129,0.12),transparent_40%)] p-5 sm:p-6">
                        <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-indigo-400/8 blur-3xl" />

                        <div className="relative">
                            {/* Title row */}
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-300">
                                        <Target className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <h1 className="text-xl font-bold text-white">Metas</h1>
                                        <p className="text-xs text-slate-400">Acompanhe, conclua e organize seus objetivos</p>
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    <Button variant="secondary" onClick={handleRegenerateAI} isLoading={generating} size="sm">
                                        <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                                        Gerar com IA
                                    </Button>
                                    <Button onClick={handleCreate} size="sm">
                                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                                        Nova meta
                                    </Button>
                                </div>
                            </div>

                            {/* Stats row */}
                            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                                <div className="rounded-2xl border border-indigo-400/15 bg-indigo-500/[0.06] p-3.5">
                                    <div className="flex items-center gap-2">
                                        <Zap className="h-3.5 w-3.5 text-indigo-300" />
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-indigo-300/80">Ativas</p>
                                    </div>
                                    <p className="mt-1.5 text-2xl font-bold text-white">{activeGoals.length}</p>
                                </div>
                                <div className="rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.06] p-3.5">
                                    <div className="flex items-center gap-2">
                                        <TrendingUp className="h-3.5 w-3.5 text-emerald-300" />
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-300/80">Progresso</p>
                                    </div>
                                    <p className="mt-1.5 text-2xl font-bold text-white">{portfolioStats.averageProgress.toFixed(0)}%</p>
                                </div>
                                <div className="rounded-2xl border border-amber-400/15 bg-amber-500/[0.06] p-3.5">
                                    <div className="flex items-center gap-2">
                                        <CircleDollarSign className="h-3.5 w-3.5 text-amber-300" />
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-amber-300/80">Acumulado</p>
                                    </div>
                                    <p className="mt-1.5 text-lg font-bold text-white">{formatCompactCurrency(portfolioStats.totalCurrent)}</p>
                                </div>
                                <div className="rounded-2xl border border-purple-400/15 bg-purple-500/[0.06] p-3.5">
                                    <div className="flex items-center gap-2">
                                        <Target className="h-3.5 w-3.5 text-purple-300" />
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-purple-300/80">Falta</p>
                                    </div>
                                    <p className="mt-1.5 text-lg font-bold text-white">{formatCompactCurrency(portfolioStats.totalRemaining)}</p>
                                </div>
                            </div>

                            {/* Overall progress bar */}
                            {portfolioStats.totalTarget > 0 && (
                                <div className="mt-4">
                                    <div className="mb-1.5 flex items-center justify-between text-[11px]">
                                        <span className="text-slate-400">Progresso geral</span>
                                        <span className="font-semibold text-white">{formatCurrency(portfolioStats.totalCurrent)} de {formatCurrency(portfolioStats.totalTarget)}</span>
                                    </div>
                                    <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
                                        <div
                                            className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 transition-all duration-1000"
                                            style={{ width: `${Math.min(100, (portfolioStats.totalCurrent / portfolioStats.totalTarget) * 100)}%` }}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>

                    {/* ── Smart Insight Banner ── */}
                    <SmartInsightBanner
                        goals={goals}
                        activeGoals={activeGoals}
                        completedGoals={completedGoals}
                        focusGoals={focusGoals}
                    />

                    {/* ── Financial Profile Strip ── */}
                    {profile && (
                        <div className="grid grid-cols-4 gap-2">
                            <div className="rounded-xl border border-surface-700/60 bg-surface-900/40 px-3 py-2.5">
                                <div className="flex items-center gap-1.5">
                                    <ArrowUpRight className="h-3 w-3 text-emerald-400" />
                                    <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Renda</span>
                                </div>
                                <p className="mt-1 text-sm font-semibold text-white">{formatCompactCurrency(profile.monthlyIncome)}</p>
                            </div>
                            <div className="rounded-xl border border-surface-700/60 bg-surface-900/40 px-3 py-2.5">
                                <div className="flex items-center gap-1.5">
                                    <ArrowDownRight className="h-3 w-3 text-red-400" />
                                    <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Fixos</span>
                                </div>
                                <p className="mt-1 text-sm font-semibold text-white">{formatCompactCurrency(profile.fixedExpenses)}</p>
                            </div>
                            <div className="rounded-xl border border-surface-700/60 bg-surface-900/40 px-3 py-2.5">
                                <div className="flex items-center gap-1.5">
                                    <Wallet className="h-3 w-3 text-amber-400" />
                                    <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Var.</span>
                                </div>
                                <p className="mt-1 text-sm font-semibold text-white">{formatCompactCurrency(profile.variableExpenses)}</p>
                            </div>
                            <div className="rounded-xl border border-surface-700/60 bg-surface-900/40 px-3 py-2.5">
                                <div className="flex items-center gap-1.5">
                                    <PiggyBank className="h-3 w-3 text-indigo-400" />
                                    <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Poupar</span>
                                </div>
                                <p className="mt-1 text-sm font-semibold text-white">{profile.savingsTargetPct}%</p>
                            </div>
                        </div>
                    )}

                    {/* ── Highlights Row: Nearest deadline + Closest to finish + WhatsApp tips ── */}
                    <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-2xl border border-white/[0.06] bg-surface-900/50 p-4">
                            <div className="mb-2 flex items-center gap-2">
                                <CalendarClock className="h-4 w-4 text-amber-300" />
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Prazo mais próximo</p>
                            </div>
                            <p className="text-sm font-semibold text-white truncate">
                                {portfolioStats.nearestDeadlineGoal?.title ?? 'Nenhum prazo'}
                            </p>
                            <p className="mt-0.5 text-xs text-gray-500">
                                {portfolioStats.nearestDeadlineGoal?.deadline
                                    ? (() => {
                                        const d = getDaysUntil(portfolioStats.nearestDeadlineGoal!.deadline);
                                        if (d === null) return '';
                                        if (d < 0) return `Atrasada há ${Math.abs(d)} dias`;
                                        if (d === 0) return 'Vence hoje';
                                        return `Em ${d} dia${d !== 1 ? 's' : ''}`;
                                    })()
                                    : 'Adicione prazos às metas'}
                            </p>
                        </div>
                        <div className="rounded-2xl border border-white/[0.06] bg-surface-900/50 p-4">
                            <div className="mb-2 flex items-center gap-2">
                                <Trophy className="h-4 w-4 text-emerald-300" />
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Mais perto de concluir</p>
                            </div>
                            <p className="text-sm font-semibold text-white truncate">
                                {portfolioStats.closestToCompleteGoal?.title ?? 'Nenhuma com alvo'}
                            </p>
                            <p className="mt-0.5 text-xs text-gray-500">
                                {portfolioStats.closestToCompleteGoal
                                    ? `${(getGoalProgress(portfolioStats.closestToCompleteGoal) ?? 0).toFixed(0)}% concluído`
                                    : 'Defina valores alvo'}
                            </p>
                        </div>
                        <div className="rounded-2xl border border-white/[0.06] bg-surface-900/50 p-4">
                            <div className="mb-2 flex items-center gap-2">
                                <MessageCircle className="h-4 w-4 text-indigo-300" />
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Dica WhatsApp</p>
                            </div>
                            <p className="text-[13px] font-medium text-white leading-snug">
                                "atualize minha meta [nome] para R$ [valor]"
                            </p>
                            <p className="mt-0.5 text-xs text-gray-500">
                                Gerencie metas direto pelo chat
                            </p>
                        </div>
                    </div>

                    {/* ── Filter pills ── */}
                    <div className="rounded-2xl border border-surface-700/50 bg-surface-900/40 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <Filter className="h-3.5 w-3.5 text-gray-500" />
                            {(Object.keys(FILTER_LABELS) as GoalsViewFilter[]).map((filterKey) => {
                                const { label, icon: Icon } = FILTER_LABELS[filterKey];
                                const count = filterCounts[filterKey];
                                return (
                                    <button
                                        key={filterKey}
                                        type="button"
                                        onClick={() => setViewFilter(filterKey)}
                                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${viewFilter === filterKey
                                                ? 'border-indigo-400/30 bg-indigo-500/12 text-indigo-200'
                                                : 'border-surface-700/60 bg-transparent text-gray-400 hover:text-gray-200 hover:bg-white/[0.03]'
                                            }`}
                                    >
                                        <Icon className="h-3 w-3" />
                                        {label}
                                        <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] ${viewFilter === filterKey ? 'bg-indigo-500/20 text-indigo-200' : 'bg-white/5 text-gray-500'}`}>
                                            {count}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* ── Goal Cards ── */}
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

                    {/* FAB mobile */}
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
                </>
            ) : profile ? (
                <FinancialProfileEditor
                    profile={profile}
                    isSaving={savingProfile}
                    isGenerating={generating}
                    onSave={handleSaveFinancialProfile}
                    onRegenerateNow={handleRegenerateFromProfile}
                />
            ) : (
                <LoadingSkeleton variant="card" />
            )}
        </div>
    );
}
