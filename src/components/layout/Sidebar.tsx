import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { logoutUser } from '@/firebase/auth';
import { useSettings } from '@/hooks/useSettings';
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
    Bell,
    Repeat,
    Images,
    Target,
    PanelLeftClose,
    PanelLeftOpen,
    CheckCircle2,
    MessageSquare,
} from 'lucide-react';

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
    collapsed: boolean;
    onToggleCollapse: () => void;
}

const NAV_ITEMS = [
    { label: 'Dashboard', path: '/app/dashboard', icon: LayoutDashboard },
    { label: 'Transações', path: '/app/transactions', icon: ArrowRightLeft },
    { label: 'Lançamento IA', path: '/app/ai', icon: Sparkles },
    { label: 'Categorias', path: '/app/categories', icon: Tags },
    { label: 'Relatórios', path: '/app/reports', icon: PieChart },
    { label: 'Lembretes', path: '/app/reminders', icon: Bell },
    { label: 'Recorrentes', path: '/app/recurring', icon: Repeat },
    { label: 'Metas', path: '/app/goals', icon: Target },
    { label: 'Arquivos', path: '/app/documents', icon: Images },
    { label: 'Configurações', path: '/app/settings', icon: Settings },
];

export function Sidebar({ isOpen, onClose, collapsed, onToggleCollapse }: SidebarProps) {
    const navigate = useNavigate();
    const { displayName } = useAuth();
    const { settings } = useSettings();

    const hasWhatsApp = (settings?.whatsappAllowedNumbers?.length ?? 0) > 0;

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
                    className="fixed inset-0 z-40 bg-[#0B0E14]/85 backdrop-blur-md lg:hidden transition-opacity"
                    onClick={onClose}
                />
            )}

            {/* Sidebar */}
            <aside
                className={`fixed inset-y-0 left-0 z-50 flex flex-col glass-sidebar transition-all duration-300 ease-in-out lg:static lg:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'
                    } ${collapsed ? 'w-[72px]' : 'w-72'}`}
            >
                <div className={`flex h-16 items-center border-b border-surface-700/40 ${collapsed ? 'justify-center px-3' : 'justify-between px-6'}`}>
                    {!collapsed && (
                        <div className="flex items-center gap-2.5">
                            <div className="relative">
                                <Wallet className="h-6 w-6 text-finance-primary-light" />
                            </div>
                            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-finance-primary-light to-finance-primary">
                                SaldoPro
                            </span>
                        </div>
                    )}
                    {collapsed && (
                        <Wallet className="h-6 w-6 text-finance-primary-light" />
                    )}
                    <button
                        onClick={onClose}
                        className="lg:hidden rounded-lg p-1 text-gray-400 hover:bg-white/[0.06] hover:text-white"
                        aria-label="Fechar menu"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto py-5 px-3">
                    <nav className="space-y-0.5">
                        {NAV_ITEMS.map((item) => (
                            <NavLink
                                key={item.path}
                                to={item.path}
                                onClick={() => onClose()}
                                title={collapsed ? item.label : undefined}
                                className={({ isActive }) =>
                                    `group relative flex items-center rounded-xl text-sm font-medium transition-all duration-200 ${collapsed ? 'justify-center p-3' : 'gap-3 px-4 py-3'
                                    } ${isActive
                                        ? 'bg-finance-primary/10 text-finance-primary-light'
                                        : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-200'
                                    }`
                                }
                            >
                                {({ isActive }) => (
                                    <>
                                        {isActive && (
                                            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-finance-primary rounded-r-full" />
                                        )}
                                        <item.icon className="h-5 w-5 shrink-0" />
                                        {!collapsed && <span>{item.label}</span>}
                                    </>
                                )}
                            </NavLink>
                        ))}
                    </nav>
                </div>

                {/* WhatsApp Status Indicator */}
                {!collapsed && (
                    <div className={`mx-3 mb-3 rounded-xl px-4 py-3 flex items-center gap-3 text-sm border transition-all ${hasWhatsApp
                        ? 'bg-emerald-500/[0.06] border-emerald-500/10 text-emerald-400'
                        : 'bg-surface-800/40 border-surface-700/30 text-gray-500'
                        }`}>
                        {hasWhatsApp ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0" />
                        ) : (
                            <MessageSquare className="h-4 w-4 shrink-0" />
                        )}
                        <span className="font-medium truncate">
                            {hasWhatsApp ? 'WhatsApp conectado' : 'WhatsApp não configurado'}
                        </span>
                    </div>
                )}

                <div className="border-t border-surface-700/40 p-3">
                    {!collapsed && (
                        <div className="mb-3 px-3">
                            <p className="text-xs text-gray-600">Logado como</p>
                            <p className="truncate text-sm font-medium text-gray-300">
                                {displayName || 'Usuário'}
                            </p>
                        </div>
                    )}

                    <div className={`flex ${collapsed ? 'flex-col items-center gap-1' : 'items-center justify-between gap-2'}`}>
                        <button
                            onClick={handleLogout}
                            title={collapsed ? 'Sair' : undefined}
                            className={`flex items-center rounded-xl text-sm font-medium text-gray-400 transition-all hover:bg-finance-expense/10 hover:text-finance-expense ${collapsed ? 'p-3 justify-center' : 'gap-3 px-4 py-3 flex-1'
                                }`}
                        >
                            <LogOut className="h-5 w-5 shrink-0" />
                            {!collapsed && 'Sair'}
                        </button>

                        {/* Collapse toggle — desktop only */}
                        <button
                            onClick={onToggleCollapse}
                            className="hidden lg:flex items-center justify-center rounded-xl p-3 text-gray-500 hover:bg-white/[0.04] hover:text-gray-300 transition-all"
                            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
                        >
                            {collapsed ? (
                                <PanelLeftOpen className="h-4 w-4" />
                            ) : (
                                <PanelLeftClose className="h-4 w-4" />
                            )}
                        </button>
                    </div>
                </div>
            </aside>
        </>
    );
}
