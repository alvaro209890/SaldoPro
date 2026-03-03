import { useState } from 'react';
import { Target } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import type { GoalFormData } from '@/types';

interface GoalFormProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: GoalFormData) => Promise<void>;
}

export function GoalForm({ isOpen, onClose, onSubmit }: GoalFormProps) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [targetAmount, setTargetAmount] = useState('');
    const [deadline, setDeadline] = useState('');
    const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) return;

        setIsSubmitting(true);
        try {
            await onSubmit({
                title: title.trim(),
                description: description.trim(),
                targetAmount: targetAmount ? parseFloat(targetAmount) : null,
                deadline,
                priority,
            });
            // Reset
            setTitle('');
            setDescription('');
            setTargetAmount('');
            setDeadline('');
            setPriority('medium');
            onClose();
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Nova Meta">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">
                        Título <span className="text-red-400">*</span>
                    </label>
                    <Input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Ex: Juntar para reserva de emergência"
                        maxLength={120}
                        required
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">
                        Descrição
                    </label>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Descreva sua meta em mais detalhes..."
                        rows={3}
                        maxLength={500}
                        className="w-full rounded-xl border border-surface-700 bg-surface-800/50 px-4 py-3 text-sm text-white placeholder:text-gray-600 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all resize-none"
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">
                            Valor alvo (R$)
                        </label>
                        <Input
                            type="number"
                            inputMode="decimal"
                            value={targetAmount}
                            onChange={(e) => setTargetAmount(e.target.value)}
                            placeholder="Ex: 5000"
                            min="0"
                            step="0.01"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">
                            Prazo
                        </label>
                        <Input
                            type="date"
                            value={deadline}
                            onChange={(e) => setDeadline(e.target.value)}
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        Prioridade
                    </label>
                    <div className="flex gap-2">
                        {(['low', 'medium', 'high'] as const).map((p) => {
                            const labels = { low: 'Baixa', medium: 'Média', high: 'Alta' };
                            const colors = {
                                low: priority === p ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' : 'bg-surface-800 border-surface-700 text-gray-400',
                                medium: priority === p ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' : 'bg-surface-800 border-surface-700 text-gray-400',
                                high: priority === p ? 'bg-red-500/20 border-red-500/40 text-red-400' : 'bg-surface-800 border-surface-700 text-gray-400',
                            };
                            return (
                                <button
                                    key={p}
                                    type="button"
                                    onClick={() => setPriority(p)}
                                    className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${colors[p]}`}
                                >
                                    {labels[p]}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                    <Button type="button" variant="secondary" onClick={onClose}>
                        Cancelar
                    </Button>
                    <Button type="submit" isLoading={isSubmitting} disabled={!title.trim()}>
                        <Target className="mr-2 h-4 w-4" />
                        Criar Meta
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
