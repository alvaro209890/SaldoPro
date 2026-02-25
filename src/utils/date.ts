const MONTH_NAMES = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export function generateMonthKey(dateStr: string): string {
    return dateStr.slice(0, 7); // "YYYY-MM"
}

export function formatDateBR(dateStr: string): string {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

export function getMonthLabel(monthKey: string): string {
    const [year, month] = monthKey.split('-').map(Number);
    return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function navigateMonth(monthKey: string, direction: -1 | 1): string {
    const [year, month] = monthKey.split('-').map(Number);
    const d = new Date(year, month - 1 + direction, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function getCurrentMonthKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function todayISO(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function getDaysInMonth(monthKey: string): number {
    const [year, month] = monthKey.split('-').map(Number);
    return new Date(year, month, 0).getDate();
}

export function getMonthDates(monthKey: string): string[] {
    const days = getDaysInMonth(monthKey);
    const dates: string[] = [];
    for (let i = 1; i <= days; i++) {
        dates.push(`${monthKey}-${String(i).padStart(2, '0')}`);
    }
    return dates;
}
