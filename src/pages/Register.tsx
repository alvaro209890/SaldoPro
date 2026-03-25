import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Mail, Lock, User, Phone, CheckCircle2, Shield, Zap } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { registerUser } from '@/supabase/auth';
import { toast } from 'sonner';
import { BrandLogo } from '@/components/branding/BrandLogo';

function normalizeSignupPhone(value: string): string {
    const digits = value.replace(/\D/g, '');
    if (digits.startsWith('55') && digits.length > 11) {
        return digits.slice(2);
    }
    return digits;
}

function formatSignupPhone(value: string): string {
    const digits = normalizeSignupPhone(value).slice(0, 11);
    if (digits.length <= 2) {
        return digits;
    }

    const ddd = digits.slice(0, 2);
    const local = digits.slice(2);

    if (local.length <= 4) {
        return `(${ddd}) ${local}`;
    }

    if (local.length <= 8) {
        return `(${ddd}) ${local.slice(0, 4)}-${local.slice(4)}`;
    }

    return `(${ddd}) ${local.slice(0, 5)}-${local.slice(5)}`;
}

const schema = z
    .object({
        displayName: z.string().min(2, 'No mínimo 2 caracteres'),
        whatsappPhone: z
            .string()
            .min(1, 'Número obrigatório')
            .refine(
                (val) => {
                    const digits = normalizeSignupPhone(val);
                    return digits.length >= 10 && digits.length <= 11;
                },
                'Formato inválido (DDD+Num)'
            ),
        email: z.string().email('Email inválido'),
        password: z.string().min(6, 'No mínimo 6 caracteres'),
        confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
        message: 'As senhas não coincidem',
        path: ['confirmPassword'],
    });

type FormData = z.infer<typeof schema>;

