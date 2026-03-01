import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Calendar, Tag, FileText, CreditCard, DollarSign, ArrowDown, ArrowUp } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { PAYMENT_METHOD_LABELS } from '@/utils/constants';
import type { Transaction, Category, TransactionFormData } from '@/types';

const transactionSchema = z.object({
    type: z.enum(['income', 'expense']),
    amount: z.number().min(0.01, 'O valor deve ser maior que zero'),
    date: z.string().min(1, 'A data é obrigatória'),
    category: z.string().min(1, 'A categoria é obrigatória'),
    description: z.string().min(1, 'A descrição é obrigatória'),
    paymentMethod: z.enum(['pix', 'credit', 'debit', 'cash', 'transfer', 'boleto']),
});

interface TransactionFormProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: TransactionFormData) => Promise<void>;
    onDelete?: () => Promise<void>;
    initialData?: Transaction | null;
    categories: Category[];
    defaultDate?: string;
}

export function TransactionForm({
    isOpen,
    onClose,
    onSubmit,
    onDelete,
    initialData,
    categories,
    defaultDate,
}: TransactionFormProps) {
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
    } = useForm<TransactionFormData>({
        resolver: zodResolver(transactionSchema),
        defaultValues: {
            type: 'expense',
            amount: 0,
            date: defaultDate || new Date().toISOString().split('T')[0],
            category: '',
            description: '',
            paymentMethod: 'pix',
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
                    date: initialData.date,
                    category: initialData.category,
                    description: initialData.description,
                    paymentMethod: initialData.paymentMethod,
                });
            } else {
                const today = new Date().toISOString().split('T')[0];
                reset({
                    type: 'expense',
                    amount: 0,
                    date: defaultDate || today,
                    category: '',
                    description: '',
                    paymentMethod: 'pix',
                });
            }
            setShowDeleteConfirm(false);
        }
    }, [isOpen, initialData, reset, defaultDate]);

    useEffect(() => {
        if (filteredCategories.length > 0 && !initialData) {
            setValue('category', filteredCategories[0].id);
        }
    }, [type, filteredCategories, setValue, initialData]);

    const handleFormSubmit = async (data: TransactionFormData) => {
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
            title={initialData ? 'Editar Transação' : 'Nova Transação'}
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
                    {/* Amount field needs custom parsing so input type text but logic handles it visually better? Number is simpler for MVP */}
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
                        placeholder="Ex: Supermercado"
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

                    <Input
                        label="Data"
                        type="date"
                        icon={Calendar}
                        error={errors.date?.message}
                        {...register('date')}
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
                </div>

                {/* Actions inside form for context */}
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
