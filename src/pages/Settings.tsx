import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { User, DollarSign, Calendar, Save, Phone, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

const settingsSchema = z.object({
    budget: z.number().min(0, 'O orcamento nao pode ser negativo'),
    startDay: z.number().min(1).max(31, 'O dia deve ser entre 1 e 31'),
    currency: z.string().min(1, 'A moeda e obrigatoria'),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

function normalizePhone(value: string): string {
    return value.replace(/[^\d]/g, '');
}

function arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((item, index) => item === b[index]);
}

export function Settings() {
    const { user, displayName } = useAuth();
    const { settings, loading, update } = useSettings();
    const [isSaving, setIsSaving] = useState(false);
    const [isSavingNumbers, setIsSavingNumbers] = useState(false);
    const [whatsappInput, setWhatsappInput] = useState('');
    const [whatsappAllowedNumbers, setWhatsappAllowedNumbers] = useState<string[]>([]);

    const {
        register,
        handleSubmit,
        reset,
        control,
        formState: { errors, isDirty },
    } = useForm<SettingsFormData>({
        resolver: zodResolver(settingsSchema),
        defaultValues: {
            budget: 0,
            startDay: 1,
            currency: 'BRL',
        },
    });

    const persistedNumbers = useMemo(() => {
        return (settings?.whatsappAllowedNumbers || [])
            .map(normalizePhone)
            .filter((phone) => phone.length >= 10);
    }, [settings]);

    const hasNumbersChanged = useMemo(() => {
        return !arraysEqual(persistedNumbers, whatsappAllowedNumbers);
    }, [persistedNumbers, whatsappAllowedNumbers]);

    useEffect(() => {
        if (settings) {
            reset({
                budget: settings.budget,
                startDay: settings.startDay,
                currency: settings.currency,
            });
            setWhatsappAllowedNumbers(
                (settings.whatsappAllowedNumbers || [])
                    .map(normalizePhone)
                    .filter((phone) => phone.length >= 10)
            );
        }
    }, [settings, reset]);

    const onSubmit = async (data: SettingsFormData) => {
        setIsSaving(true);
        try {
            await update(data);
            reset(data);
        } finally {
            setIsSaving(false);
        }
    };

    const handleAddNumber = () => {
        const normalized = normalizePhone(whatsappInput);
        if (normalized.length < 10) {
            toast.error('Digite um numero valido com DDD e codigo do pais.');
            return;
        }

        if (whatsappAllowedNumbers.includes(normalized)) {
            toast.info('Este numero ja esta cadastrado.');
            return;
        }

        setWhatsappAllowedNumbers((prev) => [...prev, normalized]);
        setWhatsappInput('');
    };

    const handleRemoveNumber = (phone: string) => {
        setWhatsappAllowedNumbers((prev) => prev.filter((item) => item !== phone));
    };

    const handleSaveNumbers = async () => {
        setIsSavingNumbers(true);
        try {
            await update({
                whatsappAllowedNumbers,
            });
        } finally {
            setIsSavingNumbers(false);
        }
    };

    if (loading) {
        return (
            <div className="space-y-6">
                <LoadingSkeleton variant="text" className="w-48 h-8" />
                <LoadingSkeleton variant="card" className="max-w-2xl h-[400px]" />
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-2xl animate-fade-in">
            <div>
                <h1 className="text-2xl font-bold text-white">Configuracoes</h1>
                <p className="text-sm text-gray-400 mt-1">
                    Gerencie suas preferencias e perfil.
                </p>
            </div>

            <div className="space-y-8">
                <section className="rounded-2xl border border-surface-700 bg-surface-900/50 glass-card p-6 sm:p-8">
                    <div className="flex items-center gap-4 mb-6 pb-6 border-b border-surface-800">
                        <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-2xl font-bold text-white uppercase shadow-lg shadow-indigo-500/20">
                            {displayName?.charAt(0) || user?.email?.charAt(0) || 'U'}
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-white">{displayName || 'Usuario'}</h2>
                            <p className="text-sm text-gray-400">{user?.email}</p>
                        </div>
                    </div>

                    <div className="text-sm text-gray-400">
                        <p className="mb-2">Conta criada em: {user?.metadata.creationTime ? new Date(user.metadata.creationTime).toLocaleDateString('pt-BR') : 'Desconhecido'}</p>
                        <p>Os dados de perfil (nome e email) sao gerenciados na sua conta do Google/Firebase.</p>
                    </div>
                </section>

                <section className="rounded-2xl border border-surface-700 bg-surface-900/50 glass-card overflow-hidden">
                    <div className="p-6 border-b border-surface-800">
                        <h2 className="text-lg font-semibold text-white">Preferencias do App</h2>
                        <p className="text-sm text-gray-400 mt-1">
                            Personalize como o SaldoPro funciona para voce.
                        </p>
                    </div>

                    <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div className="sm:col-span-2">
                                <Input
                                    label="Orcamento Mensal (Meta de gastos)"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    icon={DollarSign}
                                    error={errors.budget?.message}
                                    {...register('budget', { valueAsNumber: true })}
                                />
                                <p className="mt-1 text-xs text-gray-500">
                                    Defina um limite ideal de gastos. Isso habilita o card de acompanhamento no Dashboard. Se for 0, o card nao aparece.
                                </p>
                            </div>

                            <Input
                                label="Dia de fechamento/inicio"
                                type="number"
                                min="1"
                                max="31"
                                icon={Calendar}
                                error={errors.startDay?.message}
                                {...register('startDay', { valueAsNumber: true })}
                                disabled
                            />

                            <Controller
                                name="currency"
                                control={control}
                                render={({ field }) => (
                                    <Select
                                        label="Moeda"
                                        options={[{ value: 'BRL', label: 'BRL - Real Brasileiro' }]}
                                        error={errors.currency?.message}
                                        disabled
                                        {...field}
                                    />
                                )}
                            />
                        </div>

                        <div className="flex justify-end pt-4 border-t border-surface-800">
                            <Button type="submit" isLoading={isSaving} disabled={!isDirty}>
                                <Save className="w-4 h-4 mr-2" />
                                Salvar alteracoes
                            </Button>
                        </div>
                    </form>
                </section>

                <section className="rounded-2xl border border-surface-700 bg-surface-900/50 glass-card overflow-hidden">
                    <div className="p-6 border-b border-surface-800">
                        <h2 className="text-lg font-semibold text-white">WhatsApp Autorizado</h2>
                        <p className="text-sm text-gray-400 mt-1">
                            Apenas numeros cadastrados aqui podem receber resposta da IA no WhatsApp.
                        </p>
                    </div>

                    <div className="p-6 space-y-4">
                        <div className="flex flex-col sm:flex-row gap-3">
                            <Input
                                label="Numero com DDI"
                                placeholder="Ex: 5511999999999"
                                icon={Phone}
                                value={whatsappInput}
                                onChange={(event) => setWhatsappInput(event.target.value)}
                            />
                            <Button
                                type="button"
                                onClick={handleAddNumber}
                                className="sm:self-end"
                                variant="secondary"
                            >
                                <Plus className="w-4 h-4 mr-2" />
                                Adicionar
                            </Button>
                        </div>

                        {whatsappAllowedNumbers.length === 0 ? (
                            <p className="text-sm text-gray-500">
                                Nenhum numero autorizado. Mensagens recebidas serao ignoradas.
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {whatsappAllowedNumbers.map((phone) => (
                                    <div
                                        key={phone}
                                        className="flex items-center justify-between rounded-xl border border-surface-700 bg-surface-900/70 px-4 py-2"
                                    >
                                        <span className="text-sm font-medium text-gray-200">{phone}</span>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveNumber(phone)}
                                            className="rounded-lg p-1.5 text-gray-500 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                                            aria-label={`Remover ${phone}`}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="flex justify-end pt-2">
                            <Button
                                type="button"
                                isLoading={isSavingNumbers}
                                disabled={!hasNumbersChanged}
                                onClick={handleSaveNumbers}
                            >
                                <Save className="w-4 h-4 mr-2" />
                                Salvar numeros
                            </Button>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
