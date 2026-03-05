import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    (
        {
            className = '',
            variant = 'primary',
            size = 'md',
            isLoading,
            children,
            disabled,
            type = 'button',
            ...props
        },
        ref
    ) => {
        const baseStyles =
            'inline-flex items-center justify-center rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#0B0E14] disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97]';

        const variants = {
            primary:
                'bg-gradient-to-r from-finance-primary to-finance-primary-dark text-white hover:from-finance-primary-light hover:to-finance-primary focus:ring-finance-primary shadow-lg shadow-finance-primary/25',
            secondary:
                'bg-surface-800 text-gray-200 hover:bg-surface-700 focus:ring-gray-500 border border-surface-700',
            danger:
                'bg-finance-expense/10 text-finance-expense hover:bg-finance-expense/20 focus:ring-finance-expense border border-finance-expense/20',
            ghost: 'text-gray-400 hover:text-white hover:bg-white/[0.06] focus:ring-gray-500',
        };

        const sizes = {
            sm: 'h-8 px-3 text-xs',
            md: 'h-10 px-4 text-sm',
            lg: 'h-12 px-6 text-base',
        };

        return (
            <button
                ref={ref}
                type={type}
                className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
                disabled={disabled || isLoading}
                {...props}
            >
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {children}
            </button>
        );
    }
);

Button.displayName = 'Button';
