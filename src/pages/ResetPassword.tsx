import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Mail, ArrowLeft, CheckCircle2, Lock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
    confirmUserPasswordReset,
    resetPassword,
    validatePasswordResetCode,
} from '@/supabase/auth';
import { toast } from 'sonner';

const requestSchema = z.object({
    email: z.string().email('Email inválido'),
});

const updateSchema = z.object({
    password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
    confirmPassword: z.string().min(6, 'Confirme sua nova senha'),
}).refine((data) => data.password === data.confirmPassword, {
    message: 'As senhas não coincidem',
    path: ['confirmPassword'],
});

type RequestFormData = z.infer<typeof requestSchema>;
type UpdateFormData = z.infer<typeof updateSchema>;

export function ResetPassword() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [isRequestLoading, setIsRequestLoading] = useState(false);
    const [isRequestSuccess, setIsRequestSuccess] = useState(false);
    const [isValidatingCode, setIsValidatingCode] = useState(false);
    const [isResetLoading, setIsResetLoading] = useState(false);
    const [isResetSuccess, setIsResetSuccess] = useState(false);
    const [resetEmail, setResetEmail] = useState('');
    const [codeError, setCodeError] = useState('');

    const mode = (searchParams.get('mode') ?? '').trim();
    const oobCode = (searchParams.get('oobCode') ?? '').trim();
    const isResetMode = mode === 'resetPassword' && oobCode.length > 0;

    const {
        register,
        handleSubmit: handleRequestSubmit,
        formState: { errors },
    } = useForm<RequestFormData>({
        resolver: zodResolver(requestSchema),
    });

    const {
        register: registerReset,
        handleSubmit: handlePasswordSubmit,
        formState: { errors: resetErrors },
    } = useForm<UpdateFormData>({
        resolver: zodResolver(updateSchema),
    });

    useEffect(() => {
        if (!isResetMode) {
            setCodeError('');
            setResetEmail('');
            return;
        }

        let cancelled = false;
        setIsValidatingCode(true);
        setCodeError('');

        void validatePasswordResetCode(oobCode)
            .then((email) => {
                if (cancelled) return;
                setResetEmail(email);
            })
            .catch((error: any) => {
                if (cancelled) return;
                setCodeError(
                    error?.code === 'auth/expired-action-code'
                        ? 'Este link expirou. Solicite um novo email de recuperação.'
                        : 'Este link de recuperação é inválido ou já foi usado.'
                );
            })
            .finally(() => {
                if (!cancelled) {
                    setIsValidatingCode(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [isResetMode, oobCode]);

    const onRequestSubmit = async (data: RequestFormData) => {
        setIsRequestLoading(true);
        try {
            await resetPassword(data.email);
            setIsRequestSuccess(true);
            toast.success('Email de recuperação enviado!');
        } catch (error: any) {
            toast.error(
                error.code === 'auth/unauthorized-continue-uri'
                    ? 'A URL de recuperação não está autorizada no Firebase.'
                    : error.code === 'auth/invalid-continue-uri'
                        ? 'A URL configurada para recuperação é inválida.'
                        : error.code === 'auth/user-not-found'
                            ? 'Nenhuma conta encontrada com este email'
                            : 'Erro ao enviar email de recuperação'
            );
        } finally {
            setIsRequestLoading(false);
        }
    };

    const onPasswordResetSubmit = async (data: UpdateFormData) => {
        setIsResetLoading(true);
        try {
            await confirmUserPasswordReset(oobCode, data.password);
            setIsResetSuccess(true);
            toast.success('Senha redefinida com sucesso!');
        } catch (error: any) {
            toast.error(
                error.code === 'auth/expired-action-code'
                    ? 'Este link expirou. Solicite um novo email.'
                    : error.code === 'auth/weak-password'
                        ? 'A nova senha é muito fraca.'
                        : 'Erro ao redefinir a senha'
            );
        } finally {
            setIsResetLoading(false);
        }
    };

    const renderResetContent = () => {
        if (isValidatingCode) {
            return (
                <div className="text-center animate-scale-in">
                    <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-indigo-500/10">
                        <Lock className="h-8 w-8 text-indigo-400" />
                    </div>
                    <h3 className="mb-2 text-xl font-semibold text-white">Validando link</h3>
                    <p className="text-gray-400">
                        Estamos verificando seu link de recuperação.
                    </p>
                </div>
            );
        }

        if (codeError) {
            return (
                <div className="text-center animate-scale-in">
                    <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
                        <AlertCircle className="h-8 w-8 text-red-400" />
                    </div>
                    <h3 className="mb-2 text-xl font-semibold text-white">Link inválido</h3>
                    <p className="mb-6 text-gray-400">{codeError}</p>
                    <Button
                        variant="secondary"
                        className="w-full"
                        onClick={() => navigate('/reset-password')}
                    >
                        Solicitar novo email
                    </Button>
                </div>
            );
        }

        if (isResetSuccess) {
            return (
                <div className="text-center animate-scale-in">
                    <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
                        <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                    </div>
                    <h3 className="mb-2 text-xl font-semibold text-white">Senha atualizada</h3>
                    <p className="mb-6 text-gray-400">
                        Sua senha foi redefinida. Agora você já pode entrar com a nova senha.
                    </p>
                    <Button
                        className="w-full"
                        onClick={() => navigate('/login')}
                    >
                        Ir para o login
                    </Button>
                </div>
            );
        }

        return (
            <form onSubmit={handlePasswordSubmit(onPasswordResetSubmit)} className="space-y-6">
                <div className="rounded-xl border border-white/8 bg-white/5 px-4 py-3 text-sm text-gray-300">
                    Redefinindo senha para <span className="font-semibold text-white">{resetEmail}</span>
                </div>

                <Input
                    label="Nova senha"
                    type="password"
                    icon={Lock}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    error={resetErrors.password?.message}
                    {...registerReset('password')}
                />

                <Input
                    label="Confirmar nova senha"
                    type="password"
                    icon={Lock}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    error={resetErrors.confirmPassword?.message}
                    {...registerReset('confirmPassword')}
                />

                <Button type="submit" className="w-full" size="lg" isLoading={isResetLoading}>
                    Salvar nova senha
                </Button>
            </form>
        );
    };

    const renderRequestContent = () => {
        if (isRequestSuccess) {
            return (
                <div className="text-center animate-scale-in">
                    <div className="mx-auto w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mb-6">
                        <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                    </div>
                    <h3 className="text-xl font-semibold text-white mb-2">Email enviado</h3>
                    <p className="text-gray-400 mb-6">
                        Verifique sua caixa de entrada e siga as instruções para criar uma nova senha.
                    </p>
                    <Button
                        variant="secondary"
                        className="w-full"
                        onClick={() => setIsRequestSuccess(false)}
                    >
                        Tentar outro email
                    </Button>
                </div>
            );
        }

        return (
            <form onSubmit={handleRequestSubmit(onRequestSubmit)} className="space-y-6">
                <Input
                    label="Email"
                    icon={Mail}
                    placeholder="seu@email.com"
                    autoComplete="email"
                    error={errors.email?.message}
                    {...register('email')}
                />

                <Button type="submit" className="w-full" size="lg" isLoading={isRequestLoading}>
                    Enviar instruções
                </Button>
            </form>
        );
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-gray-950 relative overflow-hidden text-gray-100">
            <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[100px]" />
            <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-emerald-500/10 rounded-full blur-[100px]" />

            <div className="w-full max-w-md relative z-10">
                <div className="mb-8">
                    <Link
                        to="/login"
                        className="inline-flex items-center gap-2 text-sm font-medium text-gray-400 hover:text-white transition-colors mb-6"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Voltar para o login
                    </Link>
                    <h1 className="text-3xl font-bold text-white mb-2">
                        {isResetMode ? 'Definir nova senha' : 'Recuperar senha'}
                    </h1>
                    <p className="text-gray-400">
                        {isResetMode
                            ? 'Digite sua nova senha para concluir a recuperação da conta.'
                            : 'Digite seu email e enviaremos instruções para redefinir sua senha.'}
                    </p>
                </div>

                <div className="glass-card p-8 rounded-2xl border-surface-700 shadow-xl">
                    {isResetMode ? renderResetContent() : renderRequestContent()}
                </div>
            </div>
        </div>
    );
}
