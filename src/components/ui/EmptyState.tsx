import { LucideIcon } from 'lucide-react';
import { Button } from './Button';

interface EmptyStateProps {
    icon: LucideIcon;
    title: string;
    description: string;
    actionLabel?: string;
    onAction?: () => void;
    className?: string;
}

export function EmptyState({
    icon: Icon,
    title,
    description,
    actionLabel,
    onAction,
    className = '',
}: EmptyStateProps) {
    return (
        <div className={`flex flex-col items-center justify-center rounded-2xl border border-dashed border-surface-700/50 bg-surface-900/20 p-8 text-center animate-fade-in ${className}`}>
            <div className="relative mb-5">
                {/* Animated pulse ring */}
                <div className="absolute inset-0 rounded-full bg-finance-primary/20 animate-pulse-ring" />
                <div className="relative rounded-full bg-gradient-to-br from-finance-primary/20 to-finance-primary/5 p-4 ring-1 ring-finance-primary/10 animate-float">
                    <Icon className="h-8 w-8 text-finance-primary-light" />
                </div>
            </div>
            <h3 className="mb-2 text-lg font-semibold gradient-text">{title}</h3>
            <p className="mb-6 max-w-sm text-sm text-gray-500 leading-relaxed">{description}</p>
            {actionLabel && onAction && (
                <Button onClick={onAction} variant="primary">
                    {actionLabel}
                </Button>
            )}
        </div>
    );
}
