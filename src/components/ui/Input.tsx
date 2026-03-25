import { forwardRef, useState } from 'react';
import { LucideIcon, Eye, EyeOff } from 'lucide-react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    icon?: LucideIcon;
    rightElement?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
    ({ className = '', label, error, icon: Icon, rightElement, id, type = 'text', ...props }, ref) => {
        const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
        const [showPassword, setShowPassword] = useState(false);

        const isPassword = type === 'password';
        const inputType = isPassword ? (showPassword ? 'text' : 'password') : type;

        return (
            <div className="w-full">
                {label && (
                    <label
                        htmlFor={inputId}
                        className="mb-1.5 block text-[13px] font-medium text-slate-300"
                    >
                        {label}
                    </label>
                )}
                <div className="relative">
                    {Icon && (
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                            <Icon className={`h-4 w-4 ${error ? 'text-rose-400' : 'text-slate-400'}`} />
                        </div>
                    )}
                    <input
                        id={inputId}
                        ref={ref}
                        type={inputType}
                        className={`block w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[14px] text-white placeholder-slate-500 shadow-sm transition-all hover:bg-white/[0.04] focus:border-emerald-500/50 focus:bg-white/[0.05] focus:outline-none focus:ring-4 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50 ${
                            Icon ? 'pl-10' : ''
                        } ${
                            isPassword || rightElement ? 'pr-10' : ''
                        } ${
                            error ? 'border-rose-500/50 focus:border-rose-500 focus:ring-rose-500/10' : ''
                        } ${className}`}
                        {...props}
                    />
                    
                    {/* Right side elements (Password toggle or custom) */}
                    {(isPassword || rightElement) && (
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                            {rightElement ? (
                                rightElement
                            ) : isPassword ? (
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="text-slate-400 hover:text-white focus:outline-none transition-colors p-1"
                                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                                >
                                    {showPassword ? (
                                        <EyeOff className="h-4 w-4" />
                                    ) : (
                                        <Eye className="h-4 w-4" />
                                    )}
                                </button>
                            ) : null}
                        </div>
                    )}
                </div>
                {error && (
                    <p className="mt-1.5 text-xs text-rose-400 font-medium animate-fade-in">{error}</p>
                )}
            </div>
        );
    }
);

Input.displayName = 'Input';
