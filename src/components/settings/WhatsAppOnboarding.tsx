import { MessageSquare, Smartphone, Send, Check, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useNavigate } from 'react-router-dom';

interface WhatsAppOnboardingProps {
    className?: string;
}

const STEPS = [
    {
        icon: Smartphone,
        title: 'Configure seu número',
        description: 'Adicione seu número de WhatsApp na seção abaixo com o código do país (ex: 5511...)',
    },
    {
        icon: Send,
        title: 'Envie uma mensagem',
        description: 'Mande um texto, áudio ou foto para o número do SaldoPro',
    },
    {
        icon: Check,
        title: 'Pronto!',
        description: 'A IA irá processar e registrar suas transações automaticamente',
    },
];

export function WhatsAppOnboarding({ className = '' }: WhatsAppOnboardingProps) {
    const navigate = useNavigate();

    return (
        <div className={`relative overflow-hidden rounded-2xl border border-emerald-500/10 bg-gradient-to-br from-emerald-500/[0.04] to-transparent p-6 sm:p-8 ${className}`}>
            {/* Decorative glow */}
            <div className="absolute -top-20 -right-20 w-40 h-40 bg-emerald-500/10 rounded-full blur-[60px] pointer-events-none" />

            <div className="relative z-10">
                <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                        <MessageSquare className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-white">Conecte seu WhatsApp</h3>
                        <p className="text-xs text-gray-500">Registre transações por texto, áudio ou imagem</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                    {STEPS.map((step, i) => (
                        <div key={i} className="flex items-start gap-3 p-4 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0 text-emerald-400 text-sm font-bold">
                                {i + 1}
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-gray-200">{step.title}</p>
                                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{step.description}</p>
                            </div>
                        </div>
                    ))}
                </div>

                <Button
                    onClick={() => navigate('/app/settings')}
                    variant="secondary"
                    size="sm"
                    className="gap-2 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10"
                >
                    Configurar agora
                    <ArrowRight className="w-3.5 h-3.5" />
                </Button>
            </div>
        </div>
    );
}
