import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Calendar, Tag, FileText, CreditCard, DollarSign, ArrowDown, ArrowUp, Repeat } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { PAYMENT_METHOD_LABELS, FREQUENCY_LABELS } from '@/utils/constants';
import type { RecurringTransaction, Category, RecurringTransactionFormData } from '@/types';

const recurringTransactionSchema = z.object({
    type: z.enum(['income', 'expense']),
    amount: z.number().min(0.01, 'O valor deve ser maior que zero'),
    description: z.string().min(1, 'A descri\u00e7\u00e3o \u00e9 obrigat\u00f3ria'),
    category: z.string().min(1, 'A categoria e obrigatoria'),
    paymentMethod: z.enum(['pix', 'credit', 'debit', 'cash', 'transfer', 'boleto']),
    frequency: z.enum(['weekly', 'monthly', 'yearly']),
    startDate: z.string().min(1, 'A data de inicio e obrigatoria'),
    endDate: z.string(),
});

interface RecurringTransactionFormProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: RecurringTransactionFormData) => Promise<void>;
    onDelete?: () => Promise<void>;
    initialData?: RecurringTransaction | null;
    categories: Category[];
}

export function RecurringTransactionForm({
    isOpen,
    onClose,
    onSubmit,
    onDelete,
    initialData,
    categories,
}: RecurringTransactionFormProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const {
        register,
        handleSubmit,
        control,
        watch,
        reset,
        setValue,
        formState: { errors },
    } = useForm<RecurringTransactionFormData>({
        resolver: zodResolver(recurringTransactionSchema),
        defaultValues: {
            type: 'expense',
            amount: 0,
            description: '',
            category: '',
            paymentMethod: 'pix',
            frequency: 'monthly',
            startDate: new Date().toISOString().split('T')[0],
            endDate: '',
        },
    });

    const type = watch('type');
    const filteredCategories = categories.filter((c) => c.type === type);

    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                reset({
                    type: initialData.type,
                    amount: initialData.amount,
                    description: initialData.description,
                    category: initialData.category,
                    paymentMethod: initialData.paymentMethod,
                    frequency: initialData.frequency,
                    startDate: initialData.startDate,
                    endDate: initialData.endDate || '',
                });
            } else {
                const today = new Date().toISOString().split('T')[0];
                reset({
                    type: 'expense',
                    amount: 0,
                    description: '',
                    category: '',
                    paymentMethod: 'pix',
                    frequency: 'monthly',
                    startDate: today,
                    endDate: '',
                });
            }
            setShowDeleteConfirm(false);
        }
    }, [isOpen, initialData, reset]);

    useEffect(() => {
        if (filteredCategories.length > 0 && !initialData) {
            setValue('category', filteredCategories[0].id);
        }
    }, [type, filteredCategories, setValue, initialData]);

    const handleFormSubmit = async (data: RecurringTransactionFormData) => {
        setIsLoading(true);
        try {
            await onSubmit(data);
            onClose();
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!onDelete) return;
        setIsDeleting(true);
        try {
            await onDelete();
            onClose();
        } catch (error) {
            console.error(error);
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={initialData ? 'Editar Recorrente' : 'Nova Recorrente'}
        >
            <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-5 sm:space-y-6">
                {/* Toggle Type */}
                <div className="grid grid-cols-2 gap-2 p-1 bg-surface-800 rounded-xl">
                    <button
                        type="button"
                        onClick={() => setValue('type', 'expense')}
                        className={`flex flex-col items-center justify-center gap-1 rounded-lg py-2.5 text-xs font-medium transition-all sm:flex-row sm:gap-2 sm:text-sm ${type === 'expense'
                            ? 'bg-red-500 text-white shadow-md'
                            : 'text-gray-400 hover:text-gray-200'
                            }`}
                    >
                        <ArrowDown className="h-4 w-4" /> Despesa
                    </button>
                    <button
                        type="button"
                        onClick={() => setValue('type', 'income')}
                        className={`flex flex-col items-center justify-center gap-1 rounded-lg py-2.5 text-xs font-medium transition-all sm:flex-row sm:gap-2 sm:text-sm ${type === 'income'
                            ? 'bg-emerald-500 text-white shadow-md'
                            : 'text-gray-400 hover:text-gray-200'
                            }`}
                    >
                        <ArrowUp className="h-4 w-4" /> Receita
                    </button>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
                    {/* Amount */}
                    <div className="sm:col-span-2">
                        <Controller
                            name="amount"
                            control={control}
                            render={({ field }) => {
                                const displayValue = field.value
                                    ? new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(field.value)
                                    : '';

                                const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
                                    const digits = e.target.value.replace(/\D/g, '');
                                    const numberValue = digits ? parseInt(digits, 10) / 100 : 0;
                                    field.onChange(numberValue);
                                };

                                return (
                                    <Input
                                        label="Valor"
                                        type="text"
                                        inputMode="numeric"
                                        icon={DollarSign}
                                        placeholder="0,00"
                                        error={errors.amount?.message}
                                        value={displayValue}
                                        onChange={handleAmountChange}
                                        onBlur={field.onBlur}
                                        ref={field.ref}
                                    />
                                );
                            }}
                        />
                    </div>

                    <Input
                        label="Descrição"
                        icon={FileText}
                        placeholder="Ex: Aluguel"
                        error={errors.description?.message}
                        {...register('description')}
                    />

                    <Controller
                        name="category"
                        control={control}
                        render={({ field }) => (
                            <Select
                                label="Categoria"
                                icon={Tag}
                                error={errors.category?.message}
                                options={[
                                    { value: '', label: 'Selecione...' },
                                    ...filteredCategories.map((c) => ({ value: c.id, label: c.name })),
                                ]}
                                {...field}
                            />
                        )}
                    />

                    <Controller
                        name="paymentMethod"
                        control={control}
                        render={({ field }) => (
                            <Select
                                label="Forma de Pagamento"
                                icon={CreditCard}
                                error={errors.paymentMethod?.message}
                                options={Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({
                                    value,
                                    label,
                                }))}
                                {...field}
                            />
                        )}
                    />

                    <Controller
                        name="frequency"
                        control={control}
                        render={({ field }) => (
                            <Select
                                label="Frequência"
                                icon={Repeat}
                                error={errors.frequency?.message}
                                options={Object.entries(FREQUENCY_LABELS).map(([value, label]) => ({
                                    value,
                                    label,
                                }))}
                                {...field}
                            />
                        )}
                    />

                    <Input
                        label="Data de Início"
                        type="date"
                        icon={Calendar}
                        error={errors.startDate?.message}
                        {...register('startDate')}
                    />

                    <Input
                        label="Data Final (opcional)"
                        type="date"
                        icon={Calendar}
                        error={errors.endDate?.message}
                        {...register('endDate')}
                    />
                </div>

                {/* Actions */}
                <div className="flex flex-col-reverse gap-3 border-t border-surface-700 pt-3 sm:flex-row sm:pt-4">
                    {initialData && onDelete && (
                        <div className="flex-1">
                            {showDeleteConfirm ? (
                                <div className="flex flex-col gap-2 animate-fade-in sm:flex-row sm:items-center">
                                    <Button
                                        type="button"
                                        variant="danger"
                                        isLoading={isDeleting}
                                        onClick={handleDelete}
                                        className="flex-1"
                                    >
                                        Confirmar
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => setShowDeleteConfirm(false)}
                                        className="w-full px-4 sm:w-auto sm:flex-none"
                                    >
                                        Cancelar
                                    </Button>
                                </div>
                            ) : (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => setShowDeleteConfirm(true)}
                                    className="w-full sm:w-auto text-red-500 hover:text-red-400 hover:bg-red-500/10"
                                >
                                    Excluir
                                </Button>
                            )}
                        </div>
                    )}
                    <div className="flex flex-col sm:flex-row flex-1 gap-3 justify-end">
                        <Button type="button" variant="ghost" onClick={onClose} disabled={isLoading} className="w-full sm:w-auto">
                            Cancelar
                        </Button>
                        <Button type="submit" isLoading={isLoading} className="w-full sm:w-auto">
                            Salvar
                        </Button>
                    </div>
                </div>
            </form>
        </Modal>
    );
}
