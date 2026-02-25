import { forwardRef } from 'react';
import { LucideIcon, ChevronDown } from 'lucide-react';

interface SelectOption {
    value: string;
    label: string;
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    label?: string;
    error?: string;
    icon?: LucideIcon;
    options: SelectOption[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
    ({ className = '', label, error, icon: Icon, id, options, ...props }, ref) => {
        const selectId = id || label?.toLowerCase().replace(/\s+/g, '-');

        return (
            <div className="w-full">
                {label && (
                    <label
                        htmlFor={selectId}
                        className="mb-1.5 block text-sm font-medium text-gray-300"
                    >
                        {label}
                    </label>
                )}
                <div className="relative">
                    {Icon && (
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                            <Icon className="h-5 w-5 text-gray-500" />
                        </div>
                    )}
                    <select
                        id={selectId}
                        ref={ref}
                        className={`block w-full appearance-none rounded-lg border border-surface-700 bg-surface-900/50 px-3 py-2 pr-10 text-sm text-gray-100 placeholder-gray-500 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 ${Icon ? 'pl-10' : ''
                            } ${error ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''} ${className}`}
                        {...props}
                    >
                        {options.map((option) => (
                            <option key={option.value} value={option.value} className="bg-surface-800">
                                {option.label}
                            </option>
                        ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                        <ChevronDown className="h-4 w-4 text-gray-500" />
                    </div>
                </div>
                {error && (
                    <p className="mt-1.5 text-xs text-red-500 animate-fade-in">{error}</p>
                )}
            </div>
        );
    }
);

Select.displayName = 'Select';
