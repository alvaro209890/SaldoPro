import { formatBRL } from '@/utils/formatBRL';
import { formatDateBR } from '@/utils/date';
import { Reminder } from '@/types';
import { Pencil, CheckCircle2, Circle, Clock, ArrowDown, ArrowUp, Bell } from 'lucide-react';

interface ReminderRowProps {
  reminder: Reminder;
  onEdit: () => void;
  onToggleStatus: () => void;
}

function reminderKindLabel(reminder: Reminder): string {
  if (reminder.reminderKind === 'general') return 'Comum';
  if (reminder.reminderKind === 'receivable') return 'A receber';
  return 'A pagar';
}

export function ReminderRow({ reminder, onEdit, onToggleStatus }: ReminderRowProps) {
  const isReceivable = reminder.reminderKind === 'receivable';
  const isPaid = reminder.status === 'paid';
  const hasAmount = reminder.reminderKind !== 'general' && reminder.amount != null;

  const today = new Date().toISOString().split('T')[0];
  const isOverdue = !isPaid && reminder.dueDate < today;
  const isToday = !isPaid && reminder.dueDate === today;
  const dueLabel = reminder.dueTime
    ? `${formatDateBR(reminder.dueDate)} ${reminder.dueTime}`
    : formatDateBR(reminder.dueDate);

  const StatusIcon = isPaid ? CheckCircle2 : Circle;

  return (
    <div className={`group flex items-center justify-between p-4 transition-all hover:bg-surface-800/50 ${isPaid ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-4 min-w-0" onClick={onToggleStatus}>
        <button className={`flex-shrink-0 transition-colors ${isPaid ? 'text-emerald-500' : 'text-gray-500 hover:text-indigo-400'}`}>
          <StatusIcon className="h-6 w-6" />
        </button>

        <div className="flex flex-col min-w-0 gap-1 cursor-pointer">
          <div className="flex items-center gap-2">
            <p className={`truncate font-medium ${isPaid ? 'line-through text-gray-400' : 'text-gray-200'}`}>
              {reminder.title}
            </p>
            {isOverdue && (
              <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">
                <Clock className="h-3 w-3" />
                Atrasado
              </span>
            )}
            {isToday && (
              <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">
                Hoje
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              {reminder.reminderKind === 'general'
                ? <Bell className="h-3 w-3" />
                : (isReceivable ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
              {dueLabel}
            </span>
            <span className="text-xs text-gray-500">{reminderKindLabel(reminder)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-4">
        {hasAmount ? (
          <p className={`font-semibold ${isPaid ? 'text-gray-500' : isReceivable ? 'text-emerald-400' : 'text-gray-200'}`}>
            {isReceivable ? '+' : '-'}{formatBRL(reminder.amount ?? 0)}
          </p>
        ) : (
          <p className={`text-xs ${isPaid ? 'text-gray-500' : 'text-gray-400'}`}>Sem valor</p>
        )}

        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="rounded-lg p-1 text-gray-400 hover:bg-surface-700 hover:text-white"
            title="Editar"
          >
            <Pencil className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
