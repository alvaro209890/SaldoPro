import { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface CardProps {
    title: string;
    value?: string | ReactNode;
    subtitle?: string;
    icon: LucideIcon;
    trend?: {
        value: number;
        isPositive: boolean;
    };
    iconClassName?: string;
    className?: string;
    children?: ReactNode;
}

export function Card({
    title,
    value,
    subtitle,
    icon: Icon,
    trend,
    iconClassName = 'text-gray-400 bg-surface-800',
    className = '',
    children,
}: CardProps) {
    const hasValue =
        value !== undefined &&
        value !== null &&
        !(typeof value === 'string' && value.trim() === '');

    return (
        <div className={`glass-card rounded-2xl p-6 transition-all hover:bg-surface-800/50 ${className}`}>
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-medium text-gray-400">{title}</p>
                    {hasValue ? (
                        <div className="mt-2 text-2xl font-bold text-white">{value}</div>
                    ) : null}
                </div>
                <div className={`rounded-xl p-3 ${iconClassName}`}>
                    <Icon className="h-6 w-6" />
                </div>
            </div>
            {(subtitle || trend) && (
                <div className="mt-4 flex items-center gap-2 text-sm">
                    {trend && (
                        <span
                            className={`font-medium ${trend.isPositive ? 'text-emerald-400' : 'text-red-400'
                                }`}
                        >
                            {trend.isPositive ? '+' : '-'}
                            {Math.abs(trend.value)}%
                        </span>
                    )}
                    {subtitle && <span className="text-gray-500">{subtitle}</span>}
                </div>
            )}
            {children}
        </div>
    );
}
