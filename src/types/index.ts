export type PaymentMethod = 'pix' | 'credit' | 'debit' | 'cash' | 'transfer' | 'boleto';

export interface UserProfile {
    uid: string;
    email: string;
    displayName: string;
    createdAt: string;
}

export interface ChatSession {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
}

export interface StoredChatMessage {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    imageUrl?: string;
    createdAt: string;
}

export interface UserDocumentAsset {
    id: string;
    title: string;
    description: string | null;
    tags: string[];
    previewUrl: string;
    mimeType: string;
    sizeBytes: number;
    source: string;
    createdAt: string;
    updatedAt: string;
    lastAccessedAt: string | null;
}

export interface UserDocumentInput {
    title: string;
    description: string;
    tags: string[];
    fileDataUrl: string;
}

export interface UserDocumentUpdateInput {
    title: string;
    description: string;
    tags: string[];
}

export interface Transaction {
    id: string;
    type: 'income' | 'expense';
    amount: number;
    date: string; // YYYY-MM-DD
    monthKey: string; // YYYY-MM
    category: string;
    description: string;
    paymentMethod: PaymentMethod;
    createdAt: string;
    updatedAt: string;
}

export interface Category {
    id: string;
    name: string;
    type: 'income' | 'expense';
    color: string; // hex
    icon: string; // lucide icon name
    createdAt: string;
}

export interface UserSettings {
    budget: number;
    startDay: number; // 1-31
    currency: string;
    whatsappAllowedNumbers?: string[];
    updatedAt: string;
}

export interface TransactionFormData {
    type: 'income' | 'expense';
    amount: number;
    date: string;
    category: string;
    description: string;
    paymentMethod: PaymentMethod;
}

export interface CategoryFormData {
    name: string;
    type: 'income' | 'expense';
    color: string;
    icon: string;
}

export interface TransactionFilters {
    search: string;
    type: 'all' | 'income' | 'expense';
    category: string;
    paymentMethod: string;
    dateFrom: string;
    dateTo: string;
    amountMin: string;
    amountMax: string;
    sortBy: 'date' | 'amount' | 'description';
    sortOrder: 'asc' | 'desc';
}

export interface Reminder {
    id: string;
    reminderKind: 'general' | 'payable' | 'receivable';
    title: string;
    amount: number | null;
    dueDate: string; // YYYY-MM-DD
    dueTime?: string | null;
    type?: 'payable' | 'receivable' | null;
    status: 'pending' | 'paid';
    createdAt: string;
    updatedAt: string;
}

export interface ReminderFormData {
    reminderKind: 'general' | 'payable' | 'receivable';
    title: string;
    amount: number | null;
    dueDate: string;
    dueTime: string | null;
    type: 'payable' | 'receivable' | null;
    status: 'pending' | 'paid';
}

export type RecurringFrequency = 'weekly' | 'monthly' | 'yearly';

export interface RecurringTransaction {
    id: string;
    type: 'income' | 'expense';
    amount: number;
    category: string;
    description: string;
    paymentMethod: PaymentMethod;
    frequency: RecurringFrequency;
    startDate: string;       // YYYY-MM-DD
    endDate: string | null;  // YYYY-MM-DD or null for indefinite
    nextDueDate: string;     // YYYY-MM-DD
    active: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface RecurringTransactionFormData {
    type: 'income' | 'expense';
    amount: number;
    category: string;
    description: string;
    paymentMethod: PaymentMethod;
    frequency: RecurringFrequency;
    startDate: string;
    endDate: string;
}

export interface FinancialProfile {
    monthlyIncome: number;
    fixedExpenses: number;
    variableExpenses: number;
    savingsTargetPct: number;
    financialGoalsText: string | null;
    completedAt: string;
    createdAt: string;
    updatedAt: string;
}

export interface FinancialProfileFormData {
    monthlyIncome: number;
    fixedExpenses: number;
    variableExpenses: number;
    savingsTargetPct: number;
    financialGoalsText: string;
}

export interface Goal {
    id: string;
    title: string;
    description: string | null;
    targetAmount: number | null;
    currentAmount: number;
    deadline: string | null;
    source: 'ai' | 'manual';
    status: 'active' | 'completed' | 'cancelled';
    priority: 'low' | 'medium' | 'high';
    createdAt: string;
    updatedAt: string;
}

export interface GoalFormData {
    title: string;
    description: string;
    targetAmount: number | null;
    currentAmount?: number;
    deadline: string;
    priority: 'low' | 'medium' | 'high';
    status?: 'active' | 'completed' | 'cancelled';
}
