import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Mail, Lock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { loginUser } from '@/firebase/auth';
import { toast } from 'sonner';
import { BrandLogo } from '@/components/branding/BrandLogo';

const schema = z.object({
    email: z.string().email('Email inválido'),
    password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
});

type FormData = z.infer<typeof schema>;

export function Login() {
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
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
            await loginUser(data.email, data.password);
            navigate('/app/dashboard');
        } catch (error: any) {
            toast.error(
                error.code === 'auth/invalid-credential'
                    ? 'Email ou senha incorretos'
                    : 'Erro ao fazer login'
            );
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex text-gray-100 bg-gray-950">
            {/* Visual Identity Section */}
            <div className="hidden lg:flex w-1/2 bg-surface-900 border-r border-surface-800 p-12 items-center relative overflow-hidden">
                <div className="absolute top-[-10%] right-[-10%] w-96 h-96 bg-indigo-500/20 rounded-full blur-[100px]" />
                <div className="absolute bottom-[-10%] left-[-10%] w-96 h-96 bg-emerald-500/20 rounded-full blur-[100px]" />

                <div className="max-w-md relative z-10">
                    <div className="flex items-center gap-3 mb-8">
                        <BrandLogo className="h-14 w-14" />
                        <h1 className="text-4xl font-bold tracking-tight text-white">SaldoPro</h1>
                    </div>
                    <h2 className="text-3xl font-semibold mb-6">Assuma o controle do seu dinheiro.</h2>
                    <p className="text-gray-400 text-lg leading-relaxed">
                        Nossa plataforma premium permite que você gerencie suas finanças com facilidade,
                        segurança e elegância em qualquer dispositivo.
                    </p>
                    <div className="mt-12 flex gap-4">
                        <div className="glass-card p-4 rounded-xl flex-1 border-indigo-500/20">
                            <div className="text-2xl font-bold text-indigo-400 mb-1">100%</div>
                            <div className="text-sm text-gray-400">Controle</div>
                        </div>
                        <div className="glass-card p-4 rounded-xl flex-1 border-emerald-500/20">
                            <div className="text-2xl font-bold text-emerald-400 mb-1">0</div>
                            <div className="text-sm text-gray-400">Complicação</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Form Section */}
            <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
                <div className="w-full max-w-sm">
                    <div className="lg:hidden flex items-center gap-2 mb-8 justify-center">
                        <BrandLogo className="h-8 w-8" />
                        <h1 className="text-2xl font-bold text-white">SaldoPro</h1>
                    </div>

                    <div className="mb-8">
                        <h2 className="text-2xl font-semibold text-white mb-2">Bem-vindo de volta</h2>
                        <p className="text-gray-400">Entre na sua conta para continuar.</p>
                    </div>

                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                        <Input
                            label="Email"
                            icon={Mail}
                            placeholder="seu@email.com"
                            autoComplete="email"
                            error={errors.email?.message}
                            {...register('email')}
                        />

                        <div>
                            <Input
                                label="Senha"
                                type="password"
                                icon={Lock}
                                placeholder="••••••••"
                                autoComplete="current-password"
                                error={errors.password?.message}
                                {...register('password')}
                            />
                            <div className="mt-2 text-right">
                                <Link
                                    to="/reset-password"
                                    className="text-sm font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
                                >
                                    Esqueceu a senha?
                                </Link>
                            </div>
                        </div>

                        <Button type="submit" className="w-full" size="lg" isLoading={isLoading}>
                            Entrar
                        </Button>
                    </form>

                    <p className="mt-8 text-center text-sm text-gray-400">
                        Não tem uma conta?{' '}
                        <Link
                            to="/register"
                            className="font-medium text-indigo-400 hover:text-indigo-300 transition-colors inline-block pb-1 border-b border-transparent hover:border-indigo-400"
                        >
                            Crie uma agora
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
