import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { ArrowDown, ArrowUp, Bell, Calendar, Clock3, DollarSign, FileText } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { Reminder, ReminderFormData } from '@/types';

const reminderSchema = z.object({
  reminderKind: z.enum(['general', 'payable', 'receivable']),
  amount: z.number().nullable(),
  dueDate: z.string().min(1, 'A data e obrigatoria'),
  dueTime: z.string().nullable(),
  title: z.string().min(1, 'O texto do lembrete e obrigatorio'),
  status: z.enum(['pending', 'paid']),
  type: z.enum(['payable', 'receivable']).nullable(),
}).superRefine((data, ctx) => {
  if (data.reminderKind === 'payable' || data.reminderKind === 'receivable') {
    if (data.amount == null || data.amount <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe um valor maior que zero',
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

function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
      dueDate: dateOffset(0),
      dueTime: null,
      title: '',
      status: 'pending',
      type: null,
    },
  });

  const reminderKind = watch('reminderKind');
  const isFinancial = reminderKind === 'payable' || reminderKind === 'receivable';
  const status = watch('status');

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
      reset({
        reminderKind: 'general',
        amount: null,
        dueDate: dateOffset(0),
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
      title={initialData ? 'Editar lembrete' : 'Novo lembrete'}
    >
      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
        <div className="rounded-2xl border border-surface-700 bg-surface-900/50 p-1 grid grid-cols-3 gap-1">
          <button
            type="button"
            onClick={() => setKind('general')}
            className={`flex items-center justify-center gap-1 rounded-xl py-2 text-xs font-medium transition ${
              reminderKind === 'general'
                ? 'bg-blue-500 text-white'
                : 'text-gray-300 hover:bg-surface-800'
            }`}
          >
            <Bell className="h-3.5 w-3.5" />
            Comum
          </button>
          <button
            type="button"
            onClick={() => setKind('payable')}
            className={`flex items-center justify-center gap-1 rounded-xl py-2 text-xs font-medium transition ${
              reminderKind === 'payable'
                ? 'bg-orange-500 text-white'
                : 'text-gray-300 hover:bg-surface-800'
            }`}
          >
            <ArrowDown className="h-3.5 w-3.5" />
            A pagar
          </button>
          <button
            type="button"
            onClick={() => setKind('receivable')}
            className={`flex items-center justify-center gap-1 rounded-xl py-2 text-xs font-medium transition ${
              reminderKind === 'receivable'
                ? 'bg-emerald-500 text-white'
                : 'text-gray-300 hover:bg-surface-800'
            }`}
          >
            <ArrowUp className="h-3.5 w-3.5" />
            A receber
          </button>
        </div>

        <Input
          label={isFinancial ? 'Descricao' : 'Texto do lembrete'}
          icon={FileText}
          placeholder={isFinancial ? 'Ex: Pagar aluguel' : 'Ex: Levar documentos para reuniao'}
          error={errors.title?.message}
          {...register('title')}
        />

        {isFinancial && (
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
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

        <div className="grid grid-cols-3 gap-2 rounded-xl border border-surface-700 bg-surface-900/30 p-2">
          {[
            { label: 'Hoje', value: dateOffset(0) },
            { label: 'Amanha', value: dateOffset(1) },
            { label: '7 dias', value: dateOffset(7) },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => setValue('dueDate', item.value)}
              className="rounded-lg bg-surface-800 px-2 py-2 text-xs font-medium text-gray-300 transition hover:bg-surface-700"
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-4 gap-2 rounded-xl border border-surface-700 bg-surface-900/30 p-2">
          {[
            { label: '09:00', value: '09:00' },
            { label: '12:00', value: '12:00' },
            { label: '18:00', value: '18:00' },
            { label: 'Sem hora', value: '' },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => setValue('dueTime', item.value || null)}
              className="rounded-lg bg-surface-800 px-2 py-2 text-xs font-medium text-gray-300 transition hover:bg-surface-700"
            >
              {item.label}
            </button>
          ))}
        </div>

        {initialData && (
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wider text-gray-500">Status</div>
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-surface-700 bg-surface-900/30 p-2">
              <button
                type="button"
                onClick={() => setValue('status', 'pending')}
                className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                  status === 'pending'
                    ? 'bg-indigo-500 text-white'
                    : 'bg-surface-800 text-gray-300 hover:bg-surface-700'
                }`}
              >
                Pendente
              </button>
              <button
                type="button"
                onClick={() => setValue('status', 'paid')}
                className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                  status === 'paid'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-surface-800 text-gray-300 hover:bg-surface-700'
                }`}
              >
                Concluido
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col-reverse gap-3 border-t border-surface-700 pt-4 sm:flex-row">
          {initialData && onDelete && (
            <div className="flex-1">
              {showDeleteConfirm ? (
                <div className="flex items-center gap-2">
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
                    className="px-4"
                  >
                    Cancelar
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full text-red-400 hover:bg-red-500/10 hover:text-red-300 sm:w-auto"
                >
                  Excluir
                </Button>
              )}
            </div>
          )}

          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:justify-end">
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
