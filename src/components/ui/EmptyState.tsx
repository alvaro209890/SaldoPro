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
        <div className={`flex flex-col items-center justify-center rounded-2xl border border-dashed border-surface-700 bg-surface-900/30 p-8 text-center animate-fade-in ${className}`}>
            <div className="mb-4 rounded-full bg-surface-800 p-4">
                <Icon className="h-8 w-8 text-gray-500" />
            </div>
            <h3 className="mb-2 text-lg font-semibold text-gray-200">{title}</h3>
            <p className="mb-6 max-w-sm text-sm text-gray-500">{description}</p>
            {actionLabel && onAction && (
                <Button onClick={onAction} variant="secondary">
                    {actionLabel}
                </Button>
            )}
        </div>
    );
}
