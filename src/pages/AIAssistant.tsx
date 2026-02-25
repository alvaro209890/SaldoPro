import { useState, useRef, useEffect } from 'react';
import { useTransactions } from '@/hooks/useTransactions';
import { useCategories } from '@/hooks/useCategories';
import { useChats } from '@/hooks/useChats';
import { useChatSessions } from '@/hooks/useChatSessions';
import { chatWithAI, type ChatMessage } from '@/services/ai';
import { uploadImageToCloudinary } from '@/services/cloudinary';
import { Button } from '@/components/ui/Button';
import { Sparkles, Send, Bot, ImagePlus, X, User, MessageSquarePlus, MessageSquare, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { generateMonthKey } from '@/utils/date';

export function AIAssistant() {
    const today = new Date();
    const currentMonthKey = generateMonthKey(today.toISOString());
    const { transactions, add, update, remove } = useTransactions(currentMonthKey);
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
        if (catsLoading || chatsLoading || !activeSessionId) {
            toast.error(activeSessionId ? 'Aguarde o carregamento dos seus dados...' : 'Crie uma nova conversa primeiro.');
            return;
        }

        const userText = input.trim();
        const base64Image = imagePreview;

        setInput('');
        handleRemoveImage();
        setIsProcessing(true);

        try {
            let uploadedImageUrl: string | undefined = undefined;

            // Update session title if it's the very first message
            if (chatHistory.length === 0 && userText) {
                const newTitle = userText.length > 25 ? userText.substring(0, 25) + '...' : userText;
                await editSession(activeSessionId, newTitle);
            }

            // 1. Upload image to Cloudinary if it exists
            if (base64Image) {
                toast.info('Enviando o comprovante...', { id: 'uploading' });
                uploadedImageUrl = await uploadImageToCloudinary(base64Image);
                toast.success('Comprovante enviado!', { id: 'uploading' });
            }

            // 2. Save user message to Firebase
            await saveChatMessage({
                sessionId: activeSessionId,
                role: 'user',
                content: userText,
                ...(uploadedImageUrl ? { imageUrl: uploadedImageUrl } : {})
            });

            // 3. Prepare full dialog history for the prompt
            const mappedHistory: ChatMessage[] = chatHistory.map(msg => ({
                role: msg.role as 'user' | 'assistant' | 'system',
                content: msg.content,
                imageBase64: msg.imageUrl
            }));

            mappedHistory.push({
                role: 'user',
                content: userText,
                imageBase64: uploadedImageUrl
            });

            // Keep history limited to last 10 interactions mapped to limit payload size
            const recentHistory = mappedHistory.slice(-10);

            const aiResponse = await chatWithAI(recentHistory, categories, transactions);

            // Execute action if not 'none'
            if (aiResponse.parsedAction.action === 'add_transaction') {
                const action = aiResponse.parsedAction;
                await add({
                    type: action.type,
                    amount: action.amount,
                    description: action.description,
                    category: action.categoryId,
                    date: action.date,
                    paymentMethod: action.paymentMethod
                });
                toast.success('Transação adicionada pela IA!');
            } else if (aiResponse.parsedAction.action === 'update_transaction') {
                const action = aiResponse.parsedAction;
                await update(action.id, action.changes);
                toast.success('Transação atualizada pela IA!');
            } else if (aiResponse.parsedAction.action === 'delete_transaction') {
                const action = aiResponse.parsedAction;
                await remove(action.id);
                toast.success('Transação excluída pela IA!');
            }

            // 4. Save assistant reply to Firebase
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
                content: 'Ops, tive um problema de conexão. Possíveis causas: limite excedido na Groq, falha no upload do Cloudinary ou erro de rede. Tente novamente!'
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
        : [{ id: 'intro', role: 'assistant' as const, content: 'Olá! Sou o SaldoPro AI. Posso te ajudar a analisar seus gastos, lançar novas despesas ou editar antigos lançamentos.\n\nExperimente enviar a foto de um comprovante para lançarmos juntos! Como posso ser útil hoje?' }];

    return (
        <div className="flex h-[calc(100vh-8rem)] gap-6 animate-fade-in max-w-6xl mx-auto">

            {/* Sidebar with Sessions */}
            <div className="w-72 shrink-0 flex flex-col gap-4">
                <div className="flex items-center gap-3 mb-2 px-2">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">
                        <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-white leading-tight">SaldoPro AI</h1>
                        <p className="text-xs text-indigo-300">Seu Conselheiro</p>
                    </div>
                </div>

                <Button
                    onClick={handleCreateSession}
                    className="w-full justify-start gap-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl h-11"
                >
                    <MessageSquarePlus className="w-4 h-4" />
                    Nova Conversa
                </Button>

                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1 pr-2">
                    {sessionsLoading ? (
                        <div className="text-center py-4 text-gray-500 text-sm">Carregando conversas...</div>
                    ) : sessions.length === 0 ? (
                        <div className="text-center py-6 text-gray-500 text-sm">Nenhuma conversa encontrada.</div>
                    ) : (
                        sessions.map(session => (
                            <div
                                key={session.id}
                                onClick={() => setActiveSessionId(session.id)}
                                className={`group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-colors ${activeSessionId === session.id
                                    ? 'bg-surface-800 border-indigo-500/50 border text-white'
                                    : 'bg-transparent border border-transparent text-gray-400 hover:bg-surface-800/50 hover:text-gray-200'
                                    }`}
                            >
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <MessageSquare className={`w-4 h-4 shrink-0 ${activeSessionId === session.id ? 'text-indigo-400' : 'text-gray-500'}`} />
                                    <span className="text-sm truncate font-medium">{session.title}</span>
                                </div>
                                <button
                                    onClick={(e) => handleDeleteSession(e, session.id)}
                                    className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-500 hover:text-red-400 hover:bg-surface-700 rounded-lg transition-all shrink-0"
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
            <div className="flex-1 rounded-3xl border border-surface-700/50 bg-surface-900/40 shadow-2xl flex flex-col overflow-hidden min-h-0 relative">

                {!activeSessionId ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                        <div className="w-20 h-20 rounded-3xl bg-surface-800/80 border border-surface-700/50 shadow-inner flex items-center justify-center mb-6">
                            <Bot className="w-10 h-10 text-indigo-400/80" />
                        </div>
                        <h2 className="text-xl font-semibold text-white mb-2">Como posso ajudar?</h2>
                        <p className="text-gray-400 max-w-md">Selecione uma conversa ao lado ou crie uma nova para começar a interagir com seu assistente financeiro inteligente.</p>
                        <Button onClick={handleCreateSession} className="mt-6 gap-2 bg-indigo-600 hover:bg-indigo-700">
                            <MessageSquarePlus className="w-4 h-4" /> Criar Conversa
                        </Button>
                    </div>
                ) : (
                    <>
                        {/* Chat History View */}
                        <div className="flex-1 overflow-y-auto px-4 py-6 custom-scrollbar space-y-6">
                            {displayHistory.map((msg, idx) => {
                                const isUser = msg.role === 'user';
                                return (
                                    <div key={idx} className={`flex gap-4 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm border
                                            ${isUser ? 'bg-indigo-900/30 border-indigo-700/30 text-indigo-300' : 'bg-surface-800 border-surface-700 text-gray-400'}`}>
                                            {isUser ? <User className="w-5 h-5" /> : <Bot className="w-6 h-6" />}
                                        </div>
                                        <div className={`max-w-[75%] space-y-2 ${isUser ? 'items-end flex flex-col' : 'items-start flex flex-col'}`}>
                                            {('imageUrl' in msg && msg.imageUrl) && (
                                                <div className="p-1 rounded-2xl bg-surface-800 border border-surface-700 w-fit shrink-0 overflow-hidden shadow-sm">
                                                    <a href={msg.imageUrl} target="_blank" rel="noopener noreferrer">
                                                        <img src={msg.imageUrl} alt="Anexo" className="max-h-[240px] w-auto rounded-xl object-contain cursor-pointer hover:opacity-90 transition-opacity" />
                                                    </a>
                                                </div>
                                            )}
                                            <div className={`px-5 py-3.5 shadow-md text-sm whitespace-pre-wrap leading-relaxed
                                                ${isUser
                                                    ? 'bg-indigo-600 text-white rounded-3xl rounded-tr-md'
                                                    : 'bg-surface-800/80 border border-surface-700/50 text-gray-100 rounded-3xl rounded-tl-md backdrop-blur-sm'}`}>
                                                {msg.content}
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
                        <div className="p-4 bg-surface-900/60 backdrop-blur-xl border-t border-surface-700/50 shrink-0">
                            {imagePreview && (
                                <div className="relative inline-block mb-3 animate-in fade-in zoom-in duration-200">
                                    <img src={imagePreview} alt="Preview" className="h-24 w-auto rounded-lg border border-surface-600 object-cover shadow-lg" />
                                    <button
                                        onClick={handleRemoveImage}
                                        className="absolute -top-2 -right-2 bg-surface-700 hover:bg-red-500 border border-surface-600 rounded-full p-1.5 text-white transition-colors shadow-lg"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            )}
                            <div className="relative flex items-end gap-3">
                                <button
                                    type="button"
                                    className="shrink-0 h-[52px] w-[52px] flex items-center justify-center rounded-2xl border border-surface-700/50 bg-surface-800/50 text-gray-400 hover:text-indigo-400 hover:border-indigo-500/50 hover:bg-surface-700/80 transition-all focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 shadow-sm backdrop-blur-sm"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isProcessing}
                                    title="Anexar comprovante"
                                >
                                    <ImagePlus className="w-6 h-6" />
                                </button>
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    ref={fileInputRef}
                                    onChange={handleImageChange}
                                />
                                <div className="relative flex-1">
                                    <textarea
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        disabled={isProcessing}
                                        placeholder="Digite sua mensagem ou anexe um comprovante..."
                                        className="w-full min-h-[52px] max-h-[140px] resize-none rounded-2xl border border-surface-700/50 bg-surface-800/50 p-3.5 pr-14 text-sm text-gray-100 placeholder-gray-500 transition-all focus:border-indigo-500/50 focus:bg-surface-800/80 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 custom-scrollbar disabled:opacity-50 shadow-sm backdrop-blur-sm"
                                        rows={1}
                                    />
                                    <Button
                                        onClick={handleSend}
                                        disabled={(!input.trim() && !imagePreview) || isProcessing}
                                        isLoading={isProcessing}
                                        className="absolute right-2 bottom-2 h-9 w-10 p-0 rounded-xl bg-indigo-600 hover:bg-indigo-500 shadow-md text-white flex items-center justify-center disabled:opacity-50 disabled:hover:bg-indigo-600 transition-all duration-200"
                                    >
                                        {!isProcessing && <Send className="w-4 h-4 ml-0.5" />}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
