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
            <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
                {/* Toggle Type */}
                <div className="grid grid-cols-2 gap-2 p-1 bg-surface-800 rounded-xl">
                    <button
                        type="button"
                        onClick={() => setValue('type', 'expense')}
                        className={`flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-lg transition-all ${type === 'expense'
                                ? 'bg-red-500 text-white shadow-md'
                                : 'text-gray-400 hover:text-gray-200'
                            }`}
                    >
                        <ArrowDown className="h-4 w-4" /> Despesa
                    </button>
                    <button
                        type="button"
                        onClick={() => setValue('type', 'income')}
                        className={`flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-lg transition-all ${type === 'income'
                                ? 'bg-emerald-500 text-white shadow-md'
                                : 'text-gray-400 hover:text-gray-200'
                            }`}
                    >
                        <ArrowUp className="h-4 w-4" /> Receita
                    </button>
                </div>

                <div className="grid gap-6 sm:grid-cols-2">
                    {/* Amount field needs custom parsing so input type text but logic handles it visually better? Number is simpler for MVP */}
                    <div className="sm:col-span-2">
                        <Controller
                            name="amount"
                            control={control}
                            render={({ field }) => (
                                <Input
                                    label="Valor"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    icon={DollarSign}
                                    placeholder="0,00"
                                    error={errors.amount?.message}
                                    {...field}
                                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                />
                            )}
                        />
                    </div>

                    <Input
                        label="Descrição"
                        icon={FileText}
                        placeholder="Ex: Supermercado"
                        error={errors.description?.message}
                        {...register('description')}
                    />

                    <Select
                        label="Categoria"
                        icon={Tag}
                        error={errors.category?.message}
                        options={[
                            { value: '', label: 'Selecione...' },
                            ...filteredCategories.map((c) => ({ value: c.id, label: c.name })),
                        ]}
                        {...register('category')}
                    />

                    <Input
                        label="Data"
                        type="date"
                        icon={Calendar}
                        error={errors.date?.message}
                        {...register('date')}
                    />

                    <Select
                        label="Forma de Pagamento"
                        icon={CreditCard}
                        error={errors.paymentMethod?.message}
                        options={Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({
                            value,
                            label,
                        }))}
                        {...register('paymentMethod')}
                    />
                </div>

                {/* Actions inside form for context */}
                <div className="flex flex-col-reverse sm:flex-row gap-3 pt-4 border-t border-surface-700">
                    {initialData && onDelete && (
                        <div className="flex-1">
                            {showDeleteConfirm ? (
                                <div className="flex items-center gap-2 animate-fade-in">
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
                                        className="flex-none px-4"
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
                    <div className="flex flex-1 gap-3 justify-end">
                        <Button type="button" variant="ghost" onClick={onClose} disabled={isLoading}>
                            Cancelar
                        </Button>
                        <Button type="submit" isLoading={isLoading} className="flex-1 sm:flex-none">
                            Salvar
                        </Button>
                    </div>
                </div>
            </form>
        </Modal>
    );
}
