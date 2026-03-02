// backend/src/ai/charts.ts
// Standalone module for generating financial chart images via QuickChart.io.
// No heavy dependencies — simply builds a Chart.js config and returns a URL.

import { getBrasiliaISOString } from '../lib/date-utils';
import { logger } from '../lib/logger';
import type { UserCategory, UserSettingsBackend, UserTransaction } from '../lib/firestore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChartType = 'expense_pie' | 'income_expense_bar' | 'balance_line';

const VALID_CHART_TYPES: ChartType[] = ['expense_pie', 'income_expense_bar', 'balance_line'];

export function isValidChartType(value: string): value is ChartType {
    return VALID_CHART_TYPES.includes(value as ChartType);
}

export const CHART_TYPE_LABELS: Record<ChartType, string> = {
    expense_pie: 'Pizza de Despesas por Categoria',
    income_expense_bar: 'Receitas vs Despesas',
    balance_line: 'Evolução do Saldo Diário',
};

// ---------------------------------------------------------------------------
// Design tokens (dark theme matching SaldoPro identity)
// ---------------------------------------------------------------------------

const COLORS = {
    background: '#0f172a',
    gridLines: 'rgba(148, 163, 184, 0.12)',
    textPrimary: '#e2e8f0',
    textSecondary: '#94a3b8',
    income: '#10b981',
    incomeLight: 'rgba(16, 185, 129, 0.25)',
    expense: '#ef4444',
    expenseLight: 'rgba(239, 68, 68, 0.25)',
    balanceLine: '#818cf8',
    balanceFill: 'rgba(129, 140, 248, 0.15)',
};

/** Palette for pie/doughnut slices — curated to look premium on dark backgrounds. */
const PIE_PALETTE = [
    '#818cf8', // indigo
    '#f472b6', // pink
    '#38bdf8', // sky
    '#facc15', // yellow
    '#fb923c', // orange
    '#34d399', // emerald
    '#a78bfa', // violet
    '#f87171', // red
    '#22d3ee', // cyan
    '#e879f9', // fuchsia
    '#4ade80', // green
    '#fbbf24', // amber
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCurrentMonthKey(): string {
    const iso = getBrasiliaISOString();
    return iso.slice(0, 7); // "YYYY-MM"
}

function formatCurrency(value: number, currency: string): string {
    if (currency === 'BRL') return `R$ ${value.toFixed(2).replace('.', ',')}`;
    return `${currency} ${value.toFixed(2)}`;
}

function formatMonthLabel(monthKey: string): string {
    const [year, month] = monthKey.split('-');
    const monthNames = [
        'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
        'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
    ];
    return `${monthNames[Number(month) - 1]} ${year}`;
}

function daysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
}

// ---------------------------------------------------------------------------
// Chart builders
// ---------------------------------------------------------------------------

function buildExpensePieConfig(
    transactions: UserTransaction[],
    categories: UserCategory[],
    settings: UserSettingsBackend
): object {
    const monthKey = getCurrentMonthKey();
    const monthTx = transactions.filter(
        (t) => t.monthKey === monthKey && t.type === 'expense'
    );

    const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
    const totals = new Map<string, number>();

    for (const tx of monthTx) {
        const name = categoryMap.get(tx.category) || 'Outros';
        totals.set(name, (totals.get(name) || 0) + tx.amount);
    }

    // Sort descending, cap at 10 slices + "Outros"
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    let labels: string[];
    let data: number[];

    if (sorted.length <= 10) {
        labels = sorted.map(([name, val]) => `${name} (${formatCurrency(val, settings.currency)})`);
        data = sorted.map(([, val]) => val);
    } else {
        const top = sorted.slice(0, 9);
        const otherTotal = sorted.slice(9).reduce((sum, [, val]) => sum + val, 0);
        labels = [
            ...top.map(([name, val]) => `${name} (${formatCurrency(val, settings.currency)})`),
            `Outros (${formatCurrency(otherTotal, settings.currency)})`
        ];
        data = [...top.map(([, val]) => val), otherTotal];
    }

    const totalExpense = data.reduce((s, v) => s + v, 0);

    return {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: PIE_PALETTE.slice(0, data.length),
                borderColor: COLORS.background,
                borderWidth: 3,
            }],
        },
        options: {
            plugins: {
                title: {
                    display: true,
                    text: `Despesas por Categoria — ${formatMonthLabel(monthKey)}`,
                    font: { size: 18, family: 'Inter, sans-serif', weight: 'bold' },
                    color: COLORS.textPrimary,
                    padding: { bottom: 8 },
                },
                subtitle: {
                    display: true,
                    text: `Total: ${formatCurrency(totalExpense, settings.currency)}`,
                    font: { size: 14, family: 'Inter, sans-serif' },
                    color: COLORS.textSecondary,
                    padding: { bottom: 16 },
                },
                legend: {
                    position: 'right',
                    labels: {
                        color: COLORS.textPrimary,
                        font: { size: 12, family: 'Inter, sans-serif' },
                        padding: 12,
                        usePointStyle: true,
                        pointStyle: 'circle',
                    },
                },
                datalabels: {
                    display: true,
                    color: '#ffffff',
                    font: { size: 12, weight: 'bold', family: 'Inter, sans-serif' },
                    formatter: (value: number) => {
                        const pct = totalExpense > 0 ? ((value / totalExpense) * 100).toFixed(1) : '0';
                        return `${pct}%`;
                    },
                },
            },
            layout: { padding: 20 },
        },
    };
}

