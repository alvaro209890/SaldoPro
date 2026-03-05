import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';

export function AppLayout() {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const location = useLocation();
    const isFullScreenApp = location.pathname.startsWith('/app/ai');

    return (
        <div className="flex h-screen overflow-hidden bg-[#0B0E14]">
            <Sidebar
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                collapsed={isSidebarCollapsed}
                onToggleCollapse={() => setIsSidebarCollapsed(prev => !prev)}
            />

            <main className="flex-1 relative flex flex-col min-w-0 overflow-hidden">
                {/* Mobile Header */}
                <header className="lg:hidden flex h-16 items-center justify-between border-b border-surface-700/40 bg-[#0B0E14]/80 backdrop-blur-md px-4">
                    <div className="font-bold text-finance-primary-light flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-finance-primary animate-pulse" />
                        SaldoPro
                    </div>
                    <button
                        onClick={() => setIsSidebarOpen(true)}
                        className="rounded-lg p-2 text-gray-400 hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-finance-primary"
                        aria-label="Abrir menu"
                    >
                        <Menu className="h-6 w-6" />
                    </button>
                </header>

                <div className={`flex-1 overflow-auto bg-[#0B0E14] ${isFullScreenApp ? '' : 'p-3 sm:p-6 lg:p-8'}`}>
                    <div className={isFullScreenApp ? 'h-full w-full' : 'container mx-auto max-w-7xl'}>
                        <Outlet />
                    </div>
                </div>
            </main>
        </div>
    );
}
