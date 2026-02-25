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

        // Group by date
        const dailyTx = sortedTx.reduce((acc, curr) => {
            if (!acc[curr.date]) acc[curr.date] = [];
            acc[curr.date].push(curr);
            return acc;
        }, {} as Record<string, Transaction[]>);

        return dates.map((date) => {
            const dayTransactions = dailyTx[date] || [];
            const dayNet = dayTransactions.reduce(
                (acc, t) => acc + (t.type === 'income' ? t.amount : -t.amount),
                0
            );

            runningBalance += dayNet;

            return {
                date: date.split('-')[2], // Just the day
                fullDate: date,
                balance: runningBalance,
                dayNet,
            };
        });
    }, [transactions, monthKey, isEmpty]);

    return (
        <Card title="Evolução do Saldo" icon={Activity} className="h-full">
            {isEmpty ? (
                <div className="flex h-[300px] items-center justify-center mt-4">
                    <EmptyState
                        icon={Activity}
                        title="Sem movimentações"
                        description="Adicione receitas e despesas para acompanhar a evolução do saldo."
                        className="border-none bg-transparent shadow-none"
                    />
                </div>
            ) : (
                <div className="h-[300px] mt-4">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                            <XAxis
                                dataKey="date"
                                stroke="#64748b"
                                fontSize={12}
                                tickLine={false}
                                axisLine={false}
                                dy={10}
                            />
                            <YAxis
                                stroke="#64748b"
                                fontSize={12}
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
                                contentStyle={{
                                    backgroundColor: '#0f172a',
                                    border: '1px solid #334155',
                                    borderRadius: '0.5rem',
                                    color: '#f1f5f9',
                                }}
                            />
                            <Area
                                type="monotone"
                                dataKey="balance"
                                stroke="#6366f1"
                                strokeWidth={2}
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
