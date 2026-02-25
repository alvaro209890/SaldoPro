import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getMonthLabel, navigateMonth } from '@/utils/date';

interface MonthSelectorProps {
    currentMonthKey: string;
    onChange: (newMonthKey: string) => void;
}

export function MonthSelector({ currentMonthKey, onChange }: MonthSelectorProps) {
    const handlePrev = () => onChange(navigateMonth(currentMonthKey, -1));
    const handleNext = () => onChange(navigateMonth(currentMonthKey, 1));

    return (
        <div className="flex items-center gap-4 rounded-xl border border-surface-700 bg-surface-800/50 p-2 glass">
            <button
                onClick={handlePrev}
                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-surface-700 hover:text-white"
                aria-label="Mês anterior"
            >
                <ChevronLeft className="h-5 w-5" />
            </button>

            <div className="w-32 text-center font-medium text-gray-200">
                {getMonthLabel(currentMonthKey)}
            </div>

            <button
                onClick={handleNext}
                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-surface-700 hover:text-white"
                aria-label="Próximo mês"
            >
                <ChevronRight className="h-5 w-5" />
            </button>
        </div>
    );
}
