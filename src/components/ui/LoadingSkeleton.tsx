interface LoadingSkeletonProps {
    variant: 'card' | 'row' | 'chart' | 'text';
    className?: string;
}

export function LoadingSkeleton({ variant, className = '' }: LoadingSkeletonProps) {
    const baseClass = 'animate-pulse rounded-2xl bg-surface-800';

    if (variant === 'card') {
        return (
            <div className={`${baseClass} h-32 p-6 ${className}`}>
                <div className="flex justify-between">
                    <div className="w-1/2 space-y-3">
                        <div className="h-4 w-2/3 rounded bg-surface-700" />
                        <div className="h-8 w-full rounded bg-surface-700" />
                    </div>
                    <div className="h-12 w-12 rounded-xl bg-surface-700" />
                </div>
            </div>
        );
    }

    if (variant === 'row') {
        return (
            <div className={`${baseClass} flex h-16 items-center justify-between px-4 ${className}`}>
                <div className="flex items-center gap-4">
                    <div className="h-10 w-10 border-indigo-500 rounded-full bg-surface-700" />
                    <div className="space-y-2">
                        <div className="h-4 w-32 rounded bg-surface-700" />
                        <div className="h-3 w-20 rounded bg-surface-700" />
                    </div>
                </div>
                <div className="h-5 w-24 rounded bg-surface-700" />
            </div>
        );
    }

    if (variant === 'chart') {
        return (
            <div className={`${baseClass} h-[300px] w-full p-6 flex items-end justify-between ${className}`}>
                {[...Array(7)].map((_, i) => (
                    <div
                        key={i}
                        className="w-1/12 rounded-t bg-surface-700"
                        style={{ height: `${Math.random() * 60 + 20}%` }}
                    />
                ))}
            </div>
        );
    }

    // Text variant
    return <div className={`h-4 w-full animate-pulse rounded bg-surface-800 ${className}`} />;
}
