import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DollarSign, Wallet, TrendingDown, Target, FileText, ChevronRight, ChevronLeft, Sparkles } from 'lucide-react';
import type { FinancialProfileFormData } from '@/types';

interface FinancialQuestionnaireProps {
    onSubmit: (data: FinancialProfileFormData) => Promise<void>;
    isLoading?: boolean;
}

const STEPS = [
    { key: 'monthlyIncome', label: 'Qual é a sua renda mensal?', description: 'Inclua salário, freelances e outras fontes de renda.', icon: DollarSign, placeholder: 'Ex: 3500' },
    { key: 'fixedExpenses', label: 'Qual o total de gastos fixos?', description: 'Aluguel, contas de luz/água, internet, seguros, etc.', icon: Wallet, placeholder: 'Ex: 1500' },
    { key: 'variableExpenses', label: 'E os gastos variáveis mensais?', description: 'Alimentação, transporte, lazer, compras, etc.', icon: TrendingDown, placeholder: 'Ex: 800' },
    { key: 'savingsTargetPct', label: 'Quanto deseja economizar? (%)', description: 'Percentual da renda que quer guardar por mês.', icon: Target, placeholder: 'Ex: 20' },
    { key: 'financialGoalsText', label: 'Quais são seus objetivos financeiros?', description: 'Opcional: descreva seus sonhos — viagem, carro, casa, etc.', icon: FileText, placeholder: 'Ex: Juntar para uma viagem em dezembro' },
] as const;

export function FinancialQuestionnaire({ onSubmit, isLoading }: FinancialQuestionnaireProps) {
    const [step, setStep] = useState(0);
    const [values, setValues] = useState({
        monthlyIncome: '',
        fixedExpenses: '',
        variableExpenses: '',
        savingsTargetPct: '',
        financialGoalsText: '',
    });

    const currentStep = STEPS[step];
    const isLastStep = step === STEPS.length - 1;
    const isFirstStep = step === 0;

    const getCurrentValue = () => values[currentStep.key];
    const isCurrentStepValid = () => {
        const val = getCurrentValue();
        if (currentStep.key === 'financialGoalsText') return true; // optional
        if (currentStep.key === 'savingsTargetPct') {
            const num = parseFloat(val);
            return !isNaN(num) && num >= 0 && num <= 100;
        }
        const num = parseFloat(val);
        return !isNaN(num) && num >= 0;
    };

    const handleNext = () => {
        if (isLastStep) {
            handleSubmit();
        } else {
            setStep(s => s + 1);
        }
    };

    const handleSubmit = async () => {
        await onSubmit({
            monthlyIncome: parseFloat(values.monthlyIncome) || 0,
            fixedExpenses: parseFloat(values.fixedExpenses) || 0,
            variableExpenses: parseFloat(values.variableExpenses) || 0,
            savingsTargetPct: parseFloat(values.savingsTargetPct) || 10,
            financialGoalsText: values.financialGoalsText.trim(),
        });
    };

    const StepIcon = currentStep.icon;
    const progress = ((step + 1) / STEPS.length) * 100;

    return (
        <div className="flex items-center justify-center min-h-[60vh] animate-fade-in">
            <div className="w-full max-w-lg">
                {/* Progress bar */}
                <div className="mb-8">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-gray-500">Passo {step + 1} de {STEPS.length}</span>
                        <span className="text-xs text-indigo-400 font-medium">{Math.round(progress)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-surface-800 overflow-hidden">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-400 transition-all duration-500 ease-out"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>

                {/* Card */}
                <div className="rounded-2xl border border-surface-700 bg-surface-900/50 backdrop-blur p-8 shadow-xl shadow-black/20">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="flex items-center justify-center h-12 w-12 rounded-xl bg-indigo-500/10 text-indigo-400">
                            <StepIcon className="h-6 w-6" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-white">{currentStep.label}</h2>
                            <p className="text-sm text-gray-400">{currentStep.description}</p>
                        </div>
                    </div>

                    <div className="mb-8">
                        {currentStep.key === 'financialGoalsText' ? (
                            <textarea
                                value={values.financialGoalsText}
                                onChange={(e) => setValues(v => ({ ...v, financialGoalsText: e.target.value }))}
                                placeholder={currentStep.placeholder}
                                rows={3}
                                className="w-full rounded-xl border border-surface-700 bg-surface-800/50 px-4 py-3 text-sm text-white placeholder:text-gray-600 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all resize-none"
                            />
                        ) : (
                            <div className="relative">
                                {currentStep.key !== 'savingsTargetPct' && (
                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium">R$</span>
                                )}
                                <Input
                                    type="number"
                                    inputMode="decimal"
                                    value={getCurrentValue()}
                                    onChange={(e) => setValues(v => ({ ...v, [currentStep.key]: e.target.value }))}
                                    placeholder={currentStep.placeholder}
                                    className={currentStep.key !== 'savingsTargetPct' ? 'pl-10' : ''}
                                    autoFocus
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && isCurrentStepValid()) handleNext();
                                    }}
                                />
                                {currentStep.key === 'savingsTargetPct' && (
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium">%</span>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center justify-between">
                        <Button
                            variant="ghost"
                            onClick={() => setStep(s => s - 1)}
                            disabled={isFirstStep}
                            className={isFirstStep ? 'invisible' : ''}
                        >
                            <ChevronLeft className="mr-1 h-4 w-4" />
                            Voltar
                        </Button>

                        <Button
                            onClick={handleNext}
                            disabled={!isCurrentStepValid() || isLoading}
                            isLoading={isLoading && isLastStep}
                        >
                            {isLastStep ? (
                                <>
                                    <Sparkles className="mr-2 h-4 w-4" />
                                    Gerar Metas com IA
                                </>
                            ) : (
                                <>
                                    Próximo
                                    <ChevronRight className="ml-1 h-4 w-4" />
                                </>
                            )}
                        </Button>
                    </div>
                </div>

                {/* Summary preview */}
                {step > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                        {STEPS.slice(0, step).map((s, i) => {
                            const val = values[s.key];
                            if (!val) return null;
                            const display = s.key === 'savingsTargetPct'
                                ? `${val}%`
                                : s.key === 'financialGoalsText'
                                    ? val.slice(0, 30) + (val.length > 30 ? '…' : '')
                                    : `R$ ${parseFloat(val).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
                            return (
                                <button
                                    key={s.key}
                                    onClick={() => setStep(i)}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-surface-800/50 border border-surface-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-surface-700 transition-colors cursor-pointer"
                                >
                                    <s.icon className="h-3 w-3 text-indigo-400" />
                                    {display}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
