import { useEffect } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };

        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
            document.body.style.overflow = 'hidden';
        }

        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = 'unset';
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const sizes = {
        sm: 'max-w-md',
        md: 'max-w-lg',
        lg: 'max-w-2xl',
        xl: 'max-w-4xl',
    };

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
            <div
                className="fixed inset-0 bg-[#0B0E14]/85 backdrop-blur-md transition-opacity animate-fade-in"
                onClick={onClose}
            />
            <div
                className={`relative flex max-h-[calc(100dvh-0.75rem)] w-full flex-col glass-modal rounded-t-3xl border-t border-x-0 border-b-0 border-surface-700/50 shadow-2xl shadow-black/40 sm:max-h-[calc(100vh-3rem)] sm:rounded-2xl sm:border sm:border-surface-700/40 ${sizes[size]} animate-slide-up sm:animate-scale-in`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-surface-700/40 px-4 py-4 sm:px-6">
                    <h2 className="text-base font-semibold text-white sm:text-lg">{title}</h2>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-white/[0.06] hover:text-white transition-all hover:ring-1 hover:ring-white/10"
                        aria-label="Fechar"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <div className="max-h-[calc(100dvh-8.5rem)] overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:max-h-[calc(100vh-10rem)] sm:p-6">
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );
}
