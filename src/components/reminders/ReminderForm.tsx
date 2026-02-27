import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Calendar, FileText, DollarSign, ArrowDown, ArrowUp, Bell, Clock3 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { Reminder, ReminderFormData } from '@/types';

const reminderSchema = z.object({
  reminderKind: z.enum(['general', 'payable', 'receivable']),
  amount: z.number().nullable().optional(),
  dueDate: z.string().min(1, 'A data de vencimento e obrigatoria'),
  dueTime: z.string().nullable().optional(),
  title: z.string().min(1, 'O texto do lembrete e obrigatorio'),
  status: z.enum(['pending', 'paid']),
  type: z.enum(['payable', 'receivable']).nullable().optional(),
}).superRefine((data, ctx) => {
  if (data.reminderKind === 'payable' || data.reminderKind === 'receivable') {
    if (data.amount == null || data.amount <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'O valor deve ser maior que zero',
        path: ['amount']
      });
    }
  }
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
      reminderKind: 'general',
      amount: null,
      dueDate: new Date().toISOString().split('T')[0],
      dueTime: null,
      title: '',
      status: 'pending',
      type: null,
    },
  });

  const reminderKind = watch('reminderKind');
  const isFinancial = reminderKind === 'payable' || reminderKind === 'receivable';

  useEffect(() => {
    if (!isOpen) return;

    if (initialData) {
      reset({
        reminderKind: initialData.reminderKind ?? (initialData.type ?? 'general'),
        amount: initialData.amount ?? null,
        dueDate: initialData.dueDate,
        dueTime: initialData.dueTime ?? null,
        title: initialData.title,
        status: initialData.status,
        type: initialData.type ?? null,
      });
    } else {
      const today = new Date().toISOString().split('T')[0];
      reset({
        reminderKind: 'general',
        amount: null,
        dueDate: today,
        dueTime: null,
        title: '',
        status: 'pending',
        type: null,
      });
    }
    setShowDeleteConfirm(false);
  }, [isOpen, initialData, reset]);

  const setKind = (kind: 'general' | 'payable' | 'receivable') => {
    setValue('reminderKind', kind);
    if (kind === 'general') {
      setValue('type', null);
      setValue('amount', null);
      return;
    }
    setValue('type', kind);
    if (!watch('amount') || (watch('amount') ?? 0) <= 0) {
      setValue('amount', 0);
    }
  };

  const handleFormSubmit = async (data: ReminderFormData) => {
    const payload: ReminderFormData = {
      ...data,
      type: data.reminderKind === 'general' ? null : data.reminderKind,
      amount: data.reminderKind === 'general' ? null : (data.amount ?? null),
      dueTime: data.dueTime && data.dueTime.trim() ? data.dueTime.trim() : null,
    };

    setIsLoading(true);
    try {
      await onSubmit(payload);
      onClose();
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
        <div className="grid grid-cols-3 gap-2 p-1 bg-surface-800 rounded-xl">
          <button
            type="button"
            onClick={() => setKind('general')}
            className={`flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-lg transition-all ${
              reminderKind === 'general'
                ? 'bg-blue-500 text-white shadow-md'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Bell className="h-4 w-4" /> Comum
          </button>
          <button
            type="button"
            onClick={() => setKind('payable')}
            className={`flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-lg transition-all ${
              reminderKind === 'payable'
                ? 'bg-red-500 text-white shadow-md'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <ArrowDown className="h-4 w-4" /> A Pagar
          </button>
          <button
            type="button"
            onClick={() => setKind('receivable')}
            className={`flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-lg transition-all ${
              reminderKind === 'receivable'
                ? 'bg-emerald-500 text-white shadow-md'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <ArrowUp className="h-4 w-4" /> A Receber
          </button>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <Input
            label={isFinancial ? 'Descricao' : 'Texto do lembrete'}
            icon={FileText}
            placeholder={isFinancial ? 'Ex: Pagar aluguel' : 'Ex: Levar documentos na reuniao'}
            error={errors.title?.message}
            {...register('title')}
            className="sm:col-span-2"
          />

          {isFinancial && (
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
          )}

          <Input
            label="Data"
            type="date"
            icon={Calendar}
            error={errors.dueDate?.message}
            {...register('dueDate')}
          />

          <Input
            label="Horario (opcional)"
            type="time"
            icon={Clock3}
            error={errors.dueTime?.message}
            {...register('dueTime')}
          />
        </div>

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
