import { useState } from 'react';
import { useCategories } from '@/hooks/useCategories';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { CategoryForm } from '@/components/CategoryForm';
import { Modal } from '@/components/ui/Modal';
import { ICON_MAP, type IconName } from '@/utils/constants';
import type { Category, CategoryFormData } from '@/types';

export function Categories() {
    const { incomeCategories, expenseCategories, loading, add, update, remove } = useCategories();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCategory, setEditingCategory] = useState<Category | null>(null);

    // Delete confirm state
    const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const handleCreate = () => {
        setEditingCategory(null);
        setIsModalOpen(true);
    };

    const handleEdit = (category: Category) => {
        setEditingCategory(category);
        setIsModalOpen(true);
    };

    const handleDeleteClick = (category: Category, e: React.MouseEvent) => {
        e.stopPropagation();
        setCategoryToDelete(category);
    };

    const confirmDelete = async () => {
        if (!categoryToDelete) return;
        setIsDeleting(true);
        try {
            await remove(categoryToDelete.id);
            setCategoryToDelete(null);
        } catch (error) {
            console.error(error);
        } finally {
            setIsDeleting(false);
        }
    };

    const handleSubmit = async (data: CategoryFormData) => {
        if (editingCategory) {
            await update(editingCategory.id, data);
        } else {
            await add(data);
        }
    };

    const renderCategoryCard = (category: Category) => {
        const Icon = ICON_MAP[category.icon as IconName];

        return (
            <div
                key={category.id}
                onClick={() => handleEdit(category)}
                className="group relative flex cursor-pointer items-center gap-4 rounded-xl border border-surface-700 bg-surface-900 p-4 transition-all hover:border-indigo-500/50 hover:bg-surface-800 hover:shadow-lg hover:shadow-indigo-500/10"
            >
                <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                    style={{
                        backgroundColor: `${category.color}20`,
                        color: category.color,
                    }}
                >
                    {Icon && <Icon className="h-6 w-6" />}
                </div>

                <div className="flex-1 min-w-0">
                    <p className="truncate font-medium text-gray-200">{category.name}</p>
                </div>

                <div className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                        title="Editar"
                        className="rounded-lg p-2 text-gray-400 hover:bg-surface-700 hover:text-white"
                    >
                        <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                        title="Excluir"
                        onClick={(e) => handleDeleteClick(category, e)}
                        className="rounded-lg p-2 text-red-400 hover:bg-red-500/20"
                    >
                        <Trash2 className="h-4 w-4" />
                    </button>
                </div>
            </div>
        );
    };

    if (loading) {
        return (
            <div className="space-y-8 animate-fade-in">
                <div>
                    <LoadingSkeleton variant="text" className="w-48 h-8 mb-6" />
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                        {[...Array(8)].map((_, i) => (
                            <LoadingSkeleton key={i} variant="row" className="h-20" />
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-fade-in">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Categorias</h1>
                    <p className="text-sm text-gray-400 mt-1">
                        Personalize as categorias das suas transações.
                    </p>
                </div>

                <Button onClick={handleCreate} className="w-full sm:w-auto">
                    <Plus className="mr-2 h-4 w-4" />
                    Nova Categoria
                </Button>
            </div>

            <div className="space-y-6">
                <div>
                    <div className="mb-4 flex items-center gap-2">
                        <h2 className="text-lg font-semibold text-red-400">Despesas</h2>
                        <span className="rounded-full bg-red-400/10 px-2.5 py-0.5 text-xs font-medium text-red-400">
                            {expenseCategories.length}
                        </span>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                        {expenseCategories.map(renderCategoryCard)}
                        <button
                            onClick={() => {
                                setEditingCategory(null);
                                setIsModalOpen(true);
                            }}
                            className="flex h-[88px] items-center justify-center gap-2 rounded-xl border-2 border-dashed border-surface-700 text-sm font-medium text-gray-400 transition-colors hover:border-indigo-500/50 hover:text-indigo-400 hover:bg-surface-800/50"
                        >
                            <Plus className="h-5 w-5" /> Adicionar
                        </button>
                    </div>
                </div>

                <div className="pt-6 border-t border-surface-800">
                    <div className="mb-4 flex items-center gap-2">
                        <h2 className="text-lg font-semibold text-emerald-400">Receitas</h2>
                        <span className="rounded-full bg-emerald-400/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                            {incomeCategories.length}
                        </span>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                        {incomeCategories.map(renderCategoryCard)}
                        <button
                            onClick={() => {
                                setEditingCategory(null);
                                setIsModalOpen(true);
                            }}
                            className="flex h-[88px] items-center justify-center gap-2 rounded-xl border-2 border-dashed border-surface-700 text-sm font-medium text-gray-400 transition-colors hover:border-indigo-500/50 hover:text-indigo-400 hover:bg-surface-800/50"
                        >
                            <Plus className="h-5 w-5" /> Adicionar
                        </button>
                    </div>
                </div>
            </div>

            <CategoryForm
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSubmit={handleSubmit}
                initialData={editingCategory}
            />

            <Modal
                isOpen={!!categoryToDelete}
                onClose={() => setCategoryToDelete(null)}
                title="Excluir Categoria"
                size="sm"
            >
                <div className="space-y-4">
                    <p className="text-gray-300">
                        Tem certeza que deseja excluir a categoria <strong className="text-white">{categoryToDelete?.name}</strong>?
                    </p>
                    <div className="rounded-lg bg-yellow-500/10 p-4 border border-yellow-500/20">
                        <p className="text-sm text-yellow-500">
                            <strong>Atenção:</strong> As transações vinculadas a esta categoria não serão excluídas, mas ficarão sem categoria (isso será adaptado no MVP, mas tenha cuidado).
                        </p>
                    </div>
                    <div className="flex gap-3 pt-4 border-t border-surface-700">
                        <Button
                            variant="ghost"
                            onClick={() => setCategoryToDelete(null)}
                            disabled={isDeleting}
                            className="flex-1"
                        >
                            Cancelar
                        </Button>
                        <Button
                            variant="danger"
                            isLoading={isDeleting}
                            onClick={confirmDelete}
                            className="flex-1"
                        >
                            Excluir
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
