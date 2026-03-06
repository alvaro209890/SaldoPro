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
import type { StoredChatMessage } from '@/types';

type LocalAssistantPhase = 'thinking' | 'typing' | 'done';

interface LocalChatMessage {
    tempId: string;
    sessionId: string;
    role: 'user' | 'assistant';
    content: string;
    imageBase64?: string;
    finalContent?: string;
    phase?: LocalAssistantPhase;
}

interface DisplayChatMessage {
    key: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    imageUrl?: string;
    phase?: LocalAssistantPhase;
}

function normalizeMessageContent(value: string): string {
    return value.normalize('NFC').replace(/\r\n/g, '\n').trim();
}

function getComparableContent(
    message: Pick<StoredChatMessage, 'content'> | Pick<LocalChatMessage, 'content' | 'finalContent'>
): string {
    if ('finalContent' in message) {
        return normalizeMessageContent(message.finalContent ?? message.content);
    }

    return normalizeMessageContent(message.content);
}

function getMatchedPersistedMessageIds(
    persistedMessages: StoredChatMessage[],
    localMessages: LocalChatMessage[]
): Set<string> {
    const matchedPersistedIds = new Set<string>();
    let localIndex = localMessages.length - 1;

    for (let persistedIndex = persistedMessages.length - 1; persistedIndex >= 0 && localIndex >= 0; persistedIndex--) {
        const persistedMessage = persistedMessages[persistedIndex];
        const persistedContent = getComparableContent(persistedMessage);

        while (localIndex >= 0) {
            const localMessage = localMessages[localIndex];
            const localContent = getComparableContent(localMessage);

            localIndex--;

            if (!localContent) {
                continue;
            }

            if (localMessage.role === persistedMessage.role && localContent === persistedContent) {
                matchedPersistedIds.add(persistedMessage.id);
                break;
            }
        }
    }

    return matchedPersistedIds;
}

function buildDisplayMessages(
    persistedMessages: StoredChatMessage[],
    localMessages: LocalChatMessage[]
): DisplayChatMessage[] {
    const matchedPersistedIds = getMatchedPersistedMessageIds(persistedMessages, localMessages);

    return [
        ...persistedMessages
            .filter(message => !matchedPersistedIds.has(message.id))
            .map(message => ({
                key: message.id,
                role: message.role,
                content: message.content,
                imageUrl: message.imageUrl,
            })),
        ...localMessages.map(message => ({
            key: message.tempId,
            role: message.role,
            content: message.content || message.finalContent || '',
            imageUrl: message.imageBase64,
            phase: message.phase,
        })),
    ];
}

function buildPromptHistory(
    persistedMessages: StoredChatMessage[],
    localMessages: LocalChatMessage[]
): ChatMessage[] {
    const matchedPersistedIds = getMatchedPersistedMessageIds(persistedMessages, localMessages);

    const persistedHistory: ChatMessage[] = persistedMessages
        .filter(message => !matchedPersistedIds.has(message.id))
        .map(message => ({
            role: message.role,
            content: normalizeMessageContent(message.content),
            imageBase64: message.imageUrl,
        }));

    const localHistory: ChatMessage[] = localMessages
        .map(message => ({
            role: message.role,
            content: normalizeMessageContent(message.finalContent ?? message.content),
            imageBase64: message.imageBase64,
        }))
        .filter(message => message.content.length > 0);

    return [...persistedHistory, ...localHistory];
}

function createTempId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatAssistantMarkdown(content: string): string {
    return content
        .normalize('NFC')
        .replace(/\r\n/g, '\n')
        .trim()
        .replace(/\*([^\n*]+)\*/g, '**$1**')
        .replace(/_([^\n_]+)_/g, '*$1*')
        .replace(/\n/g, '  \n');
}