function buildIncomeExpenseBarConfig(
    transactions: UserTransaction[],
    _categories: UserCategory[],
    settings: UserSettingsBackend
): object {
    const monthKey = getCurrentMonthKey();
    const monthTx = transactions.filter((t) => t.monthKey === monthKey);

    const totalIncome = monthTx.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const totalExpense = monthTx.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const balance = totalIncome - totalExpense;

    return {
        type: 'bar',
        data: {
            labels: ['Receitas', 'Despesas', 'Saldo'],
            datasets: [{
                label: formatMonthLabel(monthKey),
                data: [totalIncome, totalExpense, balance],
                backgroundColor: [
                    COLORS.income,
                    COLORS.expense,
                    balance >= 0 ? COLORS.balanceLine : COLORS.expense,
                ],
                borderColor: [
                    COLORS.income,
                    COLORS.expense,
                    balance >= 0 ? COLORS.balanceLine : COLORS.expense,
                ],
                borderWidth: 1,
                borderRadius: 8,
                barPercentage: 0.6,
            }],
        },
        options: {
            plugins: {
                title: {
                    display: true,
                    text: `Receitas vs Despesas — ${formatMonthLabel(monthKey)}`,
                    font: { size: 18, family: 'Inter, sans-serif', weight: 'bold' },
                    color: COLORS.textPrimary,
                    padding: { bottom: 16 },
                },
                legend: { display: false },
                datalabels: {
                    display: true,
                    anchor: 'end',
                    align: 'top',
                    color: COLORS.textPrimary,
                    font: { size: 13, weight: 'bold', family: 'Inter, sans-serif' },
                    formatter: (value: number) => formatCurrency(value, settings.currency),
                },
            },
            scales: {
                x: {
                    ticks: { color: COLORS.textPrimary, font: { size: 13, family: 'Inter, sans-serif' } },
                    grid: { display: false },
                },
                y: {
                    ticks: {
                        color: COLORS.textSecondary,
                        font: { size: 11, family: 'Inter, sans-serif' },
                        callback: (value: number) => formatCurrency(value, settings.currency),
                    },
                    grid: { color: COLORS.gridLines },
                },
            },
            layout: { padding: 20 },
        },
    };
}

function buildBalanceLineConfig(
    transactions: UserTransaction[],
    _categories: UserCategory[],
    settings: UserSettingsBackend
): object {
    const monthKey = getCurrentMonthKey();
    const [yearStr, monthStr] = monthKey.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const totalDays = daysInMonth(year, month);

    const monthTx = transactions.filter((t) => t.monthKey === monthKey);

    // Group by day
    const dailyIncome = new Map<number, number>();
    const dailyExpense = new Map<number, number>();

    for (const tx of monthTx) {
        const day = Number(tx.date.split('-')[2]);
        if (tx.type === 'income') {
            dailyIncome.set(day, (dailyIncome.get(day) || 0) + tx.amount);
        } else {
            dailyExpense.set(day, (dailyExpense.get(day) || 0) + tx.amount);
        }
    }

    // Build cumulative balance per day
    const labels: string[] = [];
    const balanceData: number[] = [];
    let cumulative = 0;

    for (let d = 1; d <= totalDays; d++) {
        const inc = dailyIncome.get(d) || 0;
        const exp = dailyExpense.get(d) || 0;
        cumulative += inc - exp;
        labels.push(String(d));
        balanceData.push(Number(cumulative.toFixed(2)));
    }

    return {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Saldo acumulado',
                data: balanceData,
                borderColor: COLORS.balanceLine,
                backgroundColor: COLORS.balanceFill,
                fill: true,
                tension: 0.35,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: COLORS.balanceLine,
                borderWidth: 2.5,
            }],
        },
        options: {
            plugins: {
                title: {
                    display: true,
                    text: `Evolução do Saldo — ${formatMonthLabel(monthKey)}`,
                    font: { size: 18, family: 'Inter, sans-serif', weight: 'bold' },
                    color: COLORS.textPrimary,
                    padding: { bottom: 16 },
                },
                legend: { display: false },
                datalabels: { display: false },
            },
            scales: {
                x: {
                    ticks: {
                        color: COLORS.textSecondary,
                        font: { size: 10, family: 'Inter, sans-serif' },
                        maxTicksLimit: 15,
                    },
                    grid: { color: COLORS.gridLines },
                    title: {
                        display: true,
                        text: 'Dia do mês',
                        color: COLORS.textSecondary,
                        font: { size: 12, family: 'Inter, sans-serif' },
                    },
                },
                y: {
                    ticks: {
                        color: COLORS.textSecondary,
                        font: { size: 11, family: 'Inter, sans-serif' },
                        callback: (value: number) => formatCurrency(value, settings.currency),
                    },
                    grid: { color: COLORS.gridLines },
                },
            },
            layout: { padding: 20 },
        },
    };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const QUICKCHART_BASE = 'https://quickchart.io/chart';
