import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { resetPassword } from '@/firebase/auth';
import { toast } from 'sonner';

const schema = z.object({
    email: z.string().email('Email inválido'),
});

type FormData = z.infer<typeof schema>;

export function ResetPassword() {
    const [isLoading, setIsLoading] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);

    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm<FormData>({
        resolver: zodResolver(schema),
    });

    const onSubmit = async (data: FormData) => {
        setIsLoading(true);
        try {
            await resetPassword(data.email);
            setIsSuccess(true);
            toast.success('Email de recuperação enviado!');
        } catch (error: any) {
            toast.error(
                error.code === 'auth/user-not-found'
                    ? 'Nenhuma conta encontrada com este email'
                    : 'Erro ao enviar email de recuperação'
            );
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-gray-950 relative overflow-hidden text-gray-100">
            {/* Background blobs */}
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
                    <h1 className="text-3xl font-bold text-white mb-2">Recuperar senha</h1>
                    <p className="text-gray-400">
                        Digite seu email e enviaremos instruções para redefinir sua senha.
                    </p>
                </div>

                <div className="glass-card p-8 rounded-2xl border-surface-700 shadow-xl">
                    {isSuccess ? (
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
                                onClick={() => setIsSuccess(false)}
                            >
                                Tentar outro email
                            </Button>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                            <Input
                                label="Email"
                                icon={Mail}
                                placeholder="seu@email.com"
                                autoComplete="email"
                                error={errors.email?.message}
                                {...register('email')}
                            />

                            <Button type="submit" className="w-full" size="lg" isLoading={isLoading}>
                                Enviar instruções
                            </Button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
