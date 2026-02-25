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
    whatsappAccessCode?: string;
    whatsappAccessCodeNormalized?: string;
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
