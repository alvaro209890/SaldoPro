import { useState, useEffect } from 'react';
import { Search, Filter, X } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { PAYMENT_METHOD_LABELS } from '@/utils/constants';
import type { Category, TransactionFilters as FilterType } from '@/types';

interface TransactionFiltersProps {
    filters: FilterType;
    onChange: (filters: FilterType) => void;
    categories: Category[];
}

export function TransactionFilters({ filters, onChange, categories }: TransactionFiltersProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [localSearch, setLocalSearch] = useState(filters.search);

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            if (filters.search !== localSearch) {
                onChange({ ...filters, search: localSearch });
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [localSearch, filters, onChange]);

    const handleChange = (key: keyof FilterType, value: any) => {
        onChange({ ...filters, [key]: value });
    };

    const handleClear = () => {
        onChange({
            search: '',
            type: 'all',
            category: '',
            paymentMethod: '',
            dateFrom: '',
            dateTo: '',
            amountMin: '',
            amountMax: '',
            sortBy: 'date',
            sortOrder: 'desc',
        });
        setLocalSearch('');
    };

    const activeFiltersCount = [
        filters.type !== 'all',
        filters.category !== '',
        filters.paymentMethod !== '',
        filters.dateFrom !== '',
        filters.dateTo !== '',
        filters.amountMin !== '',
        filters.amountMax !== '',
    ].filter(Boolean).length;

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-4">
                <div className="flex-1">
                    <Input
                        icon={Search}
                        placeholder="Buscar transações..."
                        value={localSearch}
                        onChange={(e) => setLocalSearch(e.target.value)}
                    />
                </div>
                <Button
                    variant={activeFiltersCount > 0 ? 'primary' : 'secondary'}
                    onClick={() => setIsOpen(!isOpen)}
                    className="shrink-0"
                >
                    <Filter className="mr-2 h-4 w-4" />
                    Filtros {activeFiltersCount > 0 && `(${activeFiltersCount})`}
                </Button>
            </div>

            {isOpen && (
                <div className="rounded-xl border border-surface-700 bg-surface-800/50 p-4 animate-fade-in glass">
                    <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-sm font-medium text-gray-200">Filtros Avançados</h3>
                        <button
                            onClick={handleClear}
                            className="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-1"
                        >
                            <X className="h-4 w-4" /> Limpar tudo
                        </button>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <Select
                            label="Tipo"
                            value={filters.type}
                            onChange={(e) => handleChange('type', e.target.value)}
                            options={[
                                { value: 'all', label: 'Todos' },
                                { value: 'income', label: 'Receitas' },
                                { value: 'expense', label: 'Despesas' },
                            ]}
                        />

                        <Select
                            label="Categoria"
                            value={filters.category}
                            onChange={(e) => handleChange('category', e.target.value)}
                            options={[
                                { value: '', label: 'Todas as categorias' },
                                ...categories
                                    .filter((c) => filters.type === 'all' || c.type === filters.type)
                                    .map((c) => ({ value: c.id, label: c.name })),
                            ]}
                        />

                        <Select
                            label="Forma de Pagamento"
                            value={filters.paymentMethod}
                            onChange={(e) => handleChange('paymentMethod', e.target.value)}
                            options={[
                                { value: '', label: 'Todas as formas' },
                                ...Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({
                                    value,
                                    label,
                                })),
                            ]}
                        />

                        <div className="grid grid-cols-2 gap-2">
                            <Input
                                label="Data Inicial"
                                type="date"
                                value={filters.dateFrom}
                                onChange={(e) => handleChange('dateFrom', e.target.value)}
                            />
                            <Input
                                label="Data Final"
                                type="date"
                                value={filters.dateTo}
                                onChange={(e) => handleChange('dateTo', e.target.value)}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <Input
                                label="Valor Mín"
                                type="number"
                                placeholder="0.00"
                                value={filters.amountMin}
                                onChange={(e) => handleChange('amountMin', e.target.value)}
                            />
                            <Input
                                label="Valor Máx"
                                type="number"
                                placeholder="0.00"
                                value={filters.amountMax}
                                onChange={(e) => handleChange('amountMax', e.target.value)}
                            />
                        </div>

                        <Select
                            label="Ordenar por"
                            value={filters.sortBy}
                            onChange={(e) => handleChange('sortBy', e.target.value)}
                            options={[
                                { value: 'date', label: 'Data' },
                                { value: 'amount', label: 'Valor' },
                                { value: 'description', label: 'Descrição' },
                            ]}
                        />

                        <Select
                            label="Ordem"
                            value={filters.sortOrder}
                            onChange={(e) => handleChange('sortOrder', e.target.value)}
                            options={[
                                { value: 'desc', label: 'Decrescente' },
                                { value: 'asc', label: 'Crescente' },
                            ]}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
