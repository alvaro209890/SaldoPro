import { useMemo } from 'react';
import {
    ComposedChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Activity } from 'lucide-react';
import type { Transaction } from '@/types';
import { getMonthDates } from '@/utils/date';
import { formatBRL, formatCompact } from '@/utils/formatBRL';

interface BalanceLineChartProps {
    transactions: Transaction[];
    monthKey: string;
}

interface DailyFlowPoint {
    date: string;
    fullDate: string;
    income: number;
    expense: number;
}

export function BalanceLineChart({ transactions, monthKey }: BalanceLineChartProps) {
    const isEmpty = transactions.length === 0;

    const data = useMemo<DailyFlowPoint[]>(() => {
        if (isEmpty) return [];

        const dates = getMonthDates(monthKey);
        const dailyTotals = transactions.reduce((acc, tx) => {
            if (!acc[tx.date]) {
                acc[tx.date] = { income: 0, expense: 0 };
            }

            if (tx.type === 'income') {
                acc[tx.date].income += tx.amount;
            } else {
                acc[tx.date].expense += tx.amount;
            }

            return acc;
        }, {} as Record<string, { income: number; expense: number }>);

        const today = new Date();
        const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        const isCurrentMonth = monthKey === currentMonthKey;
        const currentDay = today.getDate();

        const chartData: DailyFlowPoint[] = [];

        for (let i = 0; i < dates.length; i++) {
            const date = dates[i];
            const dayNum = parseInt(date.split('-')[2], 10);

            if (isCurrentMonth && dayNum > currentDay) {
                break;
            }

            const income = dailyTotals[date]?.income ?? 0;
            const expense = dailyTotals[date]?.expense ?? 0;

            chartData.push({
                date: String(dayNum).padStart(2, '0'),
                fullDate: date,
                income,
                expense
            });
        }

        return chartData;
    }, [transactions, monthKey, isEmpty]);

    return (
        <Card title="Fluxo Diario (Entradas x Saidas)" icon={Activity} className="h-full">
            {isEmpty ? (
                <div className="flex h-[300px] items-center justify-center mt-4 bg-surface-900/30 rounded-xl border border-white/5">
                    <EmptyState
                        icon={Activity}
                        title="Sem movimentacoes"
                        description="Adicione receitas e despesas para visualizar o fluxo diario do mes."
                        className="border-none bg-transparent shadow-none"
                    />
                </div>
            ) : (
                <div className="h-[300px] mt-6 -ml-4">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" strokeOpacity={0.1} vertical={false} />
                            <XAxis
                                dataKey="date"
                                stroke="#94a3b8"
                                fontSize={11}
                                tickLine={false}
                                axisLine={false}
                                dy={10}
                            />
                            <YAxis
                                stroke="#94a3b8"
                                fontSize={11}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(value) => formatCompact(value)}
                                width={60}
                            />
                            <Tooltip
                                labelFormatter={(label) => {
                                    const [year, month] = monthKey.split('-');
                                    const day = String(label).padStart(2, '0');
                                    return `${day}/${month}/${year}`;
                                }}
                                formatter={(value: number, name) => {
                                    const label =
                                        name === 'income'
                                            ? 'Entradas'
                                            : 'Saidas';
                                    return [formatBRL(value), label];
                                }}
                                cursor={{ stroke: '#64748b', strokeWidth: 1, strokeDasharray: '4 4' }}
                                contentStyle={{
                                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                                    backdropFilter: 'blur(10px)',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: '12px',
                                    color: '#f8fafc',
                                    fontWeight: 500,
                                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)'
                                }}
                                itemStyle={{ color: '#e2e8f0', fontWeight: 700 }}
                            />
                            <Bar
                                dataKey="income"
                                name="Entradas"
                                fill="#10b981"
                                radius={[6, 6, 0, 0]}
                                maxBarSize={18}
                            />
                            <Bar
                                dataKey="expense"
                                name="Saidas"
                                fill="#f43f5e"
                                radius={[6, 6, 0, 0]}
                                maxBarSize={18}
                            />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            )}
        </Card>
    );
}
