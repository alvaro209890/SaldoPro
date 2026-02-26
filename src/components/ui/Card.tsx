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
        <div className={`relative overflow-hidden rounded-2xl p-6 transition-all duration-300 bg-gradient-to-br from-surface-800/80 to-surface-900/90 shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-white/5 backdrop-blur-xl hover:shadow-[0_8px_30px_rgba(99,102,241,0.1)] hover:border-white/10 ${className}`}>

            {/* Subtle glow effect behind the card */}
            <div className="absolute -top-24 -right-24 h-48 w-48 rounded-full bg-indigo-500/10 blur-[50px] pointer-events-none" />

            <div className="relative z-10 flex items-center justify-between">
                <div>
                    <p className="text-sm rounded-full bg-surface-700/30 px-3 py-1 font-medium text-gray-300 w-fit backdrop-blur-sm border border-white/5 mb-3">{title}</p>
                    {hasValue ? (
                        <div className="mt-1 text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">{value}</div>
                    ) : null}
                </div>
                <div className={`rounded-2xl p-4 shadow-inner ring-1 ring-white/10 backdrop-blur-md ${iconClassName}`}>
                    <Icon className="h-6 w-6 stroke-[2.5px]" />
                </div>
            </div>

            {/* Optional subtitle/trend */}
            <div className="relative z-10">
                {(subtitle || trend) && (
                    <div className="mt-4 flex items-center gap-2 text-sm">
                        {trend && (
                            <span
                                className={`font-semibold px-2 py-0.5 rounded-md ${trend.isPositive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
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
