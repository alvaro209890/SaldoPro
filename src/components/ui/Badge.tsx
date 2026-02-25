interface BadgeProps {
    children: React.ReactNode;
    colorHex?: string; // e.g. '#10b981'
    variant?: 'success' | 'danger' | 'warning' | 'info' | 'default';
    className?: string;
}

export function Badge({ children, colorHex, variant = 'default', className = '' }: BadgeProps) {
    let style: React.CSSProperties = {};
    let variantClasses = '';

    if (colorHex) {
        style = {
            backgroundColor: `${colorHex}33`, // 20% opacity hex
            color: colorHex,
            borderColor: `${colorHex}66`,
        };
    } else {
        const variants = {
            success: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
            danger: 'bg-red-500/20 text-red-400 border-red-500/30',
            warning: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
            info: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
            default: 'bg-surface-800 text-gray-300 border-surface-700',
        };
        variantClasses = variants[variant];
    }

    return (
        <span
            style={style}
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${variantClasses} ${className}`}
        >
            {children}
        </span>
    );
}