export function AIAssistant() {
    const { sessions, addSession, removeSession, editSession, loading: sessionsLoading } = useChatSessions();
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

    useEffect(() => {
        if (!sessionsLoading && sessions.length > 0 && !activeSessionId) {
            setActiveSessionId(sessions[0].id);
        }
    }, [sessions, sessionsLoading, activeSessionId]);

    const { messages: chatHistory, addMessage: saveChatMessage } = useChats(activeSessionId);

    const [input, setInput] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [localMessagesBySession, setLocalMessagesBySession] = useState<Record<string, LocalChatMessage[]>>({});

    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [showMobileSidebar, setShowMobileSidebar] = useState(false);
    const typingIntervalsRef = useRef<Record<string, number>>({});
    const mountedRef = useRef(true);

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    const setSessionLocalMessages = useCallback((sessionId: string, updater: (current: LocalChatMessage[]) => LocalChatMessage[]) => {
        setLocalMessagesBySession(prev => ({
            ...prev,
            [sessionId]: updater(prev[sessionId] ?? []),
        }));
    }, []);

    const updateSessionLocalMessage = useCallback((
        sessionId: string,
        tempId: string,
        updater: (message: LocalChatMessage) => LocalChatMessage
    ) => {
        setSessionLocalMessages(sessionId, current =>
            current.map(message => message.tempId === tempId ? updater(message) : message)
        );
    }, [setSessionLocalMessages]);

    const clearTypingInterval = useCallback((tempId: string) => {
        const intervalId = typingIntervalsRef.current[tempId];
        if (intervalId) {
            window.clearInterval(intervalId);
            delete typingIntervalsRef.current[tempId];
        }
    }, []);

    const startAssistantTyping = useCallback((
        sessionId: string,
        tempId: string,
        fullResponse: string
    ) => {
        const normalizedResponse = normalizeMessageContent(fullResponse);
        clearTypingInterval(tempId);

        if (!normalizedResponse) {
            updateSessionLocalMessage(sessionId, tempId, message => ({
                ...message,
                content: '',
                finalContent: '',
                phase: 'done',
            }));
            return;
        }

        let charIndex = 0;
        updateSessionLocalMessage(sessionId, tempId, message => ({
            ...message,
            content: '',
            finalContent: normalizedResponse,
            phase: 'typing',
        }));

        const intervalId = window.setInterval(() => {
            if (!mountedRef.current) {
                clearTypingInterval(tempId);
                return;
            }

            charIndex += 1;
            const nextChunk = normalizedResponse.slice(0, charIndex);
            const isDone = charIndex >= normalizedResponse.length;

            updateSessionLocalMessage(sessionId, tempId, message => ({
                ...message,
                content: nextChunk,
                finalContent: normalizedResponse,
                phase: isDone ? 'done' : 'typing',
            }));

            if (isDone) {
                clearTypingInterval(tempId);
            }
        }, 12);

        typingIntervalsRef.current[tempId] = intervalId;
    }, [clearTypingInterval, updateSessionLocalMessage]);

    const sessionLocalMessages = activeSessionId ? (localMessagesBySession[activeSessionId] ?? []) : [];
    const mergedHistory = activeSessionId ? buildDisplayMessages(chatHistory, sessionLocalMessages) : [];
    const displayHistory: DisplayChatMessage[] = mergedHistory.length > 0
        ? mergedHistory
        : [{
            key: 'intro',
            role: 'assistant',
            content: 'Ol\u00e1! Sou o SaldoPro AI. Posso te ajudar a analisar seus gastos, lan\u00e7ar novas despesas ou editar antigos lan\u00e7amentos.\n\nDescreva seu lan\u00e7amento em texto para eu adicionar automaticamente!',
        }];

    useEffect(() => {
        scrollToBottom();
    }, [displayHistory, scrollToBottom]);

    useEffect(() => {
        return () => {
            mountedRef.current = false;
            Object.values(typingIntervalsRef.current).forEach(intervalId => window.clearInterval(intervalId));
            typingIntervalsRef.current = {};
        };
    }, []);

    const handleCreateSession = () => {
        const tempId = `temp-${Date.now()}`;
        setActiveSessionId(tempId);

        addSession('Nova Conversa').then((realId) => {
            setLocalMessagesBySession(prev => {
                if (!prev[tempId]) {
                    return prev;
                }

                const tempMessages = prev[tempId];
                const { [tempId]: _, ...rest } = prev;
                return {
                    ...rest,
                    [realId]: tempMessages.map(message => ({ ...message, sessionId: realId })),
                };
            });

            setActiveSessionId((current) => current === tempId ? realId : current);
        }).catch(() => {
            setLocalMessagesBySession(prev => {
                if (!prev[tempId]) {
                    return prev;
                }

                const { [tempId]: _, ...rest } = prev;
                return rest;
            });
            setActiveSessionId(null);
        });
    };

    const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!window.confirm('Tem certeza que deseja apagar essa conversa?')) return;

        try {
            await removeSession(id);
            const sessionLocal = localMessagesBySession[id] ?? [];
            sessionLocal.forEach(message => clearTypingInterval(message.tempId));
            setLocalMessagesBySession(prev => {
                if (!prev[id]) {
                    return prev;
                }

                const { [id]: _, ...rest } = prev;
                return rest;
            });
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

        const sessionId = activeSessionId;
        const currentSessionLocalMessages = localMessagesBySession[sessionId] ?? [];
        const userText = normalizeMessageContent(input);
        const base64Image = imagePreview;
        const persistedUserContent = userText || (base64Image ? '[Imagem enviada para analise]' : '');
        const userTempId = createTempId('user');
        const assistantTempId = createTempId('assistant');

        setInput('');
        handleRemoveImage();
        setIsProcessing(true);

        setSessionLocalMessages(sessionId, current => [
            ...current,
            {
                tempId: userTempId,
                sessionId,
                role: 'user',
                content: persistedUserContent,
                imageBase64: base64Image ?? undefined,
            },
            {
                tempId: assistantTempId,
                sessionId,
                role: 'assistant',
                content: '',
                phase: 'thinking',
            },
        ]);

        try {
            if (chatHistory.length === 0 && currentSessionLocalMessages.length === 0 && userText) {
                const newTitle = userText.length > 25 ? `${userText.substring(0, 25)}...` : userText;
                editSession(sessionId, newTitle).catch(() => { });
            }

            saveChatMessage({
                sessionId,
                role: 'user',
                content: persistedUserContent,
            }).catch(() => {
                toast.error('Erro ao salvar mensagem no hist\u00f3rico.');
            });

            const recentHistory = [
                ...buildPromptHistory(chatHistory, currentSessionLocalMessages),
                {
                    role: 'user' as const,
                    content: persistedUserContent,
                    imageBase64: base64Image ?? undefined,
                },
            ].slice(-10);

            const aiResponse = await chatWithAI(recentHistory);
            triggerDataRefresh();
            setIsProcessing(false);

            startAssistantTyping(sessionId, assistantTempId, aiResponse.message);

            saveChatMessage({
                sessionId,
                role: 'assistant',
                content: aiResponse.message,
            }).catch(() => { });
        } catch (error: any) {
            const errorMsg = 'Ops, tive um problema de conex\u00e3o. Poss\u00edveis causas: limite excedido na Groq ou erro de rede. Tente novamente!';
            toast.error(error.message || 'Erro ao processar mensagem com IA.');
            clearTypingInterval(assistantTempId);
            updateSessionLocalMessage(sessionId, assistantTempId, message => ({
                ...message,
                content: errorMsg,
                finalContent: errorMsg,
                phase: 'done',
            }));
            saveChatMessage({
                sessionId,
                role: 'assistant',
                content: errorMsg,
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

    return (
        <div className="flex h-full w-full overflow-hidden bg-[#0B0E14] text-gray-100 font-sans relative">
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

            <div className="flex-1 bg-[#0B0E14] flex flex-col overflow-hidden relative w-full">
                <div className="md:hidden p-4 border-b border-surface-700/40 bg-[#0f1218]/60 backdrop-blur-md flex flex-row items-center gap-3 z-10 relative">
                    <button onClick={() => setShowMobileSidebar(true)} className="p-2 -ml-2 text-gray-400 hover:text-white rounded-lg transition-colors">
                        <Menu className="w-6 h-6" />
                    </button>
                    <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-finance-primary-light" />
                        <span className="font-semibold text-white">SaldoPro AI</span>
                    </div>
                </div>

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
                        <p className="text-gray-400 max-w-md text-sm leading-relaxed mb-8">Selecione uma conversa ao lado ou crie uma nova para come\u00e7ar a interagir com seu assistente financeiro inteligente.</p>
                        <Button onClick={handleCreateSession} className="gap-2 bg-finance-primary hover:bg-finance-primary-light text-white rounded-xl px-8 py-6 shadow-lg shadow-finance-primary/25 border-none transition-all font-medium text-base">
                            <MessageSquarePlus className="w-5 h-5" /> Iniciar Nova Conversa
                        </Button>
                    </div>
                ) : (
                    <>
                        <div className="flex-1 overflow-y-auto px-4 sm:px-6 md:px-12 py-8 custom-scrollbar space-y-8 relative z-10">
                            {displayHistory.map((msg) => {
                                const isUser = msg.role === 'user';
                                const isThinking = msg.phase === 'thinking';
                                const isTyping = msg.phase === 'typing';
                                const formattedAssistantContent = isUser || isThinking ? '' : formatAssistantMarkdown(msg.content);

                                return (
                                    <div key={msg.key} className={`flex gap-4 animate-in slide-in-from-bottom-4 duration-500 fade-in ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 border shadow-sm ${isUser ? 'bg-[#151921] border-surface-700/40 text-gray-400' : 'bg-finance-primary/10 border-finance-primary/20 text-finance-primary-light backdrop-blur-sm'}`}>
                                            {isUser ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                                        </div>
                                        <div className={`space-y-2 ${isUser ? 'max-w-[85%] items-end flex flex-col' : 'w-full max-w-[95%] items-start flex flex-col'}`}>
                                            {msg.imageUrl && (
                                                <div className="p-1 rounded-2xl bg-surface-800/80 backdrop-blur-md border border-surface-700 w-fit shrink-0 overflow-hidden shadow-md">
                                                    <a href={msg.imageUrl} target="_blank" rel="noopener noreferrer">
                                                        <img src={msg.imageUrl} alt="Anexo" className="max-h-[240px] w-auto rounded-xl object-contain cursor-pointer hover:opacity-90 transition-opacity" />
                                                    </a>
                                                </div>
                                            )}
                                            <div className={`px-5 py-4 text-[15px] whitespace-pre-wrap leading-relaxed shadow-sm w-full ${isUser
                                                ? 'bg-finance-primary text-white rounded-2xl rounded-br-sm max-w-full'
                                                : 'bg-[#151921] border border-surface-700/30 text-gray-200 rounded-2xl rounded-tl-sm prose prose-invert prose-p:my-0 prose-p:leading-relaxed prose-strong:font-semibold prose-strong:text-white prose-em:text-gray-300 prose-ul:my-3 prose-li:my-1 prose-pre:bg-[#0B0E14] prose-pre:border prose-pre:border-surface-700/30 hover:prose-a:text-finance-primary-light'}`}>
                                                {isUser ? (
                                                    msg.content
                                                ) : isThinking ? (
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex items-center gap-1.5">
                                                            <div className="w-2 h-2 rounded-full bg-finance-primary-light" style={{ animation: 'typing-dot 1.2s ease-in-out infinite' }} />
                                                            <div className="w-2 h-2 rounded-full bg-finance-primary-light" style={{ animation: 'typing-dot 1.2s ease-in-out 0.2s infinite' }} />
                                                            <div className="w-2 h-2 rounded-full bg-finance-primary-light" style={{ animation: 'typing-dot 1.2s ease-in-out 0.4s infinite' }} />
                                                        </div>
                                                        <span className="text-sm text-gray-400 font-medium not-prose">IA pensando...</span>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                            {formattedAssistantContent}
                                                        </ReactMarkdown>
                                                        {isTyping && (
                                                            <span className="inline-block w-0.5 h-4 bg-finance-primary-light animate-pulse ml-0.5 align-text-bottom not-prose" />
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                            <div ref={messagesEndRef} />
                        </div>

                        <div className="p-4 sm:px-6 md:px-12 pb-6 shrink-0 relative z-20 bg-gradient-to-t from-[#0B0E14] via-[#0B0E14]/90 to-transparent pt-12">
                            <div className="max-w-4xl mx-auto relative group">
                                <div className="relative flex items-end bg-[#151921] border border-surface-700/30 rounded-xl shadow-lg focus-within:border-finance-primary/50 focus-within:ring-1 focus-within:ring-finance-primary/50 transition-all pl-2">
                                    <div className="relative flex-1 py-[14px]">
                                        <textarea
                                            value={input}
                                            onChange={(e) => setInput(e.target.value)}
                                            onKeyDown={handleKeyDown}
                                            disabled={isProcessing}
                                            lang="pt-BR"
                                            spellCheck
                                            autoCorrect="on"
                                            placeholder="Descreva seu lan\u00e7amento..."
                                            className="w-full h-6 max-h-[120px] resize-none bg-transparent text-[15px] text-gray-100 placeholder-gray-500 focus:outline-none custom-scrollbar disabled:opacity-50 !p-0 leading-[24px]"
                                            rows={1}
                                            style={{ minHeight: '24px' }}
                                        />
                                    </div>

                                    <div className="px-2 py-2 flex items-end">
                                        <button
                                            onClick={handleSend}
                                            disabled={(!input.trim() && !imagePreview) || isProcessing}
                                            className={`h-9 w-9 flex items-center justify-center rounded-lg transition-all ${(input.trim() || imagePreview) && !isProcessing
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
                                    O SaldoPro AI pode cometer erros de interpreta\u00e7\u00e3o. Verifique os lan\u00e7amentos.
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
