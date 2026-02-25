import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { User, DollarSign, Calendar, Save } from 'lucide-react';
import { useEffect, useState } from 'react';

const settingsSchema = z.object({
    budget: z.number().min(0, 'O orçamento não pode ser negativo'),
    startDay: z.number().min(1).max(31, 'O dia deve ser entre 1 e 31'),
    currency: z.string().min(1, 'A moeda é obrigatória'),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

export function Settings() {
    const { user, displayName } = useAuth();
    const { settings, loading, update } = useSettings();
    const [isSaving, setIsSaving] = useState(false);

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

    useEffect(() => {
        if (settings) {
            reset({
                budget: settings.budget,
                startDay: settings.startDay,
                currency: settings.currency,
            });
        }
    }, [settings, reset]);

    const onSubmit = async (data: SettingsFormData) => {
        setIsSaving(true);
        try {
            await update(data);
            reset(data); // reset isDirty state
        } finally {
            setIsSaving(false);
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
                <h1 className="text-2xl font-bold text-white">Configurações</h1>
                <p className="text-sm text-gray-400 mt-1">
                    Gerencie suas preferências e perfil.
                </p>
            </div>

            <div className="space-y-8">
                {/* Profile Section */}
                <section className="rounded-2xl border border-surface-700 bg-surface-900/50 glass-card p-6 sm:p-8">
                    <div className="flex items-center gap-4 mb-6 pb-6 border-b border-surface-800">
                        <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-2xl font-bold text-white uppercase shadow-lg shadow-indigo-500/20">
                            {displayName?.charAt(0) || user?.email?.charAt(0) || 'U'}
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-white">{displayName || 'Usuário'}</h2>
                            <p className="text-sm text-gray-400">{user?.email}</p>
                        </div>
                    </div>

                    <div className="text-sm text-gray-400">
                        <p className="mb-2">Conta criada em: {user?.metadata.creationTime ? new Date(user.metadata.creationTime).toLocaleDateString('pt-BR') : 'Desconhecido'}</p>
                        <p>Os dados de perfil (nome e email) são gerenciados na sua conta do Google/Firebase.</p>
                    </div>
                </section>

                {/* Preferences Section */}
                <section className="rounded-2xl border border-surface-700 bg-surface-900/50 glass-card overflow-hidden">
                    <div className="p-6 border-b border-surface-800">
                        <h2 className="text-lg font-semibold text-white">Preferências do App</h2>
                        <p className="text-sm text-gray-400 mt-1">
                            Personalize como o SaldoPro funciona para você.
                        </p>
                    </div>

                    <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div className="sm:col-span-2">
                                <Input
                                    label="Orçamento Mensal (Meta de gastos)"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    icon={DollarSign}
                                    error={errors.budget?.message}
                                    {...register('budget', { valueAsNumber: true })}
                                />
                                <p className="mt-1 text-xs text-gray-500">
                                    Defina um limite ideal de gastos. Isso habilitará o card de acompanhamento no Dashboard. Se for 0, o card não aparecerá.
                                </p>
                            </div>

                            <Input
                                label="Dia de fechamento/início"
                                type="number"
                                min="1"
                                max="31"
                                icon={Calendar}
                                error={errors.startDay?.message}
                                {...register('startDay', { valueAsNumber: true })}
                                disabled // Disabled for MVP
                            />

                            <Controller
                                name="currency"
                                control={control}
                                render={({ field }) => (
                                    <Select
                                        label="Moeda"
                                        options={[{ value: 'BRL', label: 'BRL - Real Brasileiro' }]}
                                        error={errors.currency?.message}
                                        disabled // Fixed for MVP
                                        {...field}
                                    />
                                )}
                            />
                        </div>

                        <div className="flex justify-end pt-4 border-t border-surface-800">
                            <Button type="submit" isLoading={isSaving} disabled={!isDirty}>
                                <Save className="w-4 h-4 mr-2" />
                                Salvar alterações
                            </Button>
                        </div>
                    </form>
                </section>
            </div>
        </div>
    );
}
