import { useMemo, useState } from 'react';
import { useReminders } from '@/hooks/useReminders';
import { ReminderRow } from '@/components/reminders/ReminderRow';
import { ReminderForm } from '@/components/reminders/ReminderForm';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ArrowDownCircle, ArrowUpCircle, Bell, Clock3, Plus, Search } from 'lucide-react';
import type { Reminder, ReminderFormData } from '@/types';
import { formatBRL } from '@/utils/formatBRL';

type StatusFilter = 'all' | 'pending' | 'paid';
type KindFilter = 'all' | 'general' | 'payable' | 'receivable';

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'pending', label: 'Pendentes' },
  { id: 'paid', label: 'Concluidos' },
];

const KIND_FILTERS: Array<{ id: KindFilter; label: string }> = [
  { id: 'all', label: 'Todos os tipos' },
  { id: 'general', label: 'Comum' },
  { id: 'payable', label: 'A pagar' },
  { id: 'receivable', label: 'A receber' },
];

function reminderDueSortValue(reminder: Reminder): number {
  const fallback = `${reminder.dueDate}T23:59:59`;
  const value = reminder.dueTime
    ? `${reminder.dueDate}T${reminder.dueTime}:00`
    : fallback;
  return new Date(value).getTime();
}

export function Reminders() {
  const { reminders, loading, add, update, remove, toggleStatus } = useReminders();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');

  const today = new Date().toISOString().split('T')[0];

  const pendingReminders = useMemo(() => {
    return reminders
      .filter((r) => r.status === 'pending')
      .sort((a, b) => reminderDueSortValue(a) - reminderDueSortValue(b));
  }, [reminders]);

  const paidReminders = useMemo(() => {
    return reminders
      .filter((r) => r.status === 'paid')
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [reminders]);

  const overdueCount = useMemo(() => {
    return pendingReminders.filter((r) => r.dueDate < today).length;
  }, [pendingReminders, today]);

  const payablePendingTotal = useMemo(() => {
    return pendingReminders
      .filter((r) => r.reminderKind === 'payable')
      .reduce((sum, r) => sum + (r.amount ?? 0), 0);
  }, [pendingReminders]);

  const receivablePendingTotal = useMemo(() => {
    return pendingReminders
      .filter((r) => r.reminderKind === 'receivable')
      .reduce((sum, r) => sum + (r.amount ?? 0), 0);
  }, [pendingReminders]);

  const filteredReminders = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return reminders.filter((r) => {
      const matchesSearch = !normalizedSearch || r.title.toLowerCase().includes(normalizedSearch);
      const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
      const matchesKind = kindFilter === 'all' || r.reminderKind === kindFilter;
      return matchesSearch && matchesStatus && matchesKind;
    });
  }, [reminders, search, statusFilter, kindFilter]);

  const filteredPendingReminders = useMemo(() => {
    return filteredReminders
      .filter((r) => r.status === 'pending')
      .sort((a, b) => reminderDueSortValue(a) - reminderDueSortValue(b));
  }, [filteredReminders]);

  const filteredPaidReminders = useMemo(() => {
    return filteredReminders
      .filter((r) => r.status === 'paid')
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [filteredReminders]);

  const handleCreate = () => {
    setEditingReminder(null);
    setIsModalOpen(true);
  };

  const handleEdit = (reminder: Reminder) => {
    setEditingReminder(reminder);
    setIsModalOpen(true);
  };

  const handleSubmit = async (data: ReminderFormData) => {
    if (editingReminder) {
      await update(editingReminder.id, data);
    } else {
      await add(data);
    }
  };

  const handleDelete = async () => {
    if (editingReminder) {
      await remove(editingReminder.id);
    }
  };

  return (
    <div className="space-y-6 pb-20 lg:pb-0 animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Lembretes</h1>
          <p className="text-sm text-gray-400 mt-1">
            Organize lembretes comuns e financeiros em um painel unico.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <Button onClick={handleCreate} className="hidden lg:flex" autoFocus={false}>
            <Plus className="mr-2 h-4 w-4" />
            Novo lembrete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-4">
        <div className="rounded-2xl border border-surface-700 bg-surface-900/50 p-4">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-xs uppercase tracking-wider">Pendentes</span>
            <Clock3 className="h-4 w-4" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-white">{pendingReminders.length}</p>
        </div>

        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4">
          <div className="flex items-center justify-between text-red-300">
            <span className="text-xs uppercase tracking-wider">Atrasados</span>
            <Bell className="h-4 w-4" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-red-200">{overdueCount}</p>
        </div>

        <div className="rounded-2xl border border-orange-500/20 bg-orange-500/5 p-4">
          <div className="flex items-center justify-between text-orange-300">
            <span className="text-xs uppercase tracking-wider">A pagar</span>
            <ArrowDownCircle className="h-4 w-4" />
          </div>
          <p className="mt-2 text-xl font-semibold text-orange-100">{formatBRL(payablePendingTotal)}</p>
        </div>

        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="flex items-center justify-between text-emerald-300">
            <span className="text-xs uppercase tracking-wider">A receber</span>
            <ArrowUpCircle className="h-4 w-4" />
          </div>
          <p className="mt-2 text-xl font-semibold text-emerald-100">{formatBRL(receivablePendingTotal)}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-surface-700 bg-surface-900/50 p-3 space-y-4 sm:p-4">
        <Input
          label="Buscar lembretes"
          icon={Search}
          placeholder="Ex: aluguel, dentista, receber..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-gray-500">Status</div>
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setStatusFilter(item.id)}
                className={`rounded-xl px-3 py-2 text-xs font-medium transition ${
                  statusFilter === item.id
                    ? 'bg-indigo-500 text-white'
                    : 'bg-surface-800 text-gray-300 hover:bg-surface-700'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-gray-500">Tipo</div>
          <div className="flex flex-wrap gap-2">
            {KIND_FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setKindFilter(item.id)}
                className={`rounded-xl px-3 py-2 text-xs font-medium transition ${
                  kindFilter === item.id
                    ? 'bg-surface-100 text-surface-900'
                    : 'bg-surface-800 text-gray-300 hover:bg-surface-700'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-surface-700 bg-surface-900/50 glass-card">
        {loading ? (
          <div className="divide-y divide-surface-800">
            {[...Array(4)].map((_, i) => (
              <LoadingSkeleton key={i} variant="row" className="bg-transparent border-none rounded-none" />
            ))}
          </div>
        ) : reminders.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={Bell}
              title="Nenhum lembrete"
              description="Voce ainda nao criou lembretes comuns ou financeiros."
              actionLabel="Criar lembrete"
              onAction={handleCreate}
            />
          </div>
        ) : filteredReminders.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={Search}
              title="Nenhum resultado"
              description="Nenhum lembrete corresponde aos filtros selecionados."
              actionLabel="Limpar filtros"
              onAction={() => {
                setSearch('');
                setStatusFilter('all');
                setKindFilter('all');
              }}
            />
          </div>
        ) : (
          <div className="space-y-5 p-3 sm:p-4">
            {filteredPendingReminders.length > 0 && (
              <section className="space-y-2">
                <h3 className="px-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Pendentes ({filteredPendingReminders.length})
                </h3>
                <div className="space-y-3">
                  {filteredPendingReminders.map((r) => (
                    <ReminderRow
                      key={r.id}
                      reminder={r}
                      onEdit={() => handleEdit(r)}
                      onToggleStatus={() => toggleStatus(r)}
                    />
                  ))}
                </div>
              </section>
            )}

            {filteredPaidReminders.length > 0 && (
              <section className="space-y-2">
                <h3 className="px-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Concluidos ({filteredPaidReminders.length})
                </h3>
                <div className="space-y-3">
                  {filteredPaidReminders.map((r) => (
                    <ReminderRow
                      key={r.id}
                      reminder={r}
                      onEdit={() => handleEdit(r)}
                      onToggleStatus={() => toggleStatus(r)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      <button
        onClick={handleCreate}
        className="fixed bottom-6 right-6 lg:hidden z-40 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 transition-transform active:scale-95"
      >
        <Plus className="h-6 w-6" />
      </button>

      <ReminderForm
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleSubmit}
        onDelete={editingReminder ? handleDelete : undefined}
        initialData={editingReminder}
      />
    </div>
  );
}
