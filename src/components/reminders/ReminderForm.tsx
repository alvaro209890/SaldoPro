import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Calendar, FileText, DollarSign, ArrowDown, ArrowUp } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { Reminder, ReminderFormData } from '@/types';

const reminderSchema = z.object({
    type: z.enum(['payable', 'receivable']),
    amount: z.number().min(0.01, 'O valor deve ser maior que zero'),
    dueDate: z.string().min(1, 'A data de vencimento é obrigatória'),
    title: z.string().min(1, 'O título é obrigatório'),
    status: z.enum(['pending', 'paid']),
});

interface ReminderFormProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: ReminderFormData) => Promise<void>;
    onDelete?: () => Promise<void>;
    initialData?: Reminder | null;
}

export function ReminderForm({
    isOpen,
    onClose,
    onSubmit,
    onDelete,
    initialData,
}: ReminderFormProps) {
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
    } = useForm<ReminderFormData>({
        resolver: zodResolver(reminderSchema),
        defaultValues: {
            type: 'payable',
            amount: 0,
            dueDate: new Date().toISOString().split('T')[0],
            title: '',
            status: 'pending',
        },
    });

    const type = watch('type');

    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                reset({
                    type: initialData.type,
                    amount: initialData.amount,
                    dueDate: initialData.dueDate,
                    title: initialData.title,
                    status: initialData.status,
                });
            } else {
                const today = new Date().toISOString().split('T')[0];
                reset({
                    type: 'payable',
                    amount: 0,
                    dueDate: today,
                    title: '',
                    status: 'pending',
                });
            }
            setShowDeleteConfirm(false);
        }
    }, [isOpen, initialData, reset]);

    const handleFormSubmit = async (data: ReminderFormData) => {
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
            title={initialData ? 'Editar Lembrete' : 'Novo Lembrete'}
        >
            <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
                {/* Toggle Type */}
                <div className="grid grid-cols-2 gap-2 p-1 bg-surface-800 rounded-xl">
                    <button
                        type="button"
                        onClick={() => setValue('type', 'payable')}
                        className={`flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-lg transition-all ${type === 'payable'
                            ? 'bg-red-500 text-white shadow-md'
                            : 'text-gray-400 hover:text-gray-200'
                            }`}
                    >
                        <ArrowDown className="h-4 w-4" /> A Pagar
                    </button>
                    <button
                        type="button"
                        onClick={() => setValue('type', 'receivable')}
                        className={`flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-lg transition-all ${type === 'receivable'
                            ? 'bg-emerald-500 text-white shadow-md'
                            : 'text-gray-400 hover:text-gray-200'
                            }`}
                    >
                        <ArrowUp className="h-4 w-4" /> A Receber
                    </button>
                </div>

                <div className="grid gap-6 sm:grid-cols-2">
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
                        error={errors.title?.message}
                        {...register('title')}
                        className="sm:col-span-2"
                    />

                    <Input
                        label="Vencimento"
                        type="date"
                        icon={Calendar}
                        error={errors.dueDate?.message}
                        {...register('dueDate')}
                        className="sm:col-span-2"
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
