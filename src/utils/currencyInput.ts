const CURRENCY_FORMATTER = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

export function parseCurrencyInput(rawValue: string): number {
    const digits = rawValue.replace(/\D/g, '');
    if (!digits) return 0;
    return Number.parseInt(digits, 10) / 100;
}

export function formatCurrencyInput(
    value: number,
    options: { emptyWhenZero?: boolean } = {}
): string {
    const { emptyWhenZero = true } = options;
    if (!Number.isFinite(value)) return '';
    if (value === 0 && emptyWhenZero) return '';
    return CURRENCY_FORMATTER.format(Math.max(0, value));
}

export function maskCurrencyInput(rawValue: string, options: { emptyWhenZero?: boolean } = {}): string {
    const parsed = parseCurrencyInput(rawValue);
    return formatCurrencyInput(parsed, options);
}

export function parseLocaleNumberInput(rawValue: string): number {
    const normalized = rawValue
        .trim()
        .replace(/\s+/g, '')
        .replace(/[R$]/g, '')
        .replace(/\.(?=.*[,])/g, '')
        .replace(',', '.');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function sanitizeDecimalInput(rawValue: string, maxDecimals = 2): string {
    const cleaned = rawValue.replace(/[^\d.,]/g, '').replace(/\./g, ',');
    if (!cleaned) return '';

    const [rawInteger = '', ...rest] = cleaned.split(',');
    const integerPart = rawInteger.replace(/^0+(?=\d)/, '');
    const decimalPart = rest.join('').slice(0, maxDecimals);

    if (decimalPart.length > 0) {
        return `${integerPart || '0'},${decimalPart}`;
    }

    return integerPart;
}
