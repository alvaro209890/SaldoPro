import { useState } from 'react';
import { useTransactions } from '@/hooks/useTransactions';
import { useCategories } from '@/hooks/useCategories';
import { parseTransactionWithAI } from '@/services/ai';
import { Button } from '@/components/ui/Button';
import { TransactionForm } from '@/components/TransactionForm';
import { Sparkles, Send, Bot } from 'lucide-react';
import { toast } from 'sonner';
import type { TransactionFormData } from '@/types';
import { generateMonthKey } from '@/utils/date';

export function AIAssistant() {
    const today = new Date();
    const currentMonthKey = generateMonthKey(today.toISOString());
    const { add } = useTransactions(currentMonthKey);
    const { categories, loading: catsLoading } = useCategories();

    const [message, setMessage] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);

    // Form state
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [parsedData, setParsedData] = useState<any>(null);

    const handleSend = async () => {
        if (!message.trim()) return;
        if (catsLoading) {
            toast.error('Aguarde as categorias carregarem...');
            return;
        }

        setIsProcessing(true);
        try {
            const aiResult = await parseTransactionWithAI(message, categories);

            // Map AI result to Form Data
            const formData = {
                type: aiResult.type || 'expense',
                amount: aiResult.amount || 0,
                description: aiResult.description || 'Transação via IA',
                category: aiResult.categoryId || '',
                date: aiResult.date || today.toISOString().split('T')[0],
                paymentMethod: 'pix', // Default or we could ask AI to guess
            };

            setParsedData(formData);
            setIsFormOpen(true);
            setMessage('');
            toast.success('Inteligência Artificial processou sua mensagem!');
        } catch (error: any) {
            toast.error(error.message || 'Erro ao processar mensagem com IA.');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleFormSubmit = async (data: TransactionFormData) => {
        await add(data);
    };

    return (
        <div className="space-y-6 max-w-3xl mx-auto animate-fade-in">
            <div className="flex items-center gap-3 mb-8">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                    <Sparkles className="w-6 h-6 text-white" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-white">Lançamento Turbo (IA)</h1>
                    <p className="text-sm text-gray-400 mt-1">
                        Escreva como você falaria. A inteligência artificial faz o resto.
                    </p>
                </div>
            </div>

            <div className="rounded-2xl border border-surface-700 bg-surface-900/50 glass-card overflow-hidden flex flex-col h-[400px]">
                <div className="flex-1 p-6 overflow-y-auto custom-scrollbar flex flex-col items-center justify-center text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-surface-800 flex items-center justify-center">
                        <Bot className="w-8 h-8 text-indigo-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-medium text-white">Como posso ajudar?</h3>
                        <p className="text-gray-400 max-w-sm mt-2">
                            Exemplos: <br />
                            "Comprei um lanche de 25 reais na padaria" <br />
                            "Recebi meu salário de 5000" <br />
                            "Gastei 150 de uber hoje"
                        </p>
                    </div>
                </div>

                <div className="p-4 border-t border-surface-700 bg-surface-800/30">
                    <div className="relative flex items-end gap-2">
                        <textarea
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={isProcessing}
                            placeholder="Digite sua transação aqui..."
                            className="w-full min-h-[60px] max-h-[120px] resize-none rounded-xl border border-surface-600 bg-surface-900/50 p-3 pr-12 text-sm text-gray-100 placeholder-gray-500 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 custom-scrollbar disabled:opacity-50"
                            rows={1}
                        />
                        <Button
                            onClick={handleSend}
                            isLoading={isProcessing}
                            className="absolute right-2 bottom-2 h-10 px-4 rounded-lg"
                        >
                            <Send className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            </div>

            <TransactionForm
                isOpen={isFormOpen}
                onClose={() => setIsFormOpen(false)}
                onSubmit={handleFormSubmit}
                categories={categories}
                initialData={parsedData} // Form needs a prop to accept parsed AI data
            />
        </div>
    );
}
