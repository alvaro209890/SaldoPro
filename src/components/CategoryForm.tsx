import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Tag, ArrowDown, ArrowUp } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { CATEGORY_COLORS, ICON_MAP, type IconName } from '@/utils/constants';
import type { Category, CategoryFormData } from '@/types';

const categorySchema = z.object({
    name: z.string().min(2, 'O nome deve ter no mínimo 2 caracteres'),
    type: z.enum(['income', 'expense']),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor inválida'),
    icon: z.string().min(1, 'Selecione um ícone'),
});

interface CategoryFormProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: CategoryFormData) => Promise<void>;
    initialData?: Category | null;
}

export function CategoryForm({
    isOpen,
    onClose,
    onSubmit,
    initialData,
}: CategoryFormProps) {
    const [isLoading, setIsLoading] = useState(false);

    const {
        register,
        handleSubmit,
        control,
        watch,
        reset,
        setValue,
        formState: { errors },
    } = useForm<CategoryFormData>({
        resolver: zodResolver(categorySchema),
        defaultValues: {
            name: '',
            type: 'expense',
            color: CATEGORY_COLORS[0],
            icon: 'Tag',
        },
    });

    const type = watch('type');
    const selectedColor = watch('color');
    const selectedIcon = watch('icon');

    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                reset({
                    name: initialData.name,
                    type: initialData.type,
                    color: initialData.color,
                    icon: initialData.icon,
                });
            } else {
                reset({
                    name: '',
                    type: 'expense',
                    color: CATEGORY_COLORS[0],
                    icon: 'Tag',
                });
            }
        }
    }, [isOpen, initialData, reset]);

    const handleFormSubmit = async (data: CategoryFormData) => {
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

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={initialData ? 'Editar Categoria' : 'Nova Categoria'}
        >
            <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
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

                <Input
                    label="Nome da categoria"
                    icon={Tag}
                    placeholder="Ex: Alimentação"
                    error={errors.name?.message}
                    {...register('name')}
                />

                <div>
                    <label className="mb-2 block text-sm font-medium text-gray-300">Cor</label>
                    <div className="grid grid-cols-8 gap-2">
                        {CATEGORY_COLORS.map((color) => (
                            <button
                                key={color}
                                type="button"
                                onClick={() => setValue('color', color)}
                                className={`flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-110 focus:outline-none ${selectedColor === color ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-950 scale-110' : ''
                                    }`}
                                style={{ backgroundColor: color }}
                            />
                        ))}
                    </div>
                    {errors.color && (
                        <p className="mt-1.5 text-xs text-red-500">{errors.color.message}</p>
                    )}
                </div>

                <div>
                    <label className="mb-2 block text-sm font-medium text-gray-300">Ícone</label>
                    <div className="grid grid-cols-6 sm:grid-cols-10 gap-2 max-h-48 overflow-y-auto p-2 border border-surface-700 rounded-lg bg-surface-900/50">
                        {(Object.keys(ICON_MAP) as IconName[]).map((iconName) => {
                            const Icon = ICON_MAP[iconName];
                            return (
                                <button
                                    key={iconName}
                                    type="button"
                                    onClick={() => setValue('icon', iconName)}
                                    className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${selectedIcon === iconName
                                            ? 'bg-indigo-500 text-white'
                                            : 'text-gray-400 hover:bg-surface-800 hover:text-white'
                                        }`}
                                >
                                    <Icon className="h-5 w-5" />
                                </button>
                            );
                        })}
                    </div>
                    {errors.icon && (
                        <p className="mt-1.5 text-xs text-red-500">{errors.icon.message}</p>
                    )}
                </div>

                <div className="flex gap-3 pt-4 border-t border-surface-700">
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={onClose}
                        disabled={isLoading}
                        className="flex-1"
                    >
                        Cancelar
                    </Button>
                    <Button type="submit" isLoading={isLoading} className="flex-1">
                        Salvar
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