const CHART_WIDTH = 800;
const CHART_HEIGHT = 500;

const CHART_BUILDERS: Record<
    ChartType,
    (transactions: UserTransaction[], categories: UserCategory[], settings: UserSettingsBackend) => object
> = {
    expense_pie: buildExpensePieConfig,
    income_expense_bar: buildIncomeExpenseBarConfig,
    balance_line: buildBalanceLineConfig,
};

/**
 * Generates a QuickChart.io URL for the requested chart type using the user's
 * financial data. Returns null if there are no transactions for the current month.
 */
export function generateChartUrl(
    chartType: ChartType,
    transactions: UserTransaction[],
    categories: UserCategory[],
    settings: UserSettingsBackend
): string | null {
    const monthKey = getCurrentMonthKey();
    const monthTx = transactions.filter((t) => t.monthKey === monthKey);

    if (monthTx.length === 0) {
        logger.info('No transactions for current month, skipping chart generation', { chartType, monthKey });
        return null;
    }

    const builder = CHART_BUILDERS[chartType];
    if (!builder) {
        logger.warn('Unknown chart type requested', { chartType });
        return null;
    }

    const config = builder(transactions, categories, settings);

    const params = new URLSearchParams({
        c: JSON.stringify(config),
        w: String(CHART_WIDTH),
        h: String(CHART_HEIGHT),
        bkg: COLORS.background,
        f: 'png',
    });

    const url = `${QUICKCHART_BASE}?${params.toString()}`;

    logger.info('Generated QuickChart URL', { chartType, monthKey, urlLength: url.length });
    return url;
}

/**
 * Generates a descriptive WhatsApp text caption/legend to accompany the chart image.
 * This provides the user with a readable summary of the data shown in the chart.
 */
