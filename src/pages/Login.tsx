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
    rememberMe: z.boolean().optional(),
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
        defaultValues: { rememberMe: true }
    });

    const onSubmit = async (data: FormData) => {
        setIsLoading(true);
        try {
            await loginUser(data.email, data.password);
            // Handling rememberMe strategy would go here if not default in Firebase
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
            {/* Background glowing orbs */}
            <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-emerald-500/20 rounded-full blur-[120px] pointer-events-none opacity-50 lg:opacity-100 lg:top-[-10%]" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-teal-600/10 rounded-full blur-[120px] pointer-events-none opacity-50 lg:opacity-100" />

            {/* Visual Identity Section - Left (Desktop only) */}
            <div className="hidden lg:flex w-1/2 flex-col justify-center relative p-16 z-10 border-r border-white/5 bg-gradient-to-br from-emerald-950/30 to-slate-950/80 backdrop-blur-sm">
                <div className="max-w-xl mx-auto w-full">
                    <div className="flex items-center gap-3 mb-12">
                        <BrandLogo className="h-12 w-12" />
                        <h1 className="text-3xl font-bold tracking-tight text-white">SaldoPro</h1>
                    </div>
                    
                    <h2 className="text-[3.25rem] font-extrabold mb-6 leading-[1.05] text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-200">
                        A plataforma definitiva para seu patrimônio.
                    </h2>
                    <p className="text-slate-400 text-lg leading-relaxed mb-12">
                        Mais de 2.000 usuários confiam no SaldoPro para gerenciar suas finanças com segurança bancária e tecnologia inteligente.
                    </p>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-md hover:bg-white/[0.05] transition flex flex-col gap-3">
                            <div className="flex bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-500/20 text-emerald-400 w-fit">
                                <ShieldCheck className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="font-bold text-white text-[15px]">Criptografia Nativa</h3>
                                <p className="text-xs text-slate-400 mt-1 leading-relaxed">Seus dados blindados de ponta a ponta na nuvem.</p>
                            </div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-md hover:bg-white/[0.05] transition flex flex-col gap-3">
                            <div className="flex bg-teal-500/10 p-2.5 rounded-xl border border-teal-500/20 text-teal-400 w-fit">
                                <Zap className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="font-bold text-white text-[15px]">Zero Fricção</h3>
                                <p className="text-xs text-slate-400 mt-1 leading-relaxed">Inteligência Artificial que trabalha por você no WhatsApp.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Form Section - Right */}
            <div className="w-full lg:w-1/2 flex flex-col items-center justify-center p-6 sm:p-12 z-10">
                <div className="w-full max-w-[400px]">
                    
                    {/* Mobile Logo */}
                    <div className="lg:hidden flex flex-col items-center justify-center gap-3 mb-10">
                        <div className="p-3 bg-white/[0.03] rounded-2xl border border-white/10 shadow-xl">
                            <BrandLogo className="h-10 w-10" />
                        </div>
                        <h1 className="text-2xl font-bold tracking-tight text-white">SaldoPro</h1>
                    </div>

                    <div className="rounded-[24px] sm:border border-white/10 sm:bg-white/[0.02] sm:backdrop-blur-2xl sm:p-10 sm:shadow-2xl shadow-black/50">
                        <div className="mb-8 text-center sm:text-left">
                            <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">Bem-vindo de volta</h2>
                            <p className="text-slate-400 text-[13px]">Acesse sua conta para continuar.</p>
                        </div>

                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                            <Input
                                label="E-mail"
                                icon={Mail}
                                placeholder="seu@email.com"
                                autoComplete="email"
                                error={errors.email?.message}
                                {...register('email')}
                            />

                            <div>
                                <div className="flex justify-between items-center mb-1.5">
                                    <label htmlFor="password-input" className="block text-[13px] font-medium text-slate-300">
                                        Senha de acesso
                                    </label>
                                    <Link
                                        to="/reset-password"
                                        className="text-[12px] font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
                                    >
                                        Esqueceu a senha?
                                    </Link>
                                </div>
                                <Input
                                    id="password-input"
                                    type="password"
                                    icon={Lock}
                                    placeholder="••••••••"
                                    autoComplete="current-password"
                                    error={errors.password?.message}
                                    {...register('password')}
                                />
                            </div>

                            {/* Lembrar-me Checkbox */}
                            <div className="flex items-center gap-2 mb-2">
                                <input 
                                    type="checkbox" 
                                    id="rememberMe" 
                                    className="w-4 h-4 rounded border-white/20 bg-white/[0.04] text-emerald-500 focus:ring-emerald-500/20 focus:ring-offset-0 focus:ring-2 cursor-pointer transition-colors"
                                    {...register('rememberMe')}
                                />
                                <label htmlFor="rememberMe" className="text-[13px] text-slate-400 cursor-pointer select-none hover:text-slate-300 transition-colors">
                                    Lembrar meu acesso por 30 dias
                                </label>
                            </div>

                            <Button 
                                type="submit" 
                                className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold h-12 rounded-xl shadow-lg shadow-emerald-500/20 border-0 mt-2" 
                                size="lg" 
                                isLoading={isLoading}
                            >
                                Acessar minha conta
                            </Button>
                        </form>

                        <div className="mt-8 pt-6 border-t border-white/5 text-center">
                            <p className="text-[13px] text-slate-400">
                                Novo no SaldoPro?{' '}
                                <Link
                                    to="/register"
                                    className="font-bold text-emerald-400 hover:text-emerald-300 transition-colors ml-1"
                                >
                                    Criar conta grátis
                                </Link>
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