export function Register() {
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    const {
        control,
        register,
        handleSubmit,
        formState: { errors },
    } = useForm<FormData>({
        resolver: zodResolver(schema),
    });

    const onSubmit = async (data: FormData) => {
        setIsLoading(true);
        try {
            const normalizedLocalPhone = normalizeSignupPhone(data.whatsappPhone);
            const normalizedPhone = `55${normalizedLocalPhone}`;
            await registerUser(data.email, data.password, data.displayName, normalizedPhone);
            toast.success('Conta criada com sucesso!');
            navigate('/app/dashboard');
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : 'Erro ao criar conta');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex text-gray-100 bg-gray-950 relative overflow-hidden">
            {/* Background glowing orbs */}
            <div className="absolute top-1/4 left-[-10%] w-[500px] h-[500px] bg-emerald-500/20 rounded-full blur-[120px] pointer-events-none opacity-50 lg:opacity-100" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-teal-600/10 rounded-full blur-[120px] pointer-events-none opacity-50 lg:opacity-100" />

            {/* Form Section - Left on desktop, centered on mobile */}
            <div className="w-full lg:w-1/2 flex flex-col items-center justify-center p-6 sm:p-12 z-10 lg:order-1 order-2">
                <div className="w-full max-w-[460px]">
                    
                    {/* Mobile Logo */}
                    <div className="lg:hidden flex flex-col items-center justify-center gap-3 mb-8">
                        <div className="p-3 bg-white/[0.03] rounded-2xl border border-white/10 shadow-xl">
                            <BrandLogo className="h-10 w-10" />
                        </div>
                        <h1 className="text-2xl font-bold tracking-tight text-white">SaldoPro</h1>
                    </div>

                    <div className="rounded-[24px] sm:border border-white/10 sm:bg-white/[0.02] sm:backdrop-blur-2xl sm:p-10 sm:shadow-2xl shadow-black/50">
                        <div className="mb-8 text-center sm:text-left">
                            <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">Criar conta grátis</h2>
                            <p className="text-slate-400 text-[13px]">Demora menos de 1 minuto para começar.</p>
                        </div>

                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                            
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <Input
                                    label="Nome"
                                    icon={User}
                                    placeholder="Seu nome"
                                    autoComplete="name"
                                    error={errors.displayName?.message}
                                    {...register('displayName')}
                                />

                                <Controller
                                    name="whatsappPhone"
                                    control={control}
                                    render={({ field }) => (
                                        <Input
                                            label="WhatsApp"
                                            icon={Phone}
                                            placeholder="(11) 99999-9999"
                                            autoComplete="tel"
                                            inputMode="numeric"
                                            maxLength={15}
                                            error={errors.whatsappPhone?.message}
                                            {...field}
                                            value={field.value ?? ''}
                                            onChange={(event) => {
                                                field.onChange(formatSignupPhone(event.target.value));
                                            }}
                                        />
                                    )}
                                />
                            </div>

                            <Input
                                label="E-mail"
                                icon={Mail}
                                placeholder="seu@email.com"
                                autoComplete="email"
                                error={errors.email?.message}
                                {...register('email')}
                            />

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <Input
                                    label="Senha de acesso"
                                    type="password"
                                    icon={Lock}
                                    placeholder="••••••••"
                                    autoComplete="new-password"
                                    error={errors.password?.message}
                                    {...register('password')}
                                />

                                <Input
                                    label="Confirmar senha"
                                    type="password"
                                    icon={Lock}
                                    placeholder="••••••••"
                                    autoComplete="new-password"
                                    error={errors.confirmPassword?.message}
                                    {...register('confirmPassword')}
                                />
                            </div>

                            <Button 
                                type="submit" 
                                className="w-full mt-4 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold h-12 rounded-xl shadow-lg shadow-emerald-500/20 border-0" 
                                size="lg" 
                                isLoading={isLoading}
                            >
                                Criar conta grátis
                            </Button>
                        </form>

                        <div className="mt-8 pt-6 border-t border-white/5 text-center">
                            <p className="text-[13px] text-slate-400">
                                Já tem uma conta?{' '}
                                <Link
                                    to="/login"
                                    className="font-bold text-emerald-400 hover:text-emerald-300 transition-colors ml-1"
                                >
                                    Acessar agora
                                </Link>
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Visual Identity Section - Right (Desktop only) */}
            <div className="hidden lg:flex w-1/2 flex-col justify-center relative p-16 z-10 border-l border-white/5 bg-gradient-to-bl from-emerald-950/30 to-slate-950/80 backdrop-blur-sm lg:order-2 order-1">
                <div className="max-w-xl mx-auto w-full">
                    <div className="flex items-center gap-3 mb-12 justify-end">
                        <h1 className="text-3xl font-bold tracking-tight text-white">SaldoPro</h1>
                        <BrandLogo className="h-12 w-12" />
                    </div>
                    
                    <h2 className="text-[3.25rem] font-extrabold mb-6 leading-[1.05] text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-200 text-right">
                        O setup mais rápido do mercado.
                    </h2>
                    <p className="text-slate-400 text-lg leading-relaxed mb-12 text-right">
                        Não perca tempo configurando planilhas complexas. Categorias essenciais já prontas para você usar assim que entrar.
                    </p>

                    <div className="grid grid-cols-1 gap-4 text-left ml-auto max-w-sm">
                        
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md hover:bg-white/[0.05] transition flex items-center gap-4">
                            <div className="flex bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-500/20 text-emerald-400">
                                <Zap className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="font-bold text-white text-[14px]">I.A. no WhatsApp</h3>
                                <p className="text-[12px] text-slate-400 mt-0.5">Lançamentos via áudio ou texto.</p>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md hover:bg-white/[0.05] transition flex items-center gap-4">
                            <div className="flex bg-teal-500/10 p-2.5 rounded-xl border border-teal-500/20 text-teal-400">
                                <CheckCircle2 className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="font-bold text-white text-[14px]">Configuração Expressa</h3>
                                <p className="text-[12px] text-slate-400 mt-0.5">Sua conta pronta em menos de 1 min.</p>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md hover:bg-white/[0.05] transition flex items-center gap-4">
                            <div className="flex bg-indigo-500/10 p-2.5 rounded-xl border border-indigo-500/20 text-indigo-400">
                                <Shield className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="font-bold text-white text-[14px]">Criptografia Nativa</h3>
                                <p className="text-[12px] text-slate-400 mt-0.5">Proteção rígida de ponta a ponta.</p>
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}
