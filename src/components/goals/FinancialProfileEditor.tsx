import { useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, PiggyBank, Sparkles, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { FinancialProfile, FinancialProfileFormData } from '@/types';
import { formatCurrencyInput, maskCurrencyInput, parseCurrencyInput, parseLocaleNumberInput, sanitizeDecimalInput } from '@/utils/currencyInput';

export interface FinancialProfileEditorProps {
    profile: FinancialProfile;
    isSaving: boolean;
    isGenerating: boolean;
    onSave: (data: FinancialProfileFormData) => Promise<void>;
    onRegenerateNow: () => Promise<void>;
}

interface FormValues {
    monthlyIncome: string;
    fixedExpenses: string;
    variableExpenses: string;
    savingsTargetPct: string;
    financialGoalsText: string;
}

type FormErrors = Partial<Record<keyof FormValues, string>>;

const FINANCIAL_GOALS_TEXT_LIMIT = 500;

function profileToFormValues(profile: FinancialProfile): FormValues {
    return {
        monthlyIncome: formatCurrencyInput(profile.monthlyIncome, { emptyWhenZero: false }),
        fixedExpenses: formatCurrencyInput(profile.fixedExpenses, { emptyWhenZero: false }),
        variableExpenses: formatCurrencyInput(profile.variableExpenses, { emptyWhenZero: false }),
        savingsTargetPct: String(profile.savingsTargetPct),
        financialGoalsText: profile.financialGoalsText ?? '',
    };
}

function formatCurrency(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function FinancialProfileEditor({
    profile,
    isSaving,
    isGenerating,
    onSave,
    onRegenerateNow,
}: FinancialProfileEditorProps) {
    const [values, setValues] = useState<FormValues>(() => profileToFormValues(profile));
    const [errors, setErrors] = useState<FormErrors>({});
    const [showRegeneratePrompt, setShowRegeneratePrompt] = useState(false);
    const [isDirty, setIsDirty] = useState(false);

    useEffect(() => {
        setValues(profileToFormValues(profile));
        setErrors({});
        setIsDirty(false);
    }, [profile]);

    const summary = useMemo(() => {
        const monthlyIncome = parseCurrencyInput(values.monthlyIncome);
        const fixedExpenses = parseCurrencyInput(values.fixedExpenses);
        const variableExpenses = parseCurrencyInput(values.variableExpenses);
        const savingsTargetPct = parseLocaleNumberInput(values.savingsTargetPct);

        const safeIncome = Number.isFinite(monthlyIncome) ? Math.max(0, monthlyIncome) : 0;
        const safeFixed = Number.isFinite(fixedExpenses) ? Math.max(0, fixedExpenses) : 0;
        const safeVariable = Number.isFinite(variableExpenses) ? Math.max(0, variableExpenses) : 0;
        const safeSavingsPct = Number.isFinite(savingsTargetPct) ? Math.min(100, Math.max(0, savingsTargetPct)) : 0;

        return {
            monthlyIncome: safeIncome,
            fixedExpenses: safeFixed,
            variableExpenses: safeVariable,
            savingsTargetPct: safeSavingsPct,
            disposableIncome: safeIncome - safeFixed - safeVariable,
        };
    }, [values.fixedExpenses, values.monthlyIncome, values.savingsTargetPct, values.variableExpenses]);

    const validate = (): FinancialProfileFormData | null => {
        const nextErrors: FormErrors = {};

        const monthlyIncome = parseCurrencyInput(values.monthlyIncome);
        const fixedExpenses = parseCurrencyInput(values.fixedExpenses);
        const variableExpenses = parseCurrencyInput(values.variableExpenses);
        const savingsTargetPct = parseLocaleNumberInput(values.savingsTargetPct);
        const financialGoalsText = values.financialGoalsText.trim();

        if (!Number.isFinite(monthlyIncome) || monthlyIncome < 0) {
            nextErrors.monthlyIncome = 'Informe um valor valido maior ou igual a 0.';
        }

        if (!Number.isFinite(fixedExpenses) || fixedExpenses < 0) {
            nextErrors.fixedExpenses = 'Informe um valor valido maior ou igual a 0.';
        }

        if (!Number.isFinite(variableExpenses) || variableExpenses < 0) {
            nextErrors.variableExpenses = 'Informe um valor valido maior ou igual a 0.';
        }

        if (!Number.isFinite(savingsTargetPct) || savingsTargetPct < 0 || savingsTargetPct > 100) {
            nextErrors.savingsTargetPct = 'Use um percentual entre 0 e 100.';
        }

        if (financialGoalsText.length > FINANCIAL_GOALS_TEXT_LIMIT) {
            nextErrors.financialGoalsText = `Limite de ${FINANCIAL_GOALS_TEXT_LIMIT} caracteres.`;
        }

        setErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) {
            return null;
        }

        return {
            monthlyIncome,
            fixedExpenses,
            variableExpenses,
            savingsTargetPct,
            financialGoalsText,
        };
    };

    const handleFieldChange = (field: keyof FormValues, value: string) => {
        const nextValue =
            field === 'monthlyIncome' || field === 'fixedExpenses' || field === 'variableExpenses'
                ? maskCurrencyInput(value, { emptyWhenZero: false })
                : field === 'savingsTargetPct'
                    ? sanitizeDecimalInput(value, 2)
                    : value;

        setValues((previous) => ({ ...previous, [field]: nextValue }));
        setIsDirty(true);
        setShowRegeneratePrompt(false);
        if (errors[field]) {
            setErrors((previous) => ({ ...previous, [field]: undefined }));
        }
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const payload = validate();
        if (!payload) {
            return;
        }

        await onSave(payload);
        setIsDirty(false);
        setShowRegeneratePrompt(true);
    };

    const handleRegenerateNow = async () => {
        await onRegenerateNow();
        setShowRegeneratePrompt(false);
    };

    return (
        <div className="space-y-6">
            <div className="rounded-3xl border border-surface-700 bg-surface-900/60 p-6">
                <div className="mb-4">
                    <h2 className="text-xl font-bold text-white">Perfil financeiro</h2>
                    <p className="mt-1 text-sm text-gray-400">
                        Edite os dados usados para acompanhar metas e orientar as sugestoes da IA.
                    </p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    <div className="rounded-2xl border border-surface-700 bg-surface-950/40 p-4">
                        <div className="mb-2 flex items-center gap-2">
                            <ArrowUpRight className="h-4 w-4 text-emerald-400" />
                            <span className="text-xs text-gray-400">Renda</span>
                        </div>
                        <p className="text-sm font-semibold text-white">{formatCurrency(summary.monthlyIncome)}</p>
                    </div>
                    <div className="rounded-2xl border border-surface-700 bg-surface-950/40 p-4">
                        <div className="mb-2 flex items-center gap-2">
                            <ArrowDownRight className="h-4 w-4 text-red-400" />
                            <span className="text-xs text-gray-400">Fixos</span>
                        </div>
                        <p className="text-sm font-semibold text-white">{formatCurrency(summary.fixedExpenses)}</p>
                    </div>
                    <div className="rounded-2xl border border-surface-700 bg-surface-950/40 p-4">
                        <div className="mb-2 flex items-center gap-2">
                            <Wallet className="h-4 w-4 text-amber-400" />
                            <span className="text-xs text-gray-400">Variaveis</span>
                        </div>
                        <p className="text-sm font-semibold text-white">{formatCurrency(summary.variableExpenses)}</p>
                    </div>
                    <div className="rounded-2xl border border-surface-700 bg-surface-950/40 p-4">
                        <div className="mb-2 flex items-center gap-2">
                            <PiggyBank className="h-4 w-4 text-indigo-300" />
                            <span className="text-xs text-gray-400">Meta de economia</span>
                        </div>
                        <p className="text-sm font-semibold text-white">{summary.savingsTargetPct.toFixed(0)}%</p>
                    </div>
                    <div className="rounded-2xl border border-surface-700 bg-surface-950/40 p-4 sm:col-span-2 xl:col-span-1">
                        <div className="mb-2 flex items-center gap-2">
                            <Wallet className="h-4 w-4 text-cyan-300" />
                            <span className="text-xs text-gray-400">Saldo livre</span>
                        </div>
                        <p className={`text-sm font-semibold ${summary.disposableIncome >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                            {formatCurrency(summary.disposableIncome)}
                        </p>
                    </div>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="rounded-3xl border border-surface-700 bg-surface-900/55 p-6">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Input
                        label="Renda mensal"
                        type="text"
                        inputMode="numeric"
                        value={values.monthlyIncome}
                        onChange={(event) => handleFieldChange('monthlyIncome', event.target.value)}
                        error={errors.monthlyIncome}
                    />

                    <Input
                        label="Gastos fixos"
                        type="text"
                        inputMode="numeric"
                        value={values.fixedExpenses}
                        onChange={(event) => handleFieldChange('fixedExpenses', event.target.value)}
                        error={errors.fixedExpenses}
                    />

                    <Input
                        label="Gastos variaveis"
                        type="text"
                        inputMode="numeric"
                        value={values.variableExpenses}
                        onChange={(event) => handleFieldChange('variableExpenses', event.target.value)}
                        error={errors.variableExpenses}
                    />

                    <Input
                        label="Meta de economia (%)"
                        type="text"
                        inputMode="decimal"
                        value={values.savingsTargetPct}
                        onChange={(event) => handleFieldChange('savingsTargetPct', event.target.value)}
                        error={errors.savingsTargetPct}
                    />
                </div>

                <div className="mt-4">
                    <label className="mb-1.5 block text-sm font-medium text-gray-300" htmlFor="financial-goals-text">
                        Objetivos financeiros (opcional)
                    </label>
                    <textarea
                        id="financial-goals-text"
                        rows={4}
                        maxLength={FINANCIAL_GOALS_TEXT_LIMIT}
                        value={values.financialGoalsText}
                        onChange={(event) => handleFieldChange('financialGoalsText', event.target.value)}
                        className={`block w-full rounded-lg border border-surface-700 bg-surface-900/50 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${errors.financialGoalsText ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''
                            }`}
                        placeholder="Ex: Quero juntar para uma viagem e montar reserva de emergencia."
                    />
                    <div className="mt-1 flex items-center justify-between text-xs">
                        {errors.financialGoalsText ? (
                            <span className="text-red-500">{errors.financialGoalsText}</span>
                        ) : (
                            <span className="text-gray-500">Descreva seus objetivos para orientar as sugestoes da IA.</span>
                        )}
                        <span className="text-gray-500">
                            {values.financialGoalsText.length}/{FINANCIAL_GOALS_TEXT_LIMIT}
                        </span>
                    </div>
                </div>

                <div className="mt-6 flex justify-end">
                    <Button type="submit" isLoading={isSaving} disabled={!isDirty || isGenerating}>
                        Salvar alteracoes
                    </Button>
                </div>
            </form>

            {showRegeneratePrompt && (
                <div className="rounded-3xl border border-indigo-400/25 bg-indigo-500/10 p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                            <p className="text-sm font-semibold text-indigo-100">Perfil salvo. Deseja regenerar metas com IA agora?</p>
                            <p className="text-xs text-indigo-200/80">
                                Novas metas serao adicionadas sem apagar as metas atuais.
                            </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <Button variant="secondary" onClick={() => setShowRegeneratePrompt(false)} disabled={isGenerating}>
                                Agora n\u00e3o
                            </Button>
                            <Button onClick={handleRegenerateNow} isLoading={isGenerating}>
                                <Sparkles className="mr-2 h-4 w-4" />
                                Regenerar agora
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
