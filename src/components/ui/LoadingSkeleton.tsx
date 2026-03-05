interface LoadingSkeletonProps {
    variant: 'card' | 'row' | 'chart' | 'text';
    className?: string;
}

export function LoadingSkeleton({ variant, className = '' }: LoadingSkeletonProps) {
    const baseClass = 'rounded-2xl bg-[#151921] relative overflow-hidden';
    const shimmerOverlay = (
        <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/[0.03] to-transparent bg-[length:200%_100%]" />
    );

    if (variant === 'card') {
        return (
            <div className={`${baseClass} h-36 p-7 ${className}`}>
                {shimmerOverlay}
                <div className="flex justify-between relative z-10">
                    <div className="w-1/2 space-y-3">
                        <div className="h-4 w-2/3 rounded-lg bg-surface-700/50" />
                        <div className="h-8 w-full rounded-lg bg-surface-700/50" />
                    </div>
                    <div className="h-14 w-14 rounded-2xl bg-surface-700/50" />
                </div>
            </div>
        );
    }

    if (variant === 'row') {
        return (
            <div className={`${baseClass} flex h-16 items-center justify-between px-4 ${className}`}>
                {shimmerOverlay}
                <div className="flex items-center gap-4 relative z-10">
                    <div className="h-11 w-11 rounded-xl bg-surface-700/50" />
                    <div className="space-y-2">
                        <div className="h-4 w-32 rounded-lg bg-surface-700/50" />
                        <div className="h-3 w-20 rounded-lg bg-surface-700/50" />
                    </div>
                </div>
                <div className="h-5 w-24 rounded-lg bg-surface-700/50 relative z-10" />
            </div>
        );
    }

    if (variant === 'chart') {
        return (
            <div className={`${baseClass} h-[300px] w-full p-6 flex items-end justify-between ${className}`}>
                {shimmerOverlay}
                {[...Array(7)].map((_, i) => (
                    <div
                        key={i}
                        className="w-1/12 rounded-t bg-surface-700/50 relative z-10"
                        style={{ height: `${Math.random() * 60 + 20}%` }}
                    />
                ))}
            </div>
        );
    }

    // Text variant
    return (
        <div className={`h-4 w-full rounded-lg bg-[#151921] relative overflow-hidden ${className}`}>
            {shimmerOverlay}
        </div>
    );
}
