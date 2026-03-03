import { useEffect, useState } from 'react';
import { Pencil, Target, Trash2, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import type { Goal, GoalFormData } from '@/types';

interface GoalFormProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: GoalFormData) => Promise<void>;
    initialData?: Goal | null;
    onDelete?: () => Promise<void>;
}

const PRIORITY_LABELS = {
    low: 'Baixa',
    medium: 'Media',
    high: 'Alta',
} as const;

const STATUS_LABELS = {
    active: 'Ativa',
    completed: 'Concluida',
    cancelled: 'Pausada',
} as const;

export function GoalForm({ isOpen, onClose, onSubmit, initialData = null, onDelete }: GoalFormProps) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [targetAmount, setTargetAmount] = useState('');
    const [currentAmount, setCurrentAmount] = useState('');
    const [deadline, setDeadline] = useState('');
    const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
    const [status, setStatus] = useState<'active' | 'completed' | 'cancelled'>('active');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        if (initialData) {
            setTitle(initialData.title);
            setDescription(initialData.description ?? '');
            setTargetAmount(initialData.targetAmount != null ? String(initialData.targetAmount) : '');
            setCurrentAmount(String(initialData.currentAmount));
            setDeadline(initialData.deadline ?? '');
            setPriority(initialData.priority);
            setStatus(initialData.status);
        } else {
            setTitle('');
            setDescription('');
            setTargetAmount('');
            setCurrentAmount('');
            setDeadline('');
            setPriority('medium');
            setStatus('active');
        }

        setShowDeleteConfirm(false);
    }, [initialData, isOpen]);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!title.trim()) {
            return;
        }

        const parsedTargetAmount = targetAmount ? Number(targetAmount) : null;
        const parsedCurrentAmount = currentAmount ? Number(currentAmount) : 0;

        setIsSubmitting(true);
        try {
            await onSubmit({
                title: title.trim(),
                description: description.trim(),
                targetAmount:
                    parsedTargetAmount != null && Number.isFinite(parsedTargetAmount) && parsedTargetAmount > 0
                        ? parsedTargetAmount
                        : null,
                currentAmount: Number.isFinite(parsedCurrentAmount) && parsedCurrentAmount >= 0 ? parsedCurrentAmount : 0,
                deadline,
                priority,
                status,
            });
            onClose();
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!onDelete) {
            return;
        }

        setIsDeleting(true);
        try {
            await onDelete();
            onClose();
        } finally {
            setIsDeleting(false);
        }
    };

    const isEditing = Boolean(initialData);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={isEditing ? 'Editar Meta' : 'Nova Meta'}
        >
            <form onSubmit={handleSubmit} className="space-y-5">
                <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-indigo-500/10 via-surface-900 to-emerald-500/5 p-4">
                    <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300">
                            {isEditing ? <Pencil className="h-5 w-5" /> : <Target className="h-5 w-5" />}
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-semibold text-white">
                                {isEditing ? 'Ajuste os detalhes da meta' : 'Crie uma meta clara e mensuravel'}
                            </p>
                            <p className="text-xs leading-relaxed text-gray-400">
                                Defina um alvo, o quanto ja foi acumulado e o prazo. Assim a IA consegue acompanhar melhor pelo WhatsApp.
                            </p>
                        </div>
                    </div>
                </div>

                <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-300">
                        Titulo <span className="text-red-400">*</span>
                    </label>
                    <Input
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        placeholder="Ex: Reserva de emergencia"
                        maxLength={120}
                        required
                    />
                </div>

                <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-300">
                        Descricao
                    </label>
                    <textarea
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder="Ex: juntar para imprevistos e reduzir dependencia de cartao"
                        rows={3}
                        maxLength={500}
                        className="w-full rounded-xl border border-surface-700 bg-surface-800/50 px-4 py-3 text-sm text-white placeholder:text-gray-600 transition-all focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
                    />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <label className="mb-1.5 block text-sm font-medium text-gray-300">
                            Valor alvo (R$)
                        </label>
                        <Input
                            type="number"
                            inputMode="decimal"
                            value={targetAmount}
                            onChange={(event) => setTargetAmount(event.target.value)}
                            placeholder="Ex: 5000"
                            min="0"
                            step="0.01"
                        />
                    </div>

                    <div>
                        <label className="mb-1.5 block text-sm font-medium text-gray-300">
                            Ja acumulado (R$)
                        </label>
                        <Input
                            type="number"
                            inputMode="decimal"
                            value={currentAmount}
                            onChange={(event) => setCurrentAmount(event.target.value)}
                            placeholder="Ex: 800"
                            min="0"
                            step="0.01"
                        />
                    </div>

                    <div>
                        <label className="mb-1.5 block text-sm font-medium text-gray-300">
                            Prazo
                        </label>
                        <Input
                            type="date"
                            value={deadline}
                            onChange={(event) => setDeadline(event.target.value)}
                        />
                    </div>

                    <div className="rounded-xl border border-surface-700 bg-surface-900/40 p-3">
                        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-200">
                            <TrendingUp className="h-4 w-4 text-indigo-300" />
                            Status atual
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {(['active', 'completed', 'cancelled'] as const).map((item) => (
                                <button
                                    key={item}
                                    type="button"
                                    onClick={() => setStatus(item)}
                                    className={`rounded-lg border px-2 py-2 text-[11px] font-medium transition-all ${
                                        status === item
                                            ? 'border-indigo-400/40 bg-indigo-500/15 text-indigo-200'
                                            : 'border-surface-700 bg-surface-800 text-gray-400 hover:text-gray-200'
                                    }`}
                                >
                                    {STATUS_LABELS[item]}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div>
                    <label className="mb-2 block text-sm font-medium text-gray-300">
                        Prioridade
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                        {(['low', 'medium', 'high'] as const).map((item) => {
                            const activeClass =
                                item === 'low'
                                    ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
                                    : item === 'medium'
                                        ? 'border-amber-400/30 bg-amber-500/10 text-amber-300'
                                        : 'border-red-400/30 bg-red-500/10 text-red-300';

                            return (
                                <button
                                    key={item}
                                    type="button"
                                    onClick={() => setPriority(item)}
                                    className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-all ${
                                        priority === item
                                            ? activeClass
                                            : 'border-surface-700 bg-surface-800 text-gray-400 hover:text-gray-200'
                                    }`}
                                >
                                    {PRIORITY_LABELS[item]}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="flex flex-col-reverse gap-3 border-t border-surface-700 pt-3 sm:flex-row sm:pt-4">
                    {isEditing && onDelete && (
                        <div className="flex-1">
                            {showDeleteConfirm ? (
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                    <Button
                                        type="button"
                                        variant="danger"
                                        isLoading={isDeleting}
                                        onClick={handleDelete}
                                        className="flex-1"
                                    >
                                        Confirmar exclusao
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => setShowDeleteConfirm(false)}
                                        className="w-full sm:w-auto"
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
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Excluir meta
                                </Button>
                            )}
                        </div>
                    )}

                    <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:justify-end">
                        <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
                            Cancelar
                        </Button>
                        <Button type="submit" isLoading={isSubmitting} disabled={!title.trim()}>
                            {isEditing ? <Pencil className="mr-2 h-4 w-4" /> : <Target className="mr-2 h-4 w-4" />}
                            {isEditing ? 'Salvar alteracoes' : 'Criar meta'}
                        </Button>
                    </div>
                </div>
            </form>
        </Modal>
    );
}
