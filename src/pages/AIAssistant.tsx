import { useState, useRef, useEffect, useCallback } from 'react';
import { useChats } from '@/hooks/useChats';
import { useChatSessions } from '@/hooks/useChatSessions';
import { chatWithAI, type ChatMessage } from '@/services/ai';
import { Button } from '@/components/ui/Button';
import { Sparkles, Send, Bot, X, User, MessageSquarePlus, MessageSquare, Trash2, Menu } from 'lucide-react';
import { toast } from 'sonner';
import { triggerDataRefresh } from '@/firebase/firestore';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function formatAssistantMarkdown(content: string): string {
    return content
        .replace(/\r\n/g, '\n')
        .trim()
        .replace(/\*([^\n*]+)\*/g, '**$1**')
        .replace(/_([^\n_]+)_/g, '*$1*')
        .replace(/\n/g, '  \n');
}

export function AIAssistant() {
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
    const { messages: chatHistory, addMessage: saveChatMessage } = useChats(activeSessionId);

    const [input, setInput] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);

    // Optimistic local messages (shown instantly, before Firebase sync)
    const [optimisticMessages, setOptimisticMessages] = useState<Array<{ id: string; role: 'user' | 'assistant'; content: string }>>([]);

    // Typewriter state for AI response
    const [streamingText, setStreamingText] = useState('');
    const [fullAIResponse, setFullAIResponse] = useState('');
    const [isTyping, setIsTyping] = useState(false);

    // Image handling
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [showMobileSidebar, setShowMobileSidebar] = useState(false);

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [chatHistory, isProcessing, optimisticMessages, streamingText, scrollToBottom]);

    // Clear optimistic messages when Firebase snapshot arrives with matching content
    useEffect(() => {
        if (chatHistory.length > 0 && optimisticMessages.length > 0) {
            // Firebase snapshot has caught up — remove optimistic messages that now exist in chatHistory
            setOptimisticMessages(prev => {
                const lastFirebaseContent = chatHistory[chatHistory.length - 1]?.content;
                const lastOptimisticContent = prev[prev.length - 1]?.content;
                if (lastFirebaseContent === lastOptimisticContent || chatHistory.length >= prev.length) {
                    return [];
                }
                return prev;
            });
        }
    }, [chatHistory, optimisticMessages.length]);

    // Typewriter effect: progressively reveal AI response
    useEffect(() => {
        if (!fullAIResponse || !isTyping) return;

        let charIndex = 0;
        setStreamingText('');

        const interval = setInterval(() => {
            charIndex++;
            const nextChunk = fullAIResponse.slice(0, charIndex);
            setStreamingText(nextChunk);

            if (charIndex >= fullAIResponse.length) {
                clearInterval(interval);
                setIsTyping(false);
                setStreamingText('');
                setFullAIResponse('');
            }
        }, 12); // ~12ms per char ≈ ~83 chars/sec = very fast but visible

        return () => clearInterval(interval);
    }, [fullAIResponse, isTyping]);

    const handleCreateSession = () => {
        // Instantly create a temp session and switch to it — Firebase runs in background
        const tempId = `temp-${Date.now()}`;
        setActiveSessionId(tempId);
        setOptimisticMessages([]);

        addSession('Nova Conversa').then((realId) => {
            // Swap temp → real ID seamlessly
            setActiveSessionId((current) => current === tempId ? realId : current);
        }).catch(() => {
            // Revert on failure
            setActiveSessionId(null);
        });
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
        if (!activeSessionId) {
            toast.error('Crie uma nova conversa primeiro.');
            return;
        }

        const userText = input.trim();
        const base64Image = imagePreview;
        const persistedUserContent = userText || (base64Image ? '[Imagem enviada para analise]' : '');

        // ── INSTANT: show user message optimistically ──
        setInput('');
        handleRemoveImage();
        setOptimisticMessages(prev => [...prev, { id: `opt-${Date.now()}`, role: 'user', content: persistedUserContent }]);
        setIsProcessing(true);

        try {
            // Update session title if it's the very first message (fire-and-forget)
            if (chatHistory.length === 0 && optimisticMessages.length === 0 && userText) {
                const newTitle = userText.length > 25 ? userText.substring(0, 25) + '...' : userText;
                editSession(activeSessionId, newTitle).catch(() => { });
            }

            // Save user message to Firebase in background (don't await)
            saveChatMessage({
                sessionId: activeSessionId,
                role: 'user',
                content: persistedUserContent
            }).catch(() => {
                toast.error('Erro ao salvar mensagem no histórico.');
            });

            // Prepare full dialog history for the AI prompt
            const mappedHistory: ChatMessage[] = chatHistory.map(msg => ({
                role: msg.role as 'user' | 'assistant' | 'system',
                content: msg.content,
                imageBase64: msg.imageUrl
            }));

            // Include optimistic messages in the history
            for (const opt of optimisticMessages) {
                mappedHistory.push({ role: opt.role, content: opt.content });
            }

            mappedHistory.push({
                role: 'user',
                content: persistedUserContent,
                imageBase64: base64Image ?? undefined
            });

            const recentHistory = mappedHistory.slice(-10);
            const aiResponse = await chatWithAI(recentHistory);
            triggerDataRefresh();

            // ── TYPEWRITER: reveal AI response progressively ──
            setIsProcessing(false);
            setFullAIResponse(aiResponse.message);
            setIsTyping(true);

            // Save assistant reply in background (don't block UI)
            saveChatMessage({
                sessionId: activeSessionId,
                role: 'assistant',
                content: aiResponse.message
            }).catch(() => { });

        } catch (error: any) {
            toast.error(error.message || 'Erro ao processar mensagem com IA.');
            const errorMsg = 'Ops, tive um problema de conexão. Possíveis causas: limite excedido na Groq ou erro de rede. Tente novamente!';
            setOptimisticMessages(prev => [...prev, { id: `opt-err-${Date.now()}`, role: 'assistant', content: errorMsg }]);
            saveChatMessage({
                sessionId: activeSessionId,
                role: 'assistant',
                content: errorMsg
            }).catch(() => { });
            setIsProcessing(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    // Merge Firebase history + optimistic local messages
    const mergedHistory = [
        ...chatHistory,
        ...optimisticMessages,
    ];

    // If chat is entirely empty (first time user), show a greeting manually as a visual stub
    const displayHistory = mergedHistory.length > 0
        ? mergedHistory
        : [{ id: 'intro', role: 'assistant' as const, content: 'Olá! Sou o SaldoPro AI. Posso te ajudar a analisar seus gastos, lançar novas despesas ou editar antigos lançamentos.\n\nDescreva seu lançamento em texto para eu adicionar automaticamente!' }];

    return (
        <div className="flex h-full w-full overflow-hidden bg-[#0B0E14] text-gray-100 font-sans relative">

            {/* Sidebar with Sessions */}
            <div className={`w-full md:w-80 shrink-0 flex-col border-r border-surface-700/40 bg-[#0B0E14]/95 md:bg-[#0f1218]/60 absolute inset-y-0 left-0 md:relative z-30 md:z-10 h-full backdrop-blur-xl md:backdrop-blur-none transition-transform duration-300 ${showMobileSidebar ? 'flex translate-x-0' : 'hidden md:flex md:translate-x-0'}`}>
                <div className="p-4 border-b border-surface-700/40 flex flex-col gap-4">

                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-finance-primary/10 border border-finance-primary/20 flex items-center justify-center shrink-0">
                                <Sparkles className="w-5 h-5 text-finance-primary-light" />
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
                        className="w-full justify-start gap-2 bg-finance-primary/10 hover:bg-finance-primary/20 text-finance-primary-light border border-finance-primary/20 rounded-xl h-11 transition-all"
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
                                    ? 'bg-finance-primary/10 text-finance-primary-light relative'
                                    : 'bg-transparent text-gray-400 hover:bg-white/[0.04] hover:text-gray-200'
                                    }`}
                            >
                                {activeSessionId === session.id && (
                                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-finance-primary rounded-r-full" />
                                )}
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <MessageSquare className={`w-4 h-4 shrink-0 transition-colors ${activeSessionId === session.id ? 'text-finance-primary-light' : 'text-surface-500 group-hover:text-surface-400'}`} />
                                    <span className="text-sm truncate font-medium">{session.title}</span>
                                </div>
                                <button
                                    onClick={(e) => handleDeleteSession(e, session.id)}
                                    className="opacity-100 md:opacity-0 group-hover:opacity-100 p-1.5 text-gray-500 hover:text-finance-expense hover:bg-finance-expense/10 rounded-lg transition-all shrink-0"
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
            <div className="flex-1 bg-[#0B0E14] flex flex-col overflow-hidden relative w-full">

                {/* Mobile Header Toggle */}
                <div className="md:hidden p-4 border-b border-surface-700/40 bg-[#0f1218]/60 backdrop-blur-md flex flex-row items-center gap-3 z-10 relative">
                    <button onClick={() => setShowMobileSidebar(true)} className="p-2 -ml-2 text-gray-400 hover:text-white rounded-lg transition-colors">
                        <Menu className="w-6 h-6" />
                    </button>
                    <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-finance-primary-light" />
                        <span className="font-semibold text-white">SaldoPro AI</span>
                    </div>
                </div>

                {/* Decorative background gradients */}
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-finance-primary/[0.03] rounded-full blur-[120px] pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-finance-primary/[0.03] rounded-full blur-[150px] pointer-events-none" />

                {!activeSessionId ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 relative z-10 animate-in fade-in duration-500">
                        <div className="relative mb-8">
                            <div className="absolute inset-0 bg-finance-primary/20 blur-2xl rounded-full animate-pulse" />
                            <div className="w-24 h-24 rounded-[2rem] bg-[#151921]/60 border border-surface-700/50 backdrop-blur-xl flex items-center justify-center shadow-2xl relative z-10 transform transition-transform hover:scale-105 duration-300">
                                <Sparkles className="w-12 h-12 text-finance-primary-light" />
                            </div>
                        </div>
                        <h2 className="text-3xl font-bold text-white mb-3">Como posso ajudar?</h2>
                        <p className="text-gray-400 max-w-md text-sm leading-relaxed mb-8">Selecione uma conversa ao lado ou crie uma nova para começar a interagir com seu assistente financeiro inteligente.</p>
                        <Button onClick={handleCreateSession} className="gap-2 bg-finance-primary hover:bg-finance-primary-light text-white rounded-xl px-8 py-6 shadow-lg shadow-finance-primary/25 border-none transition-all font-medium text-base">
                            <MessageSquarePlus className="w-5 h-5" /> Iniciar Nova Conversa
                        </Button>
                    </div>
                ) : (
                    <>
                        {/* Chat History View */}
                        <div className="flex-1 overflow-y-auto px-4 sm:px-6 md:px-12 py-8 custom-scrollbar space-y-8 relative z-10">
                            {displayHistory.map((msg, idx) => {
                                const isUser = msg.role === 'user';
                                const formattedAssistantContent = isUser ? '' : formatAssistantMarkdown(msg.content);
                                return (
                                    <div key={idx} className={`flex gap-4 animate-in slide-in-from-bottom-4 duration-500 fade-in ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 border shadow-sm
                                            ${isUser ? 'bg-[#151921] border-surface-700/40 text-gray-400' : 'bg-finance-primary/10 border-finance-primary/20 text-finance-primary-light backdrop-blur-sm'}`}>
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
                                                    ? 'bg-finance-primary text-white rounded-2xl rounded-br-sm max-w-full'
                                                    : 'bg-[#151921] border border-surface-700/30 text-gray-200 rounded-2xl rounded-tl-sm prose prose-invert prose-p:my-0 prose-p:leading-relaxed prose-strong:font-semibold prose-strong:text-white prose-em:text-gray-300 prose-ul:my-3 prose-li:my-1 prose-pre:bg-[#0B0E14] prose-pre:border prose-pre:border-surface-700/30 hover:prose-a:text-finance-primary-light'}`}>
                                                {isUser ? (
                                                    msg.content
                                                ) : (
                                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                        {formattedAssistantContent}
                                                    </ReactMarkdown>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}

                            {/* "IA pensando..." indicator while waiting for API */}
                            {isProcessing && (
                                <div className="flex gap-4 animate-fade-in">
                                    <div className="w-10 h-10 rounded-full bg-finance-primary/10 border border-finance-primary/20 text-finance-primary-light flex items-center justify-center shrink-0 shadow-sm backdrop-blur-sm">
                                        <Bot className="w-6 h-6" />
                                    </div>
                                    <div className="bg-[#151921] border border-surface-700/30 rounded-3xl rounded-tl-md px-5 py-4 flex items-center gap-3 w-fit shadow-md backdrop-blur-sm">
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-2 h-2 rounded-full bg-finance-primary-light" style={{ animation: 'typing-dot 1.2s ease-in-out infinite' }} />
                                            <div className="w-2 h-2 rounded-full bg-finance-primary-light" style={{ animation: 'typing-dot 1.2s ease-in-out 0.2s infinite' }} />
                                            <div className="w-2 h-2 rounded-full bg-finance-primary-light" style={{ animation: 'typing-dot 1.2s ease-in-out 0.4s infinite' }} />
                                        </div>
                                        <span className="text-sm text-gray-400 font-medium">IA pensando...</span>
                                    </div>
                                </div>
                            )}

                            {/* Typewriter: AI response appearing progressively */}
                            {isTyping && streamingText && (
                                <div className="flex gap-4 animate-fade-in">
                                    <div className="w-10 h-10 rounded-full bg-finance-primary/10 border border-finance-primary/20 text-finance-primary-light flex items-center justify-center shrink-0 shadow-sm backdrop-blur-sm">
                                        <Bot className="w-5 h-5" />
                                    </div>
                                    <div className="w-full max-w-[95%] items-start flex flex-col">
                                        <div className="px-5 py-4 text-[15px] whitespace-pre-wrap leading-relaxed shadow-sm w-full bg-[#151921] border border-surface-700/30 text-gray-200 rounded-2xl rounded-tl-sm prose prose-invert prose-p:my-0 prose-p:leading-relaxed prose-strong:font-semibold prose-strong:text-white prose-em:text-gray-300 prose-ul:my-3 prose-li:my-1">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                {formatAssistantMarkdown(streamingText)}
                                            </ReactMarkdown>
                                            <span className="inline-block w-0.5 h-4 bg-finance-primary-light animate-pulse ml-0.5 align-text-bottom" />
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input Area */}
                        <div className="p-4 sm:px-6 md:px-12 pb-6 shrink-0 relative z-20 bg-gradient-to-t from-[#0B0E14] via-[#0B0E14]/90 to-transparent pt-12">
                            <div className="max-w-4xl mx-auto relative group">
                                <div className="relative flex items-end bg-[#151921] border border-surface-700/30 rounded-xl shadow-lg focus-within:border-finance-primary/50 focus-within:ring-1 focus-within:ring-finance-primary/50 transition-all pl-2">
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
                                                    ? 'bg-finance-primary text-white hover:bg-finance-primary-light shadow-sm shadow-finance-primary/20'
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
