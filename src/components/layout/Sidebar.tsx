import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { logoutUser } from '@/firebase/auth';
import {
    LayoutDashboard,
    ArrowRightLeft,
    Tags,
    PieChart,
    Settings,
    LogOut,
    X,
    Wallet,
    Sparkles,
} from 'lucide-react';

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
}

const NAV_ITEMS = [
    { label: 'Dashboard', path: '/app/dashboard', icon: LayoutDashboard },
    { label: 'Transações', path: '/app/transactions', icon: ArrowRightLeft },
    { label: 'Lançamento IA', path: '/app/ai', icon: Sparkles },
    { label: 'Categorias', path: '/app/categories', icon: Tags },
    { label: 'Relatórios', path: '/app/reports', icon: PieChart },
    { label: 'Configurações', path: '/app/settings', icon: Settings },
];

export function Sidebar({ isOpen, onClose }: SidebarProps) {
    const navigate = useNavigate();
    const { displayName } = useAuth();

    const handleLogout = async () => {
        try {
            await logoutUser();
            navigate('/login');
        } catch (error) {
            console.error(error);
        }
    };

    return (
        <>
            {/* Mobile backdrop */}
            {isOpen && (
                <div
                    className="fixed inset-0 z-40 bg-gray-950/80 backdrop-blur-sm lg:hidden transition-opacity"
                    onClick={onClose}
                />
            )}

            {/* Sidebar sidebar */}
            <aside
                className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-surface-800 bg-surface-950 transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'
                    }`}
            >
                <div className="flex h-16 items-center justify-between px-6 border-b border-surface-800">
                    <div className="flex items-center gap-2 text-indigo-400">
                        <Wallet className="h-6 w-6" />
                        <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-indigo-600">
                            SaldoPro
                        </span>
                    </div>
                    <button
                        onClick={onClose}
                        className="lg:hidden rounded-lg p-1 text-gray-400 hover:bg-surface-800 hover:text-white"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto py-6 px-4">
                    <nav className="space-y-1">
                        {NAV_ITEMS.map((item) => (
                            <NavLink
                                key={item.path}
                                to={item.path}
                                onClick={() => onClose()}
                                className={({ isActive }) =>
                                    `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all ${isActive
                                        ? 'bg-indigo-500/10 text-indigo-400'
                                        : 'text-gray-400 hover:bg-surface-800 hover:text-white'
                                    }`
                                }
                            >
                                <item.icon className="h-5 w-5" />
                                {item.label}
                            </NavLink>
                        ))}
                    </nav>
                </div>

                <div className="border-t border-surface-800 p-4">
                    <div className="mb-4 px-4">
                        <p className="text-xs text-gray-500">Logado como</p>
                        <p className="truncate text-sm font-medium text-gray-300">
                            {displayName || 'Usuário'}
                        </p>
                    </div>
                    <button
                        onClick={handleLogout}
                        className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-gray-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
                    >
                        <LogOut className="h-5 w-5" />
                        Sair
                    </button>
                </div>
            </aside>
        </>
    );
}
