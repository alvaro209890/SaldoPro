import { useState, useMemo } from 'react';
import { useReminders } from '@/hooks/useReminders';
import { ReminderRow } from '@/components/reminders/ReminderRow';
import { ReminderForm } from '@/components/reminders/ReminderForm';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { Button } from '@/components/ui/Button';
import { Plus, Bell } from 'lucide-react';
import type { Reminder, ReminderFormData } from '@/types';

export function Reminders() {
    const { reminders, loading, add, update, remove, toggleStatus } = useReminders();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);

    const pendingReminders = useMemo(() => {
        return reminders.filter(r => r.status === 'pending');
    }, [reminders]);

    const paidReminders = useMemo(() => {
        return reminders.filter(r => r.status === 'paid');
    }, [reminders]);

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
                        Gerencie lembretes comuns e financeiros.
                    </p>
                </div>

                <div className="flex items-center gap-4">
                    <Button onClick={handleCreate} className="hidden lg:flex" autoFocus={false}>
                        <Plus className="mr-2 h-4 w-4" />
                        Novo Lembrete
                    </Button>
                </div>
            </div>

            <div className="rounded-2xl border border-surface-700 bg-surface-900/50 glass-card">
                {loading ? (
                    <div className="divide-y divide-surface-800">
                        {[...Array(3)].map((_, i) => (
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
                ) : (
                    <>
                        {pendingReminders.length > 0 && (
                            <div className="mb-4">
                                <h3 className="px-5 pt-4 pb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                    Pendentes
                                </h3>
                                <div className="divide-y divide-surface-800">
                                    {pendingReminders.map((r) => (
                                        <ReminderRow
                                            key={r.id}
                                            reminder={r}
                                            onEdit={() => handleEdit(r)}
                                            onToggleStatus={() => toggleStatus(r)}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        {paidReminders.length > 0 && (
                            <div>
                                <h3 className="px-5 pt-6 pb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                    Concluídos
                                </h3>
                                <div className="divide-y divide-surface-800">
                                    {paidReminders.map((r) => (
                                        <ReminderRow
                                            key={r.id}
                                            reminder={r}
                                            onEdit={() => handleEdit(r)}
                                            onToggleStatus={() => toggleStatus(r)}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Floating Action Button for mobile */}
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

