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
import { normalizePhoneNumber } from '@/utils/whatsapp';

const settingsSchema = z.object({
    budget: z.number().min(0, 'O orcamento nao pode ser negativo'),
    startDay: z.number().min(1).max(31, 'O dia deve ser entre 1 e 31'),
    currency: z.string().min(1, 'A moeda e obrigatoria'),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

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
            .map(normalizePhoneNumber)
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
                    .map(normalizePhoneNumber)
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
        const normalized = normalizePhoneNumber(whatsappInput);
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
            await update({ whatsappAllowedNumbers });
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
        <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8 animate-fade-in">
            <div className="mb-10">
                <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">Configurações</h1>
                <p className="text-sm text-gray-500 mt-2">
                    Gerencie suas preferências, orçamento, perfil e alertas do WhatsApp.
                </p>
            </div>

            <div className="space-y-8">
                {/* Profile Section */}
                <section className="relative overflow-hidden rounded-3xl border border-surface-800 bg-[#0c1216] shadow-2xl">
                    <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-br from-indigo-900/20 to-purple-900/20 opacity-50" />

                    <div className="relative p-6 sm:p-10">
                        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 mb-8 text-center sm:text-left">
                            <div className="relative">
                                <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-4xl font-bold text-white uppercase shadow-xl shadow-indigo-500/20 ring-4 ring-surface-900 ring-offset-2 ring-offset-[#0c1216] z-10">
                                    {displayName?.charAt(0) || user?.email?.charAt(0) || 'U'}
                                </div>
                                <div className="absolute inset-0 rounded-full bg-indigo-500 blur-xl opacity-40 animate-pulse" />
                            </div>

                            <div className="mt-2 sm:mt-4">
                                <h2 className="text-2xl font-semibold text-white tracking-tight">{displayName || 'Usuário SaldoPro'}</h2>
                                <p className="text-indigo-400 font-medium">{user?.email}</p>
                            </div>
                        </div>

                        <div className="bg-[#0f1419] rounded-2xl p-5 border border-surface-800/60 inline-block w-full text-sm text-gray-400">
                            <div className="flex gap-2 items-center mb-2">
                                <User className="w-4 h-4 text-indigo-400" />
                                <span className="font-medium text-gray-300">Detalhes da Conta</span>
                            </div>
                            <p className="mb-1">Conta criada em: <span className="text-gray-200">{user?.metadata.creationTime ? new Date(user.metadata.creationTime).toLocaleDateString('pt-BR') : 'Desconhecido'}</span></p>
                            <p>Os dados de perfil (nome e email) são gerenciados com segurança pela sua conta Google/Firebase.</p>
                        </div>
                    </div>
                </section>

                {/* Preferences Section */}
                <section className="rounded-3xl border border-surface-800 bg-[#0c1216] shadow-2xl overflow-hidden relative">
                    <div className="p-6 sm:p-10 border-b border-surface-800/50 bg-[#0c1216]">
                        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                            Preferências do Aplicativo
                        </h2>
                        <p className="text-sm text-gray-500 mt-2 max-w-2xl">
                            Ajuste como os cálculos são feitos e como seu painel de controle interage com suas metas diárias.
                        </p>
                    </div>

                    <form onSubmit={handleSubmit(onSubmit)} className="p-6 sm:p-10 space-y-8 bg-[#0a0f12]">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="md:col-span-2 hidden bg-[#0f1419] p-6 rounded-2xl border border-surface-800/80">
                                <Input
                                    label="Orçamento Mensal (Meta de gastos)"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    icon={DollarSign}
                                    error={errors.budget?.message}
                                    {...register('budget', { valueAsNumber: true })}
                                />
                            </div>

                            <div className="bg-[#0f1419] p-6 rounded-2xl border border-surface-800/80">
                                <Input
                                    label="Dia de fechamento/início"
                                    type="number"
                                    min="1"
                                    max="31"
                                    icon={Calendar}
                                    error={errors.startDay?.message}
                                    {...register('startDay', { valueAsNumber: true })}
                                    disabled
                                />
                                <p className="mt-2 text-xs text-gray-600">Fixo no dia 1 (MVP)</p>
                            </div>

                            <div className="bg-[#0f1419] p-6 rounded-2xl border border-surface-800/80">
                                <Controller
                                    name="currency"
                                    control={control}
                                    render={({ field }) => (
                                        <Select
                                            label="Moeda Principal"
                                            options={[{ value: 'BRL', label: 'BRL - Real Brasileiro' }]}
                                            error={errors.currency?.message}
                                            disabled
                                            {...field}
                                        />
                                    )}
                                />
                                <p className="mt-2 text-xs text-gray-600">Apenas BRL disponível (MVP)</p>
                            </div>
                        </div>

                        <div className="flex justify-end pt-8 border-t border-surface-800/50">
                            <Button
                                type="submit"
                                isLoading={isSaving}
                                disabled={!isDirty}
                                className="px-8 py-6 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-lg shadow-indigo-500/25 transition-all w-full sm:w-auto text-lg"
                            >
                                <Save className="w-5 h-5 mr-3" />
                                Salvar Preferências
                            </Button>
                        </div>
                    </form>
                </section>

                {/* WhatsApp Section */}
                <section className="rounded-3xl border border-surface-800 bg-[#0c1216] shadow-2xl overflow-hidden relative">
                    <div className="p-6 sm:p-10 border-b border-surface-800/50 bg-[#0c1216]">
                        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                            WhatsApp Autorizado
                        </h2>
                        <p className="text-sm text-gray-500 mt-2 max-w-2xl">
                            Apenas números cadastrados aqui podem receber respostas da IA no WhatsApp.
                        </p>
                    </div>

                    <div className="p-6 sm:p-10 space-y-8 bg-[#0a0f12]">
                        <div className="bg-[#0f1419] p-6 rounded-2xl border border-surface-800/80 flex flex-col sm:flex-row gap-4 items-end">
                            <div className="flex-1 w-full">
                                <Input
                                    label="Número com DDI (Ex: 5511999999999)"
                                    placeholder="55..."
                                    icon={Phone}
                                    value={whatsappInput}
                                    onChange={(event) => setWhatsappInput(event.target.value)}
                                />
                            </div>
                            <Button
                                type="button"
                                onClick={handleAddNumber}
                                className="w-full sm:w-auto h-11"
                                variant="secondary"
                            >
                                <Plus className="w-4 h-4 mr-2" />
                                Adicionar
                            </Button>
                        </div>

                        {whatsappAllowedNumbers.length === 0 ? (
                            <div className="bg-[#0f1419] rounded-2xl p-8 border border-surface-800/60 text-center">
                                <p className="text-gray-500">
                                    Nenhum número autorizado ainda. As mensagens recebidas serão ignoradas.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {whatsappAllowedNumbers.map((phone) => (
                                    <div
                                        key={phone}
                                        className="flex items-center justify-between rounded-xl border border-surface-800/80 bg-[#0f1419] px-5 py-4 shadow-sm"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
                                                <Phone className="w-4 h-4 text-green-500" />
                                            </div>
                                            <span className="text-sm font-medium text-gray-200">{phone}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveNumber(phone)}
                                            className="rounded-lg p-2 text-gray-500 hover:bg-red-500/10 hover:text-red-400 transition-colors focus:outline-none"
                                            aria-label={`Remover ${phone}`}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="flex justify-end pt-8 border-t border-surface-800/50">
                            <Button
                                type="button"
                                isLoading={isSavingNumbers}
                                disabled={!hasNumbersChanged}
                                onClick={handleSaveNumbers}
                                className="px-8 py-6 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-lg shadow-indigo-500/25 transition-all w-full sm:w-auto text-lg"
                            >
                                <Save className="w-5 h-5 mr-3" />
                                Salvar Números
                            </Button>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
