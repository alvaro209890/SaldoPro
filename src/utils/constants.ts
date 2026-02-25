import type { CategoryFormData } from '@/types';
import * as Icons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const DEFAULT_EXPENSE_CATEGORIES: CategoryFormData[] = [
    { name: 'Alimentação', type: 'expense', color: '#f97316', icon: 'UtensilsCrossed' },
    { name: 'Combustível', type: 'expense', color: '#eab308', icon: 'Fuel' },
    { name: 'Moradia', type: 'expense', color: '#8b5cf6', icon: 'Home' },
    { name: 'Internet', type: 'expense', color: '#06b6d4', icon: 'Wifi' },
    { name: 'Lazer', type: 'expense', color: '#ec4899', icon: 'Gamepad2' },
    { name: 'Saúde', type: 'expense', color: '#10b981', icon: 'Heart' },
    { name: 'Transporte', type: 'expense', color: '#3b82f6', icon: 'Car' },
    { name: 'Educação', type: 'expense', color: '#a855f7', icon: 'GraduationCap' },
    { name: 'Outros', type: 'expense', color: '#6b7280', icon: 'MoreHorizontal' },
];

export const DEFAULT_INCOME_CATEGORIES: CategoryFormData[] = [
    { name: 'Salário', type: 'income', color: '#10b981', icon: 'Briefcase' },
    { name: 'Freela', type: 'income', color: '#06b6d4', icon: 'Laptop' },
    { name: 'Vendas', type: 'income', color: '#f97316', icon: 'ShoppingBag' },
    { name: 'Investimentos', type: 'income', color: '#8b5cf6', icon: 'TrendingUp' },
    { name: 'Outros', type: 'income', color: '#6b7280', icon: 'MoreHorizontal' },
];

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
    pix: 'PIX',
    credit: 'Crédito',
    debit: 'Débito',
    cash: 'Dinheiro',
    transfer: 'Transferência',
    boleto: 'Boleto',
};

export const CHART_COLORS = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
    '#f97316', '#eab308', '#10b981', '#06b6d4',
    '#3b82f6', '#a855f7', '#14b8a6', '#f59e0b',
];

export const CATEGORY_COLORS = [
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#10b981', '#06b6d4', '#3b82f6', '#6366f1',
    '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e',
    '#14b8a6', '#f59e0b', '#84cc16', '#6b7280',
];

export const ICON_MAP: Record<string, LucideIcon> = {
    UtensilsCrossed: Icons.UtensilsCrossed,
    Fuel: Icons.Fuel,
    Home: Icons.Home,
    Wifi: Icons.Wifi,
    Gamepad2: Icons.Gamepad2,
    Heart: Icons.Heart,
    Car: Icons.Car,
    GraduationCap: Icons.GraduationCap,
    MoreHorizontal: Icons.MoreHorizontal,
    Briefcase: Icons.Briefcase,
    Laptop: Icons.Laptop,
    ShoppingBag: Icons.ShoppingBag,
    TrendingUp: Icons.TrendingUp,
    Shirt: Icons.Shirt,
    Music: Icons.Music,
    Plane: Icons.Plane,
    Phone: Icons.Phone,
    Zap: Icons.Zap,
    Gift: Icons.Gift,
    Coffee: Icons.Coffee,
    Dumbbell: Icons.Dumbbell,
    BookOpen: Icons.BookOpen,
    ShoppingCart: Icons.ShoppingCart,
    CreditCard: Icons.CreditCard,
    Building: Icons.Building,
    Wrench: Icons.Wrench,
    Dog: Icons.Dog,
    Baby: Icons.Baby,
    Scissors: Icons.Scissors,
    Tv: Icons.Tv,
};

export type IconName = keyof typeof ICON_MAP;
