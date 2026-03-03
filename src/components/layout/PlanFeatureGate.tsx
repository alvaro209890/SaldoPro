import { type ReactNode, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, CreditCard, Loader2, LockKeyhole } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getBillingStatus, type BillingStatusResponse } from '@/services/billing';
import { Button } from '@/components/ui/Button';

type BillingFeatureKey = keyof BillingStatusResponse['features'];
type AccessState = 'checking' | 'allowed' | 'blocked';

interface PlanFeatureGateProps {
    feature: BillingFeatureKey;
    title: string;
    description: string;
    children: ReactNode;
    redirectPath?: string;
}

const REDIRECT_DELAY_MS = 1800;

export function PlanFeatureGate({
    feature,
    title,
    description,
    children,
    redirectPath = '/app/plans',
}: PlanFeatureGateProps) {
    const { user } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [accessState, setAccessState] = useState<AccessState>('checking');
    const [blockMessage, setBlockMessage] = useState(description);

    useEffect(() => {
        let cancelled = false;

        if (!user) {
            setAccessState('checking');
            return undefined;
        }

        setAccessState('checking');
        setBlockMessage(description);

        void getBillingStatus()
            .then((billingStatus) => {
                if (cancelled) return;

                if (billingStatus.features[feature]) {
                    setAccessState('allowed');
                    return;
                }

                setAccessState('blocked');
            })
            .catch(() => {
                if (cancelled) return;

                setBlockMessage(
                    'Nao consegui validar seu plano agora. Para continuar, vamos abrir a tela de planos.'
                );
                setAccessState('blocked');
            });

        return () => {
            cancelled = true;
        };
    }, [description, feature, user]);

    useEffect(() => {
        if (accessState !== 'blocked') return undefined;

        const timer = window.setTimeout(() => {
            navigate(redirectPath, {
                replace: true,
                state: { redirectedFrom: location.pathname },
            });
        }, REDIRECT_DELAY_MS);

        return () => {
            window.clearTimeout(timer);
        };
    }, [accessState, location.pathname, navigate, redirectPath]);

    if (accessState === 'allowed') {
        return <>{children}</>;
    }

    const needsInlinePadding = location.pathname.startsWith('/app/ai');

    return (
        <div className={needsInlinePadding ? 'p-3 sm:p-6 lg:p-8' : ''}>
            <section className="flex min-h-[60vh] items-center justify-center">
                <div className="w-full max-w-3xl rounded-[2rem] border border-amber-400/20 bg-[linear-gradient(180deg,rgba(30,41,59,0.92),rgba(15,23,42,0.92))] p-6 shadow-2xl shadow-black/30 sm:p-8">
                    {accessState === 'checking' ? (
                        <div className="flex flex-col items-center gap-4 text-center">
                            <span className="inline-flex h-16 w-16 items-center justify-center rounded-3xl border border-white/10 bg-white/[0.04] text-amber-200">
                                <Loader2 className="h-8 w-8 animate-spin" />
                            </span>
                            <div className="space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
                                    Validando acesso
                                </p>
                                <h1 className="text-2xl font-semibold text-white">
                                    Conferindo seu plano antes de abrir esta aba
                                </h1>
                                <p className="text-sm leading-7 text-slate-300">
                                    Aguarde um instante enquanto verifico se este recurso esta liberado para a sua conta.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">
                                <LockKeyhole className="h-3.5 w-3.5" />
                                Acesso bloqueado
                            </div>

                            <div className="space-y-3">
                                <div className="inline-flex h-16 w-16 items-center justify-center rounded-3xl border border-amber-400/20 bg-amber-500/10 text-amber-200">
                                    <CreditCard className="h-8 w-8" />
                                </div>
                                <h1 className="text-2xl font-semibold text-white sm:text-3xl">
                                    {title}
                                </h1>
                                <p className="max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                                    {blockMessage}
                                </p>
                            </div>

                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                <Button
                                    onClick={() =>
                                        navigate(redirectPath, {
                                            replace: true,
                                            state: { redirectedFrom: location.pathname },
                                        })
                                    }
                                    className="h-11 rounded-xl px-5"
                                >
                                    Assinar plano agora
                                    <ArrowRight className="ml-2 h-4 w-4" />
                                </Button>
                                <p className="text-xs leading-6 text-slate-400 sm:text-sm">
                                    Esta aba vai te levar para a tela de planos automaticamente em alguns segundos.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}
