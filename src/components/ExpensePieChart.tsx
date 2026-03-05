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

// Beautiful standard fallback palette if a category has no color (or dull color)
const VIBRANT_PALETTE = ['#FF6B6B', '#7C3AED', '#3b82f6', '#00C9A7', '#f59e0b', '#ec4899', '#06b6d4'];

export function ExpensePieChart({ transactions, categories }: ExpensePieChartProps) {
    const data = useMemo(() => {
        const expenses = transactions.filter((t) => t.type === 'expense');

        const grouped = expenses.reduce((acc, curr) => {
            acc[curr.category] = (acc[curr.category] || 0) + curr.amount;
            return acc;
        }, {} as Record<string, number>);

        return Object.entries(grouped)
            .map(([categoryId, value], idx) => {
                const category = categories.find((c) => c.id === categoryId);
                const color = category?.color === '#6b7280' || !category?.color
                    ? VIBRANT_PALETTE[idx % VIBRANT_PALETTE.length]
                    : category.color;

                return {
                    name: category?.name || categoryId,
                    value,
                    color,
                };
            })
            .sort((a, b) => b.value - a.value);
    }, [transactions, categories]);

    if (data.length === 0) {
        return (
            <Card title="Despesas por Categoria" icon={PieChartIcon} className="h-full">
                <div className="flex h-[300px] items-center justify-center mt-4 bg-[#151921]/30 rounded-xl border border-white/[0.04]">
                    <EmptyState
                        icon={PieChartIcon}
                        title="Nenhuma despesa"
                        description="Você ainda não tem despesas neste mês."
                        className="border-none bg-transparent shadow-none"
                    />
                </div>
            </Card>
        );
    }

    return (
        <Card title="Despesas por Categoria" icon={PieChartIcon} className="h-full">
            <div className="h-[300px] mt-6 relative">
                {/* Glow effect center behind chart */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -mt-4 h-32 w-32 rounded-full bg-white/5 blur-xl pointer-events-none" />

                <ResponsiveContainer width="100%" height="100%" className="relative z-10">
                    <PieChart>
                        <Pie
                            data={data}
                            cx="50%"
                            cy="50%"
                            innerRadius={70}
                            outerRadius={95}
                            paddingAngle={8}
                            dataKey="value"
                            stroke="none"
                            cornerRadius={8}
                        >
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} style={{ filter: `drop-shadow(0 4px 6px ${entry.color}40)` }} />
                            ))}
                        </Pie>
                        <Tooltip
                            formatter={(value: number) => formatBRL(value)}
                            contentStyle={{
                                backgroundColor: 'rgba(21, 25, 33, 0.95)',
                                backdropFilter: 'blur(16px)',
                                border: '1px solid rgba(255,255,255,0.06)',
                                borderRadius: '12px',
                                color: '#f8fafc',
                                boxShadow: '0 10px 25px -3px rgba(0, 0, 0, 0.4)'
                            }}
                            itemStyle={{ color: '#f8fafc', fontWeight: 700 }}
                        />
                        <Legend
                            verticalAlign="bottom"
                            height={36}
                            iconType="circle"
                            formatter={(value) => <span className="text-gray-300 font-medium ml-1">{value}</span>}
                        />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </Card>
    );
}
