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
    sparkline?: ReactNode;
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
    sparkline,
}: CardProps) {
    const hasValue =
        value !== undefined &&
        value !== null &&
        !(typeof value === 'string' && value.trim() === '');

    return (
        <div className={`relative overflow-hidden rounded-2xl p-7 transition-all duration-300 bg-gradient-to-br from-[#151921] to-[#0f1218] shadow-[0_8px_30px_rgb(0,0,0,0.2)] border border-white/[0.04] backdrop-blur-xl hover:shadow-[0_8px_30px_rgba(124,58,237,0.08)] hover:border-white/[0.08] ${className}`}>

            {/* Subtle glow effect behind the card */}
            <div className="absolute -top-24 -right-24 h-48 w-48 rounded-full bg-finance-primary/[0.06] blur-[60px] pointer-events-none" />

            {/* Sparkline background overlay */}
            {sparkline && (
                <div className="absolute bottom-0 left-0 right-0 h-16 opacity-30 pointer-events-none">
                    {sparkline}
                </div>
            )}

            <div className="relative z-10 flex items-center justify-between">
                <div>
                    <p className="text-sm rounded-full bg-white/[0.04] px-3 py-1 font-medium text-gray-400 w-fit backdrop-blur-sm border border-white/[0.04] mb-3">{title}</p>
                    {hasValue ? (
                        <div className="mt-1 text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">{value}</div>
                    ) : null}
                </div>
                <div className={`rounded-2xl p-4 shadow-inner ring-1 ring-white/[0.06] backdrop-blur-md ${iconClassName}`}>
                    <Icon className="h-6 w-6 stroke-[2.5px]" />
                </div>
            </div>

            {/* Optional subtitle/trend */}
            <div className="relative z-10">
                {(subtitle || trend) && (
                    <div className="mt-4 flex items-center gap-2 text-sm">
                        {trend && (
                            <span
                                className={`font-semibold px-2 py-0.5 rounded-md ${trend.isPositive ? 'bg-finance-income/10 text-finance-income' : 'bg-finance-expense/10 text-finance-expense'
                                    }`}
                            >
                                {trend.isPositive ? '+' : '-'}
                                {Math.abs(trend.value)}%
                            </span>
                        )}
                        {subtitle && <span className="text-gray-400 font-medium">{subtitle}</span>}
                    </div>
                )}
                {children}
            </div>
        </div>
    );
}
