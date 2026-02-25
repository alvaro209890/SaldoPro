import { forwardRef, useState, useRef, useEffect } from 'react';
import { LucideIcon, ChevronDown, Check } from 'lucide-react';

interface SelectOption {
    value: string;
    label: string;
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
    label?: string;
    error?: string;
    icon?: LucideIcon;
    options: SelectOption[];
    value?: string;
    onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
    ({ className = '', label, error, icon: Icon, id, options, value, onChange, defaultValue, ...props }, ref) => {
        const selectId = id || label?.toLowerCase().replace(/\s+/g, '-');
        const [isOpen, setIsOpen] = useState(false);
        const containerRef = useRef<HTMLDivElement>(null);

        // Native select ref to trigger events for react-hook-form
        const nativeSelectRef = useRef<HTMLSelectElement>(null);

        // Keep local state in sync with provided value (useful when uncontrolled)
        const [internalValue, setInternalValue] = useState(value || defaultValue || '');

        useEffect(() => {
            if (value !== undefined) {
                setInternalValue(value);
            }
        }, [value]);

        useEffect(() => {
            const handleClickOutside = (event: MouseEvent) => {
                if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                    setIsOpen(false);
                }
            };
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }, []);

        const selectedOption = options.find(o => o.value === internalValue) ||
            options.find(o => o.value === '') ||
            options[0];

        const handleSelect = (optionValue: string) => {
            if (value === undefined) setInternalValue(optionValue);
            setIsOpen(false);

            // Dispatch native event for react-hook-form
            if (nativeSelectRef.current) {
                nativeSelectRef.current.value = optionValue;
                const event = new Event('change', { bubbles: true });
                nativeSelectRef.current.dispatchEvent(event);
            }
            // Fire explicitly passed onChange with mock event
            if (onChange) {
                onChange({
                    target: { name: props.name, value: optionValue },
                    currentTarget: { name: props.name, value: optionValue }
                } as unknown as React.ChangeEvent<HTMLSelectElement>);
            }
        };

        return (
            <div className="w-full" ref={containerRef}>
                {label && (
                    <label
                        htmlFor={selectId}
                        className="mb-1.5 block text-sm font-medium text-gray-300"
                    >
                        {label}
                    </label>
                )}

                <div className="relative">
                    {/* Hidden Native Select for RHF Integration */}
                    <select
                        ref={(r) => {
                            // Forward ref to RHF and also keep our own ref
                            if (typeof ref === 'function') ref(r);
                            else if (ref) ref.current = r;
                            (nativeSelectRef as any).current = r;
                        }}
                        id={selectId}
                        value={internalValue}
                        onChange={(e) => {
                            if (value === undefined) setInternalValue(e.target.value);
                            onChange?.(e);
                        }}
                        className="hidden"
                        {...props}
                    >
                        {options.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>

                    {/* Custom Trigger */}
                    <button
                        type="button"
                        onClick={() => !props.disabled && setIsOpen(!isOpen)}
                        disabled={props.disabled}
                        className={`relative flex w-full items-center justify-between rounded-lg border bg-surface-900/50 px-3 py-2 text-sm text-gray-100 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-50
                            ${isOpen ? 'border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.2)]' : 'border-surface-700 hover:border-surface-600'}
                            ${error ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''} 
                            ${Icon ? 'pl-10' : ''} 
                            ${className}`
                        }
                    >
                        {Icon && (
                            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                                <Icon className={`h-5 w-5 transition-colors ${isOpen ? 'text-indigo-400' : 'text-gray-500'}`} />
                            </div>
                        )}
                        <span className={`block truncate ${!selectedOption?.value ? 'text-gray-500' : ''}`}>
                            {selectedOption ? selectedOption.label : 'Selecione...'}
                        </span>
                        <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                            <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isOpen ? 'rotate-180 text-indigo-400' : 'text-gray-500'}`} />
                        </span>
                    </button>

                    {/* Custom Dropdown */}
                    {isOpen && (
                        <div className="absolute z-50 mt-2 w-full origin-top rounded-xl border border-surface-700 bg-surface-900 overflow-hidden shadow-2xl animate-in fade-in slide-in-from-top-2 focus:outline-none">
                            <div className="max-h-60 overflow-y-auto py-1 custom-scrollbar">
                                {options.map((option) => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => handleSelect(option.value)}
                                        className={`relative flex w-full cursor-pointer select-none items-center py-2.5 pl-3 pr-9 text-sm transition-colors
                                            ${internalValue === option.value
                                                ? 'bg-indigo-500/10 text-indigo-400 font-medium'
                                                : 'text-gray-300 hover:bg-surface-800 hover:text-white'
                                            }
                                        `}
                                    >
                                        <span className="block truncate">{option.label}</span>
                                        {internalValue === option.value && (
                                            <span className="absolute inset-y-0 right-0 flex items-center pr-3 text-indigo-400">
                                                <Check className="h-4 w-4" />
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
                {error && (
                    <p className="mt-1.5 text-xs text-red-500 animate-fade-in">{error}</p>
                )}
            </div>
        );
    }
);

Select.displayName = 'Select';