export function generateChartCaption(
    chartType: ChartType,
    transactions: UserTransaction[],
    categories: UserCategory[],
    settings: UserSettingsBackend
): string {
    const monthKey = getCurrentMonthKey();
    const monthLabel = formatMonthLabel(monthKey);
    const monthTx = transactions.filter((t) => t.monthKey === monthKey);
    const currency = settings.currency;

    const totalIncome = monthTx.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const totalExpense = monthTx.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const balance = totalIncome - totalExpense;

    if (chartType === 'expense_pie') {
        const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
        const totals = new Map<string, number>();
        for (const tx of monthTx.filter((t) => t.type === 'expense')) {
            const name = categoryMap.get(tx.category) || 'Outros';
            totals.set(name, (totals.get(name) || 0) + tx.amount);
        }
        const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);

        const lines = [
            `📊 *Resumo de Despesas — ${monthLabel}*`,
            '',
            `💸 *Total de despesas:* ${formatCurrency(totalExpense, currency)}`,
            '',
            '*Detalhamento por categoria:*',
        ];

        for (const [name, amount] of sorted.slice(0, 10)) {
            const pct = totalExpense > 0 ? ((amount / totalExpense) * 100).toFixed(1) : '0';
            lines.push(`  • ${name}: ${formatCurrency(amount, currency)} (${pct}%)`);
        }

        if (sorted.length > 10) {
            const otherTotal = sorted.slice(10).reduce((s, [, v]) => s + v, 0);
            lines.push(`  • Outros: ${formatCurrency(otherTotal, currency)}`);
        }

        if (totalIncome > 0) {
            lines.push('', `📥 Receitas no mês: ${formatCurrency(totalIncome, currency)}`);
            lines.push(`💰 Saldo: ${formatCurrency(balance, currency)}`);
        }

        if (settings.budget > 0) {
            const budgetPct = ((totalExpense / settings.budget) * 100).toFixed(1);
            const remaining = settings.budget - totalExpense;
            lines.push('', `🎯 Orçamento: ${formatCurrency(settings.budget, currency)} (${budgetPct}% usado)`);
            lines.push(remaining >= 0
                ? `✅ Restam ${formatCurrency(remaining, currency)}`
                : `⚠️ Excedido em ${formatCurrency(Math.abs(remaining), currency)}`
            );
        }

        return lines.join('\n');
    }

    if (chartType === 'income_expense_bar') {
        const lines = [
            `📊 *Receitas vs Despesas — ${monthLabel}*`,
            '',
            `📥 *Receitas:* ${formatCurrency(totalIncome, currency)}`,
            `📤 *Despesas:* ${formatCurrency(totalExpense, currency)}`,
            `💰 *Saldo:* ${formatCurrency(balance, currency)}`,
        ];

        if (balance > 0) {
            lines.push('', `✅ Você está com saldo positivo de ${formatCurrency(balance, currency)} neste mês.`);
        } else if (balance < 0) {
            lines.push('', `⚠️ Atenção: suas despesas superaram as receitas em ${formatCurrency(Math.abs(balance), currency)}.`);
        } else {
            lines.push('', `ℹ️ Receitas e despesas estão equilibradas neste mês.`);
        }

        if (settings.budget > 0) {
            const budgetPct = ((totalExpense / settings.budget) * 100).toFixed(1);
            lines.push('', `🎯 Orçamento mensal: ${formatCurrency(settings.budget, currency)} (${budgetPct}% utilizado)`);
        }

        return lines.join('\n');
    }

    if (chartType === 'balance_line') {
        // Find the peak and lowest balance days
        const dailyBalance = new Map<number, number>();
        let cumulative = 0;
        let peakDay = 1, peakValue = 0;
        let lowDay = 1, lowValue = 0;

        for (let d = 1; d <= daysInMonth(Number(monthKey.split('-')[0]), Number(monthKey.split('-')[1])); d++) {
            const dayTx = monthTx.filter((t) => Number(t.date.split('-')[2]) === d);
            const dayIncome = dayTx.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
            const dayExpense = dayTx.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
            cumulative += dayIncome - dayExpense;
            dailyBalance.set(d, cumulative);

            if (cumulative >= peakValue) { peakValue = cumulative; peakDay = d; }
            if (cumulative <= lowValue) { lowValue = cumulative; lowDay = d; }
        }

        const lines = [
            `📈 *Evolução do Saldo — ${monthLabel}*`,
            '',
            `💰 *Saldo atual:* ${formatCurrency(cumulative, currency)}`,
            `📥 Receitas totais: ${formatCurrency(totalIncome, currency)}`,
            `📤 Despesas totais: ${formatCurrency(totalExpense, currency)}`,
            '',
            `📊 *Destaques:*`,
            `  • Maior saldo: dia ${peakDay} (${formatCurrency(peakValue, currency)})`,
            `  • Menor saldo: dia ${lowDay} (${formatCurrency(lowValue, currency)})`,
        ];

        return lines.join('\n');
    }

    return `📊 *Resumo Financeiro — ${monthLabel}*\n\nReceitas: ${formatCurrency(totalIncome, currency)}\nDespesas: ${formatCurrency(totalExpense, currency)}\nSaldo: ${formatCurrency(balance, currency)}`;
}

/**
 * Detect which chart type the user is asking for from natural language.
 * Used as a fallback when the AI returns an unrecognized chartType string.
 */
export function inferChartTypeFromText(text: string): ChartType {
    const normalized = text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

    if (/\b(pizza|torta|rosca|categorias?\b.*\b(?:gasto|despesa)|(?:gasto|despesa).*\bcategorias?\b)/i.test(normalized)) {
        return 'expense_pie';
    }

    if (/\b(barra|comparar|comparacao|receita.*despesa|despesa.*receita|versus|vs|resumo)\b/i.test(normalized)) {
        return 'income_expense_bar';
    }

    if (/\b(linha|evolucao|historico|diario|saldo.*dia|dia.*saldo)\b/i.test(normalized)) {
        return 'balance_line';
    }

    // Default to the most popular chart
    return 'expense_pie';
}
