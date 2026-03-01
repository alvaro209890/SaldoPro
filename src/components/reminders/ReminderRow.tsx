import type { ReactNode } from 'react';
import { formatBRL } from '@/utils/formatBRL';
import { formatDateBR } from '@/utils/date';
import { Reminder } from '@/types';
import { ArrowDown, ArrowUp, Bell, CalendarDays, Check, Clock3, Pencil, RotateCcw } from 'lucide-react';

interface ReminderRowProps {
  reminder: Reminder;
  onEdit: () => void;
  onToggleStatus: () => void;
}

function reminderKindMeta(kind: Reminder['reminderKind']): {
  label: string;
  tone: string;
  icon: ReactNode;
} {
  if (kind === 'payable') {
    return {
      label: 'A pagar',
      tone: 'bg-orange-500/10 text-orange-300 border-orange-500/20',
      icon: <ArrowDown className="h-3 w-3" />
    };
  }

  if (kind === 'receivable') {
    return {
      label: 'A receber',
      tone: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
      icon: <ArrowUp className="h-3 w-3" />
    };
  }

  return {
    label: 'Comum',
    tone: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
    icon: <Bell className="h-3 w-3" />
  };
}

export function ReminderRow({ reminder, onEdit, onToggleStatus }: ReminderRowProps) {
  const isPaid = reminder.status === 'paid';
  const today = new Date().toISOString().split('T')[0];
  const isOverdue = !isPaid && reminder.dueDate < today;
  const isToday = !isPaid && reminder.dueDate === today;
  const dueLabel = reminder.dueTime
    ? `${formatDateBR(reminder.dueDate)} ${reminder.dueTime}`
    : formatDateBR(reminder.dueDate);

  const kindMeta = reminderKindMeta(reminder.reminderKind);
  const hasAmount = reminder.reminderKind !== 'general' && reminder.amount != null;
  const signedAmount = reminder.reminderKind === 'receivable' ? '+' : '-';

  return (
    <article
      className={`rounded-xl border p-4 transition-all ${
        isPaid
          ? 'border-surface-700/70 bg-surface-900/30'
          : isOverdue
            ? 'border-red-500/30 bg-red-500/5'
            : 'border-surface-700/80 bg-surface-900/60 hover:border-surface-600'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className={`truncate text-sm font-semibold ${isPaid ? 'text-gray-400 line-through' : 'text-gray-100'}`}>
              {reminder.title}
            </h4>

            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${kindMeta.tone}`}>
              {kindMeta.icon}
              {kindMeta.label}
            </span>

            {isOverdue && (
              <span className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-300">
                <Clock3 className="h-3 w-3" />
                Atrasado
              </span>
            )}

            {isToday && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                <CalendarDays className="h-3 w-3" />
                Hoje
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-400">
            <CalendarDays className="h-3.5 w-3.5" />
            <span>{dueLabel}</span>
          </div>
        </div>

        <div className="text-right">
          {hasAmount ? (
            <p className={`text-sm font-semibold ${
              isPaid
                ? 'text-gray-500'
                : reminder.reminderKind === 'receivable'
                  ? 'text-emerald-300'
                  : 'text-orange-200'
            }`}>
              {signedAmount}{formatBRL(reminder.amount ?? 0)}
            </p>
          ) : (
            <p className={`text-xs ${isPaid ? 'text-gray-500' : 'text-gray-400'}`}>Sem valor</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onToggleStatus}
          className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            isPaid
              ? 'bg-surface-800 text-gray-300 hover:bg-surface-700'
              : 'bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
          }`}
        >
          {isPaid ? <RotateCcw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          {isPaid ? 'Reabrir' : 'Concluir'}
        </button>

        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1 rounded-lg bg-surface-800 px-3 py-1.5 text-xs font-medium text-gray-300 transition hover:bg-surface-700 hover:text-white"
        >
          <Pencil className="h-3.5 w-3.5" />
          Editar
        </button>
      </div>
    </article>
  );
}
