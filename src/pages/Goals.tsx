import { useState } from 'react';
import { useFinancialProfile } from '@/hooks/useFinancialProfile';
import { useGoals } from '@/hooks/useGoals';
import { FinancialQuestionnaire } from '@/components/goals/FinancialQuestionnaire';
import { GoalCard } from '@/components/goals/GoalCard';
import { GoalForm } from '@/components/goals/GoalForm';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import {
    Target,
    Plus,
    Sparkles,
    Wallet,
    ArrowDownRight,
    ArrowUpRight,
    PiggyBank,
    RefreshCw,
} from 'lucide-react';
import type { FinancialProfileFormData, Goal } from '@/types';

function formatCurrency(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function Goals() {
    const { profile, loading: profileLoading, hasCompleted, save: saveProfile } = useFinancialProfile();
    const { goals, loading: goalsLoading, generating, add, update, remove, generateAI } = useGoals();
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [submittingProfile, setSubmittingProfile] = useState(false);

    const isLoading = profileLoading || goalsLoading;

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

    // Show loading
    if (isLoading) {
        return (
            <div className="space-y-6 pb-20 lg:pb-0 animate-fade-in">
                <div>
                    <h1 className="text-2xl font-bold text-white">Metas</h1>
                    <p className="text-sm text-gray-400 mt-1">Gerencie seus objetivos financeiros</p>
                </div>
                <LoadingSkeleton variant="card" />
            </div>
        );
    }

    // Show questionnaire on first visit
    if (!hasCompleted) {
        return (
            <div className="space-y-6 pb-20 lg:pb-0 animate-fade-in">
                <div className="text-center mb-2">
                    <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-indigo-500/10 text-indigo-400 mb-4">
                        <Target className="h-8 w-8" />
                    </div>
                    <h1 className="text-2xl font-bold text-white">
                        Vamos definir suas metas!
                    </h1>
                    <p className="text-sm text-gray-400 mt-2 max-w-md mx-auto">
                        Responda algumas perguntas sobre suas finanças e nossa IA vai criar metas personalizadas para você economizar dinheiro.
                    </p>
                </div>
                <FinancialQuestionnaire
                    onSubmit={handleQuestionnaireSubmit}
                    isLoading={submittingProfile || generating}
                />
            </div>
        );
    }

    // Goals dashboard
    const activeGoals = goals.filter(g => g.status === 'active');
    const completedGoals = goals.filter(g => g.status === 'completed');
    const cancelledGoals = goals.filter(g => g.status === 'cancelled');

    return (
        <div className="space-y-6 pb-20 lg:pb-0 animate-fade-in">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Metas</h1>
                    <p className="text-sm text-gray-400 mt-1">
                        {activeGoals.length} meta{activeGoals.length !== 1 ? 's' : ''} ativa{activeGoals.length !== 1 ? 's' : ''}
                        {completedGoals.length > 0 && ` · ${completedGoals.length} concluída${completedGoals.length !== 1 ? 's' : ''}`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="secondary" onClick={handleRegenerateAI} isLoading={generating} size="sm">
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Regenerar IA
                    </Button>
                    <Button onClick={() => setIsFormOpen(true)} size="sm">
                        <Plus className="mr-2 h-4 w-4" />
                        Nova Meta
                    </Button>
                </div>
            </div>

            {/* Financial Profile Summary */}
            {profile && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-xl border border-surface-700 bg-surface-900/50 p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-emerald-500/10">
                                <ArrowUpRight className="h-4 w-4 text-emerald-400" />
                            </div>
                            <span className="text-xs text-gray-500">Renda</span>
                        </div>
                        <p className="text-sm font-semibold text-white">{formatCurrency(profile.monthlyIncome)}</p>
                    </div>
                    <div className="rounded-xl border border-surface-700 bg-surface-900/50 p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-red-500/10">
                                <ArrowDownRight className="h-4 w-4 text-red-400" />
                            </div>
                            <span className="text-xs text-gray-500">Fixos</span>
                        </div>
                        <p className="text-sm font-semibold text-white">{formatCurrency(profile.fixedExpenses)}</p>
                    </div>
                    <div className="rounded-xl border border-surface-700 bg-surface-900/50 p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-amber-500/10">
                                <Wallet className="h-4 w-4 text-amber-400" />
                            </div>
                            <span className="text-xs text-gray-500">Variáveis</span>
                        </div>
                        <p className="text-sm font-semibold text-white">{formatCurrency(profile.variableExpenses)}</p>
                    </div>
                    <div className="rounded-xl border border-surface-700 bg-surface-900/50 p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-indigo-500/10">
                                <PiggyBank className="h-4 w-4 text-indigo-400" />
                            </div>
                            <span className="text-xs text-gray-500">Meta Economia</span>
                        </div>
                        <p className="text-sm font-semibold text-white">{profile.savingsTargetPct}%</p>
                    </div>
                </div>
            )}

            {/* Goals Grid */}
            {goals.length === 0 ? (
                <EmptyState
                    icon={Target}
                    title="Nenhuma meta ainda"
                    description="Crie metas manualmente ou peça para a IA gerar metas baseadas no seu perfil financeiro."
                    actionLabel="Criar Meta"
                    onAction={() => setIsFormOpen(true)}
                />
            ) : (
                <div className="space-y-6">
                    {/* Active goals */}
                    {activeGoals.length > 0 && (
                        <div>
                            <h2 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                                <Target className="h-4 w-4 text-indigo-400" />
                                Metas Ativas ({activeGoals.length})
                            </h2>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                {activeGoals.map(goal => (
                                    <GoalCard key={goal.id} goal={goal} onUpdate={update} onDelete={remove} />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Completed goals */}
                    {completedGoals.length > 0 && (
                        <div>
                            <h2 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                                <Sparkles className="h-4 w-4 text-emerald-400" />
                                Concluídas ({completedGoals.length})
                            </h2>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                {completedGoals.map(goal => (
                                    <GoalCard key={goal.id} goal={goal} onUpdate={update} onDelete={remove} />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Cancelled goals */}
                    {cancelledGoals.length > 0 && (
                        <div>
                            <h2 className="text-sm font-medium text-gray-400 mb-3">
                                Canceladas ({cancelledGoals.length})
                            </h2>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                {cancelledGoals.map(goal => (
                                    <GoalCard key={goal.id} goal={goal} onUpdate={update} onDelete={remove} />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* FAB for mobile */}
            <button
                onClick={() => setIsFormOpen(true)}
                className="fixed bottom-6 right-6 lg:hidden z-40 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 transition-transform active:scale-95"
            >
                <Plus className="h-6 w-6" />
            </button>

            {/* Goal Form Modal */}
            <GoalForm
                isOpen={isFormOpen}
                onClose={() => setIsFormOpen(false)}
                onSubmit={add}
            />
        </div>
    );
}
