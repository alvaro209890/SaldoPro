import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Mail, Lock, ShieldCheck, Zap } from 'lucide-react';
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
        <div className="min-h-screen flex text-gray-100 bg-gray-950 relative overflow-hidden">
            {/* Background glowing orbs for mobile and desktop */}
            <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-emerald-500/20 rounded-full blur-[120px] pointer-events-none opacity-50 lg:opacity-100 lg:top-[-10%]" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-teal-600/10 rounded-full blur-[120px] pointer-events-none opacity-50 lg:opacity-100" />

            {/* Visual Identity Section - Left (Desktop only) */}
            <div className="hidden lg:flex w-1/2 flex-col justify-center relative p-16 z-10 border-r border-white/5 bg-gradient-to-br from-emerald-950/30 to-slate-950/80 backdrop-blur-sm">
                <div className="max-w-xl">
                    <div className="flex items-center gap-3 mb-10">
                        <BrandLogo className="h-12 w-12" />
                        <h1 className="text-3xl font-bold tracking-tight text-white">SaldoPro</h1>
                    </div>
                    
                    <h2 className="text-5xl font-extrabold mb-6 leading-[1.1] text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-200">
                        Assuma o controle do seu dinheiro.
                    </h2>
                    <p className="text-slate-400 text-lg leading-relaxed mb-10">
                        Nossa plataforma premium permite que você gerencie suas finanças com facilidade,
                        segurança e inteligência artificial direto no WhatsApp.
                    </p>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-md hover:bg-white/[0.05] transition flex items-start gap-4">
                            <div className="flex bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-500/20 text-emerald-400">
                                <ShieldCheck className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="font-bold text-white text-base">100% Controle</h3>
                                <p className="text-sm text-slate-400 mt-1">Dados criptografados e seguros.</p>
                            </div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-md hover:bg-white/[0.05] transition flex items-start gap-4">
                            <div className="flex bg-teal-500/10 p-2.5 rounded-xl border border-teal-500/20 text-teal-400">
                                <Zap className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="font-bold text-white text-base">0 Complicação</h3>
                                <p className="text-sm text-slate-400 mt-1">Interface feita para ser invisível.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Form Section - Right */}
            <div className="w-full lg:w-1/2 flex flex-col items-center justify-center p-6 sm:p-12 z-10">
                <div className="w-full max-w-[420px]">
                    
                    {/* Mobile Logo */}
                    <div className="lg:hidden flex flex-col items-center justify-center gap-3 mb-10">
                        <div className="p-3 bg-white/[0.03] rounded-2xl border border-white/10 shadow-xl">
                            <BrandLogo className="h-10 w-10" />
                        </div>
                        <h1 className="text-2xl font-bold tracking-tight text-white">SaldoPro</h1>
                    </div>

                    <div className="rounded-3xl sm:border border-white/10 sm:bg-white/[0.02] sm:backdrop-blur-2xl sm:p-8 sm:shadow-2xl shadow-black/50">
                        <div className="mb-8 text-center sm:text-left">
                            <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">Bem-vindo de volta</h2>
                            <p className="text-slate-400 text-sm">Entre na sua conta para continuar.</p>
                        </div>

                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
                                        className="text-[13px] font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
                                    >
                                        Esqueceu a senha?
                                    </Link>
                                </div>
                            </div>

                            <Button 
                                type="submit" 
                                className="w-full mt-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold h-12 rounded-xl shadow-lg shadow-emerald-500/20 border-0" 
                                size="lg" 
                                isLoading={isLoading}
                            >
                                Entrar na plataforma
                            </Button>
                        </form>

                        <div className="mt-8 pt-6 border-t border-white/5 text-center">
                            <p className="text-sm text-slate-400">
                                Não tem uma conta?{' '}
                                <Link
                                    to="/register"
                                    className="font-bold text-emerald-400 hover:text-emerald-300 transition-colors"
                                >
                                    Crie uma agora
                                </Link>
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
