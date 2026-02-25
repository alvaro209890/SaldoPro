import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';

export function AppLayout() {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const location = useLocation();
    const isFullScreenApp = location.pathname.startsWith('/app/ai');

    return (
        <div className="flex h-screen overflow-hidden bg-gray-950">
            <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

            <main className="flex-1 relative flex flex-col min-w-0 overflow-hidden">
                {/* Mobile Header */}
                <header className="lg:hidden flex h-16 items-center justify-between border-b border-surface-800 bg-surface-950/80 backdrop-blur px-4">
                    <div className="font-bold text-indigo-400">SaldoPro</div>
                    <button
                        onClick={() => setIsSidebarOpen(true)}
                        className="rounded-lg p-2 text-gray-400 hover:bg-surface-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        <Menu className="h-6 w-6" />
                    </button>
                </header>

                <div className={`flex-1 overflow-auto bg-gray-950 ${isFullScreenApp ? '' : 'p-4 sm:p-6 lg:p-8'}`}>
                    <div className={isFullScreenApp ? 'h-full w-full' : 'container mx-auto max-w-7xl'}>
                        <Outlet />
                    </div>
                </div>
            </main>
        </div>
    );
}
