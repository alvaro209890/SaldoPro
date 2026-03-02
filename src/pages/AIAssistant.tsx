import { useState, useRef, useEffect } from 'react';
import { useTransactions } from '@/hooks/useTransactions';
import { useCategories } from '@/hooks/useCategories';
import { useChats } from '@/hooks/useChats';
import { useChatSessions } from '@/hooks/useChatSessions';
import { chatWithAI, type ChatMessage } from '@/services/ai';
import { Button } from '@/components/ui/Button';
import { Sparkles, Send, Bot, X, User, MessageSquarePlus, MessageSquare, Trash2, Menu } from 'lucide-react';
import { toast } from 'sonner';
import { getCurrentMonthKey } from '@/utils/date';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function AIAssistant() {
    const currentMonthKey = getCurrentMonthKey();
    const { transactions, loading: txLoading, add, update, remove } = useTransactions(currentMonthKey);
    const { categories, loading: catsLoading } = useCategories();

    // Sessions
    const { sessions, addSession, removeSession, editSession, loading: sessionsLoading } = useChatSessions();
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

    // Auto-select first session or wait for user to create one
    useEffect(() => {
        if (!sessionsLoading && sessions.length > 0 && !activeSessionId) {
            setActiveSessionId(sessions[0].id);
        }
    }, [sessions, sessionsLoading, activeSessionId]);

    // Active Chat
    const { messages: chatHistory, addMessage: saveChatMessage, loading: chatsLoading } = useChats(activeSessionId);

    const [input, setInput] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);

    // Image handling
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [showMobileSidebar, setShowMobileSidebar] = useState(false);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [chatHistory, isProcessing]);

    const handleCreateSession = async () => {
        try {
            const newId = await addSession('Nova Conversa');
            setActiveSessionId(newId);
        } catch (e) {
            // Error managed by hook toast
        }
    };

    const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!window.confirm('Tem certeza que deseja apagar essa conversa?')) return;

        try {
            await removeSession(id);
            if (activeSessionId === id) {
                setActiveSessionId(null);
            }
            toast.success('Conversa apagada.');
        } catch (e) {
            // Error managed by hook
        }
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setImagePreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleRemoveImage = () => {
        setImagePreview(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleSend = async () => {
        if (!input.trim() && !imagePreview) return;
        if (catsLoading || chatsLoading || txLoading || !activeSessionId) {
            toast.error(activeSessionId ? 'Aguarde o carregamento das suas transacoes e categorias...' : 'Crie uma nova conversa primeiro.');
            return;
        }

        const userText = input.trim();
        const base64Image = imagePreview;

        setInput('');
        handleRemoveImage();
        setIsProcessing(true);

        try {
            // Update session title if it's the very first message
            if (chatHistory.length === 0 && userText) {
                const newTitle = userText.length > 25 ? userText.substring(0, 25) + '...' : userText;
                await editSession(activeSessionId, newTitle);
            }

            const persistedUserContent = userText || (base64Image ? '[Imagem enviada para analise]' : '');

            // 1. Save user message to the backend history without persisting the image file
            await saveChatMessage({
                sessionId: activeSessionId,
                role: 'user',
                content: persistedUserContent
            });

            // 3. Prepare full dialog history for the prompt
            const mappedHistory: ChatMessage[] = chatHistory.map(msg => ({
                role: msg.role as 'user' | 'assistant' | 'system',
                content: msg.content,
                imageBase64: msg.imageUrl
            }));

            mappedHistory.push({
                role: 'user',
                content: persistedUserContent,
                imageBase64: base64Image ?? undefined
            });

            // Keep history limited to last 10 interactions mapped to limit payload size
            const recentHistory = mappedHistory.slice(-10);

            const aiResponse = await chatWithAI(recentHistory, categories, transactions);

            const actionsToApply = aiResponse.parsedActions?.length > 0
                ? aiResponse.parsedActions
                : [aiResponse.parsedAction];

            let addedCount = 0;
            let updatedCount = 0;
            let deletedCount = 0;

            for (const action of actionsToApply) {
                if (action.action === 'add_transaction') {
                    await add({
                        type: action.type,
                        amount: action.amount,
                        description: action.description,
                        category: action.categoryId,
                        date: action.date,
                        paymentMethod: action.paymentMethod
                    });
                    addedCount += 1;
                    continue;
                }

                if (action.action === 'update_transaction') {
                    await update(action.id, action.changes);
                    updatedCount += 1;
                    continue;
                }

                if (action.action === 'delete_transaction') {
                    await remove(action.id);
                    deletedCount += 1;
                }
            }

            if (addedCount > 0) {
                toast.success(addedCount === 1
                    ? 'Transacao adicionada pela IA!'
                    : `${addedCount} transacoes adicionadas pela IA!`);
            }
            if (updatedCount > 0) {
                toast.success(updatedCount === 1
                    ? 'Transacao atualizada pela IA!'
                    : `${updatedCount} transacoes atualizadas pela IA!`);
            }
            if (deletedCount > 0) {
                toast.success(deletedCount === 1
                    ? 'Transacao excluida pela IA!'
                    : `${deletedCount} transacoes excluidas pela IA!`);
            }

            // 3. Save assistant reply to the backend history
            await saveChatMessage({
                sessionId: activeSessionId,
                role: 'assistant',
                content: aiResponse.message
            });

        } catch (error: any) {
            toast.error(error.message || 'Erro ao processar mensagem com IA.');
            await saveChatMessage({
                sessionId: activeSessionId,
                role: 'assistant',
                content: 'Ops, tive um problema de conexão. Possíveis causas: limite excedido na Groq ou erro de rede. Tente novamente!'
            });
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

    // If chat is entirely empty (first time user), show a greeting manually as a visual stub
    const displayHistory = (chatHistory && chatHistory.length > 0)
        ? chatHistory
        : [{ id: 'intro', role: 'assistant' as const, content: 'Olá! Sou o SaldoPro AI. Posso te ajudar a analisar seus gastos, lançar novas despesas ou editar antigos lançamentos.\n\nDescreva seu lançamento em texto para eu adicionar automaticamente!' }];

    return (
        <div className="flex h-full w-full overflow-hidden bg-gray-950 text-gray-100 font-sans relative">

            {/* Sidebar with Sessions */}
            <div className={`w-full md:w-80 shrink-0 flex-col border-r border-surface-800 bg-surface-900/95 md:bg-surface-900/50 absolute inset-y-0 left-0 md:relative z-30 md:z-10 h-full backdrop-blur-xl md:backdrop-blur-none transition-transform duration-300 ${showMobileSidebar ? 'flex translate-x-0' : 'hidden md:flex md:translate-x-0'}`}>
                <div className="p-4 border-b border-surface-800 flex flex-col gap-4">

                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0">
                                <Sparkles className="w-5 h-5 text-indigo-400" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold text-white leading-tight">SaldoPro AI</h1>
                                <p className="text-xs text-green-400 font-medium flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> Online
                                </p>
                            </div>
                        </div>
                        <button onClick={() => setShowMobileSidebar(false)} className="md:hidden p-2 text-gray-400 hover:text-white transition-colors">
                            <X className="w-6 h-6" />
                        </button>
                    </div>
                </div>

                <div className="px-4 pt-4 pb-2">

                    <Button
                        onClick={() => {
                            handleCreateSession();
                            setShowMobileSidebar(false);
                        }}
                        className="w-full justify-start gap-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 rounded-xl h-11 transition-all"
                    >
                        <MessageSquarePlus className="w-4 h-4" />
                        Nova Conversa
                    </Button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-0.5 px-3 pb-4">
                    {sessionsLoading ? (
                        <div className="text-center py-4 text-gray-500 text-sm">Carregando conversas...</div>
                    ) : sessions.length === 0 ? (
                        <div className="text-center py-6 text-gray-500 text-sm">Nenhuma conversa encontrada.</div>
                    ) : (
                        sessions.map(session => (
                            <div
                                key={session.id}
                                onClick={() => {
                                    setActiveSessionId(session.id);
                                    setShowMobileSidebar(false);
                                }}
                                className={`group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all duration-200 ${activeSessionId === session.id
                                    ? 'bg-indigo-500/10 text-indigo-400 relative'
                                    : 'bg-transparent text-gray-400 hover:bg-surface-800/50 hover:text-gray-200'
                                    }`}
                            >
                                {activeSessionId === session.id && (
                                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-indigo-500 rounded-r-full" />
                                )}
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <MessageSquare className={`w-4 h-4 shrink-0 transition-colors ${activeSessionId === session.id ? 'text-indigo-400' : 'text-surface-500 group-hover:text-surface-400'}`} />
                                    <span className="text-sm truncate font-medium">{session.title}</span>
                                </div>
                                <button
                                    onClick={(e) => handleDeleteSession(e, session.id)}
                                    className="opacity-100 md:opacity-0 group-hover:opacity-100 p-1.5 text-gray-500 hover:text-red-400 hover:bg-surface-700 rounded-lg transition-all shrink-0"
                                    title="Apagar conversa"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Main Chat Area */}
            <div className="flex-1 bg-surface-950 flex flex-col overflow-hidden relative w-full">

                {/* Mobile Header Toggle */}
                <div className="md:hidden p-4 border-b border-surface-800 bg-surface-900/50 flex flex-row items-center gap-3 z-10 relative">
                    <button onClick={() => setShowMobileSidebar(true)} className="p-2 -ml-2 text-gray-400 hover:text-white rounded-lg transition-colors">
                        <Menu className="w-6 h-6" />
                    </button>
                    <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-indigo-400" />
                        <span className="font-semibold text-white">SaldoPro AI</span>
                    </div>
                </div>

                {/* Decorative background gradients */}
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-500/5 rounded-full blur-[120px] pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-indigo-500/5 rounded-full blur-[150px] pointer-events-none" />

                {!activeSessionId ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 relative z-10 animate-in fade-in duration-500">
                        <div className="relative mb-8">
                            <div className="absolute inset-0 bg-indigo-500/20 blur-2xl rounded-full animate-pulse" />
                            <div className="w-24 h-24 rounded-[2rem] bg-surface-800/60 border border-surface-700/50 backdrop-blur-xl flex items-center justify-center shadow-2xl relative z-10 transform transition-transform hover:scale-105 duration-300">
                                <Sparkles className="w-12 h-12 text-indigo-400" />
                            </div>
                        </div>
                        <h2 className="text-3xl font-bold text-white mb-3">Como posso ajudar?</h2>
                        <p className="text-gray-400 max-w-md text-sm leading-relaxed mb-8">Selecione uma conversa ao lado ou crie uma nova para começar a interagir com seu assistente financeiro inteligente.</p>
                        <Button onClick={handleCreateSession} className="gap-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl px-8 py-6 shadow-lg border-none transition-all font-medium text-base">
                            <MessageSquarePlus className="w-5 h-5" /> Iniciar Nova Conversa
                        </Button>
                    </div>
                ) : (
                    <>
                        {/* Chat History View */}
                        <div className="flex-1 overflow-y-auto px-4 sm:px-6 md:px-12 py-8 custom-scrollbar space-y-8 relative z-10">
                            {displayHistory.map((msg, idx) => {
                                const isUser = msg.role === 'user';
                                return (
                                    <div key={idx} className={`flex gap-4 animate-in slide-in-from-bottom-4 duration-500 fade-in ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 border shadow-sm
                                            ${isUser ? 'bg-surface-800 border-surface-700 text-gray-400' : 'bg-indigo-900/40 border-indigo-500/30 text-indigo-400 backdrop-blur-sm'}`}>
                                            {isUser ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                                        </div>
                                        <div className={`space-y-2 ${isUser ? 'max-w-[85%] items-end flex flex-col' : 'w-full max-w-[95%] items-start flex flex-col'}`}>
                                            {('imageUrl' in msg && msg.imageUrl) && (
                                                <div className="p-1 rounded-2xl bg-surface-800/80 backdrop-blur-md border border-surface-700 w-fit shrink-0 overflow-hidden shadow-md">
                                                    <a href={msg.imageUrl} target="_blank" rel="noopener noreferrer">
                                                        <img src={msg.imageUrl} alt="Anexo" className="max-h-[240px] w-auto rounded-xl object-contain cursor-pointer hover:opacity-90 transition-opacity" />
                                                    </a>
                                                </div>
                                            )}
                                            <div className={`px-5 py-4 text-[15px] whitespace-pre-wrap leading-relaxed shadow-sm w-full
                                                ${isUser
                                                    ? 'bg-indigo-600 text-white rounded-2xl rounded-br-sm max-w-full'
                                                    : 'bg-surface-900 border border-surface-800 text-gray-200 rounded-2xl rounded-tl-sm prose prose-invert prose-p:leading-relaxed prose-pre:bg-surface-950 prose-pre:border prose-pre:border-surface-800 hover:prose-a:text-indigo-400'}`}>
                                                {isUser ? (
                                                    msg.content
                                                ) : (
                                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                        {msg.content}
                                                    </ReactMarkdown>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}

                            {isProcessing && (
                                <div className="flex gap-4">
                                    <div className="w-10 h-10 rounded-full bg-surface-800/80 border border-surface-700/50 text-indigo-400 flex items-center justify-center shrink-0 shadow-sm backdrop-blur-sm">
                                        <Bot className="w-6 h-6" />
                                    </div>
                                    <div className="bg-surface-800/80 border border-surface-700/50 rounded-3xl rounded-tl-md px-5 py-4 flex items-center gap-1.5 w-fit h-[52px] shadow-md backdrop-blur-sm">
                                        <div className="w-2 h-2 rounded-full bg-indigo-400/80 animate-pulse" />
                                        <div className="w-2 h-2 rounded-full bg-indigo-400/80 animate-pulse" style={{ animationDelay: '0.15s' }} />
                                        <div className="w-2 h-2 rounded-full bg-indigo-400/80 animate-pulse" style={{ animationDelay: '0.3s' }} />
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input Area */}
                        <div className="p-4 sm:px-6 md:px-12 pb-6 shrink-0 relative z-20 bg-gradient-to-t from-surface-950 via-surface-950/90 to-transparent pt-12">
                            <div className="max-w-4xl mx-auto relative group">
                                <div className="relative flex items-end bg-surface-900 border border-surface-800 rounded-xl shadow-lg focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/50 transition-all pl-2">
                                    <div className="relative flex-1 py-[14px]">
                                        <textarea
                                            value={input}
                                            onChange={(e) => setInput(e.target.value)}
                                            onKeyDown={handleKeyDown}
                                            disabled={isProcessing}
                                            placeholder="Descreva seu lançamento..."
                                            className="w-full h-6 max-h-[120px] resize-none bg-transparent text-[15px] text-gray-100 placeholder-gray-500 focus:outline-none custom-scrollbar disabled:opacity-50 !p-0 leading-[24px]"
                                            rows={1}
                                            style={{ minHeight: '24px' }}
                                        />
                                    </div>

                                    <div className="px-2 py-2 flex items-end">
                                        <button
                                            onClick={handleSend}
                                            disabled={(!input.trim() && !imagePreview) || isProcessing}
                                            className={`h-9 w-9 flex items-center justify-center rounded-lg transition-all
                                                ${(input.trim() || imagePreview) && !isProcessing
                                                    ? 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm'
                                                    : 'bg-surface-800 text-gray-500 cursor-not-allowed'}`}
                                        >
                                            {!isProcessing ? (
                                                <Send className="w-[18px] h-[18px] ml-0.5" />
                                            ) : (
                                                <Bot className="w-[18px] h-[18px] animate-pulse" />
                                            )}
                                        </button>
                                    </div>
                                </div>

                                <div className="text-center mt-3 text-xs text-surface-500">
                                    O SaldoPro AI pode cometer erros de interpretação. Verifique os lançamentos.
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
