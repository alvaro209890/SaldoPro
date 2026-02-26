import { useMemo } from 'react';
import {
    AreaChart,
    Area,
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

export function BalanceLineChart({ transactions, monthKey }: BalanceLineChartProps) {
    const isEmpty = transactions.length === 0;
    const data = useMemo(() => {
        if (isEmpty) return [];

        const dates = getMonthDates(monthKey);
        let runningBalance = 0;

        // Sort transactions chronologically
        const sortedTx = [...transactions].sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        );

        const today = new Date();
        const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        const isCurrentMonth = monthKey === currentMonthKey;
        const currentDay = today.getDate();

        // Group by date
        const dailyTx = sortedTx.reduce((acc, curr) => {
            if (!acc[curr.date]) acc[curr.date] = [];
            acc[curr.date].push(curr);
            return acc;
        }, {} as Record<string, Transaction[]>);

        const chartData = [];
        for (let i = 0; i < dates.length; i++) {
            const date = dates[i];
            const dayNum = parseInt(date.split('-')[2], 10);

            // If we are in the current month, don't draw flat lines into the future
            if (isCurrentMonth && dayNum > currentDay) {
                break;
            }

            const dayTransactions = dailyTx[date] || [];
            const dayNet = dayTransactions.reduce(
                (acc, t) => acc + (t.type === 'income' ? t.amount : -t.amount),
                0
            );

            runningBalance += dayNet;

            chartData.push({
                date: String(dayNum).padStart(2, '0'), // Just the day
                fullDate: date,
                balance: runningBalance,
                dayNet,
            });
        }

        return chartData;
    }, [transactions, monthKey, isEmpty]);

    return (
        <Card title="Evolução do Saldo" icon={Activity} className="h-full">
            {isEmpty ? (
                <div className="flex h-[300px] items-center justify-center mt-4 bg-surface-900/30 rounded-xl border border-white/5">
                    <EmptyState
                        icon={Activity}
                        title="Sem movimentações"
                        description="Adicione receitas e despesas para acompanhar a evolução do saldo."
                        className="border-none bg-transparent shadow-none"
                    />
                </div>
            ) : (
                <div className="h-[300px] mt-6 -ml-4">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.6} />
                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                </linearGradient>
                            </defs>
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
                                labelFormatter={(label, payload) => {
                                    if (payload && payload[0]) {
                                        const [y, m, d] = payload[0].payload.fullDate.split('-');
                                        return `${d}/${m}/${y}`;
                                    }
                                    return label;
                                }}
                                formatter={(value: number) => [formatBRL(value), 'Saldo']}
                                cursor={{ stroke: '#8b5cf6', strokeWidth: 1, strokeDasharray: '4 4' }}
                                contentStyle={{
                                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                                    backdropFilter: 'blur(10px)',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: '12px',
                                    color: '#f8fafc',
                                    fontWeight: 500,
                                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)'
                                }}
                                itemStyle={{ color: '#a855f7', fontWeight: 700 }}
                            />
                            <Area
                                type="monotone"
                                dataKey="balance"
                                stroke="#a855f7"
                                strokeWidth={3}
                                activeDot={{ r: 6, fill: '#cbd5e1', stroke: '#a855f7', strokeWidth: 3 }}
                                fillOpacity={1}
                                fill="url(#colorBalance)"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            )}
        </Card>
    );
}
