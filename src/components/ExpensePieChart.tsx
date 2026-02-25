import { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PieChart as PieChartIcon } from 'lucide-react';
import type { Transaction, Category } from '@/types';
import { formatBRL } from '@/utils/formatBRL';

interface ExpensePieChartProps {
    transactions: Transaction[];
    categories: Category[];
}

export function ExpensePieChart({ transactions, categories }: ExpensePieChartProps) {
    const data = useMemo(() => {
        const expenses = transactions.filter((t) => t.type === 'expense');

        const grouped = expenses.reduce((acc, curr) => {
            acc[curr.category] = (acc[curr.category] || 0) + curr.amount;
            return acc;
        }, {} as Record<string, number>);

        return Object.entries(grouped)
            .map(([categoryId, value]) => {
                const category = categories.find((c) => c.id === categoryId);
                return {
                    name: category?.name || categoryId,
                    value,
                    color: category?.color || '#6b7280',
                };
            })
            .sort((a, b) => b.value - a.value);
    }, [transactions, categories]);

    if (data.length === 0) {
        return (
            <Card title="Despesas por Categoria" icon={PieChartIcon} className="h-full">
                <div className="flex h-[300px] items-center justify-center mt-4">
                    <EmptyState
                        icon={PieChartIcon}
                        title="Nenhuma despesa"
                        description="Você ainda não tem despesas neste mês."
                        className="border-none bg-transparent"
                    />
                </div>
            </Card>
        );
    }

    return (
        <Card title="Despesas por Categoria" icon={PieChartIcon} className="h-full">
            <div className="h-[300px] mt-4">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={data}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                            stroke="none"
                        >
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                        </Pie>
                        <Tooltip
                            formatter={(value: number) => formatBRL(value)}
                            contentStyle={{
                                backgroundColor: '#0f172a',
                                border: '1px solid #334155',
                                borderRadius: '0.5rem',
                                color: '#f1f5f9',
                            }}
                            itemStyle={{ color: '#f1f5f9' }}
                        />
                        <Legend
                            verticalAlign="bottom"
                            height={36}
                            formatter={(value) => <span className="text-gray-300">{value}</span>}
                        />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </Card>
    );
}
