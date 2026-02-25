import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Wallet, Mail, Lock, User } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { registerUser } from '@/firebase/auth';
import { toast } from 'sonner';

const schema = z
    .object({
        displayName: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres'),
        email: z.string().email('Email inválido'),
        password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
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
        register,
        handleSubmit,
        formState: { errors },
    } = useForm<FormData>({
        resolver: zodResolver(schema),
    });

    const onSubmit = async (data: FormData) => {
        setIsLoading(true);
        try {
            await registerUser(data.email, data.password, data.displayName);
            toast.success('Conta criada com sucesso!');
            navigate('/app/dashboard');
        } catch (error: any) {
            toast.error(
                error.code === 'auth/email-already-in-use'
                    ? 'Este email já está em uso'
                    : 'Erro ao criar conta'
            );
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex text-gray-100 bg-gray-950">
            {/* Form Section - First on mobile, left on wide screens */}
            <div className="w-full lg:w-1/2 flex items-center justify-center p-8 z-10">
                <div className="w-full max-w-sm">
                    <div className="lg:hidden flex items-center gap-2 mb-8 justify-center">
                        <Wallet className="w-6 h-6 text-emerald-500" />
                        <h1 className="text-2xl font-bold text-white">SaldoPro</h1>
                    </div>

                    <div className="mb-8">
                        <h2 className="text-2xl font-semibold text-white mb-2">Criar conta</h2>
                        <p className="text-gray-400">Junte-se a nós e comece a controlar seu dinheiro.</p>
                    </div>

                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                        <Input
                            label="Nome completo"
                            icon={User}
                            placeholder="Seu nome"
                            autoComplete="name"
                            error={errors.displayName?.message}
                            {...register('displayName')}
                        />

                        <Input
                            label="Email"
                            icon={Mail}
                            placeholder="seu@email.com"
                            autoComplete="email"
                            error={errors.email?.message}
                            {...register('email')}
                        />

                        <Input
                            label="Senha"
                            type="password"
                            icon={Lock}
                            placeholder="••••••••"
                            autoComplete="new-password"
                            error={errors.password?.message}
                            {...register('password')}
                        />

                        <Input
                            label="Confirmar Senha"
                            type="password"
                            icon={Lock}
                            placeholder="••••••••"
                            autoComplete="new-password"
                            error={errors.confirmPassword?.message}
                            {...register('confirmPassword')}
                        />

                        <Button type="submit" className="w-full mt-6" size="lg" isLoading={isLoading}>
                            Criar conta
                        </Button>
                    </form>

                    <p className="mt-8 text-center text-sm text-gray-400">
                        Já tem uma conta?{' '}
                        <Link
                            to="/login"
                            className="font-medium text-emerald-400 hover:text-emerald-300 transition-colors inline-block pb-1 border-b border-transparent hover:border-emerald-400"
                        >
                            Fazer login
                        </Link>
                    </p>
                </div>
            </div>

            {/* Visual Identity Section */}
            <div className="hidden lg:flex w-1/2 bg-surface-900 flex-col items-center justify-center relative overflow-hidden border-l border-surface-800">
                <div className="absolute top-1/4 left-[-20%] w-[500px] h-[500px] bg-emerald-500/20 rounded-full blur-[120px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-indigo-500/20 rounded-full blur-[100px]" />

                <div className="max-w-md relative z-10 text-center">
                    <div className="flex items-center justify-center gap-3 mb-8">
                        <div className="bg-emerald-500 p-3 rounded-xl shadow-lg shadow-emerald-500/20">
                            <Wallet className="w-8 h-8 text-white" />
                        </div>
                    </div>
                    <h2 className="text-4xl font-bold tracking-tight text-white mb-6">
                        O primeiro passo para sua liberdade financeira
                    </h2>
                    <p className="text-gray-400 text-lg leading-relaxed mb-12">
                        Configure seu perfil em menos de um minuto. Suas categorias essenciais já vêm configuradas e prontas para o uso.
                    </p>

                    <div className="grid grid-cols-2 gap-4 text-left">
                        <div className="bg-surface-800/50 backdrop-blur border border-surface-700 p-4 rounded-xl">
                            <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
                                <div className="w-3 h-3 rounded-full bg-emerald-500" />
                            </div>
                            <h3 className="font-medium text-white mb-1">Configuração Expressa</h3>
                            <p className="text-xs text-gray-400">Pronto para usar desde o primeiro clique</p>
                        </div>
                        <div className="bg-surface-800/50 backdrop-blur border border-surface-700 p-4 rounded-xl">
                            <div className="w-8 h-8 rounded-full bg-indigo-500/10 flex items-center justify-center mb-3">
                                <div className="w-3 h-3 rounded-full bg-indigo-500" />
                            </div>
                            <h3 className="font-medium text-white mb-1">Dados Seguros</h3>
                            <p className="text-xs text-gray-400">Criptografia de ponta a ponta garantida</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
