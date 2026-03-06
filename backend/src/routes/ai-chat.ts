import { Router, type Request, type Response } from 'express';
import { requireFirebaseAuth } from '../middleware/firebase-auth';
import { requirePlanFeature } from '../middleware/plan-access';
import { type GroqChatMessage } from '../ai/groq';
import { processWebAIMessage } from '../ai/assistant';
import { logger } from '../lib/logger';

interface WebChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    imageBase64?: string;
}

interface WebChatRequestBody {
    messages: WebChatMessage[];
}

export function createAiChatRouter(): Router {
    const router = Router();

    // All routes require Firebase Auth
    router.use(requireFirebaseAuth);

    router.post(
        '/chat',
        requirePlanFeature('web_ai_chat', {
            code: 'PLAN_REQUIRED_FOR_WEB_AI',
            message: 'O chat com IA exige um plano ativo.'
        }),
        async (req: Request, res: Response): Promise<void> => {
            const uid = (req as Request & { uid: string }).uid;
            const body = req.body as WebChatRequestBody;

            if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
                res.status(400).json({ error: 'messages é obrigatório e deve conter ao menos uma mensagem.' });
                return;
            }

            try {
                const groqMessages: GroqChatMessage[] = body.messages.map(msg => ({
                    role: msg.role,
                    content: msg.content,
                    ...(msg.imageBase64 ? { imageDataUrl: msg.imageBase64 } : {})
                }));

                // Detect conversation context flags for the web chat
                const userMessages = groqMessages.filter(m => m.role === 'user');
                const lastUserMsg = userMessages[userMessages.length - 1]?.content ?? '';
                const normalizedLastMsg = lastUserMsg
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .toLowerCase()
                    .trim();

                const isFirstMessage = userMessages.length <= 1;
                const isGreeting = /^(oi|ola|hey|hi|hello|bom dia|boa tarde|boa noite|e ai|opa|fala|salve|beleza)\b/.test(normalizedLastMsg) && normalizedLastMsg.length < 30;
                const isCapabilitiesQuestion = /\b(o que voce faz|o que vc faz|como funciona|me ajuda|quais funcoes|o que sabe fazer|como posso usar|help)\b/.test(normalizedLastMsg);

                logger.info('Web AI chat request', {
                    uid,
                    messageCount: groqMessages.length,
                    hasImage: groqMessages.some(m => Boolean(m.imageDataUrl)),
                    isFirstMessage,
                    isGreeting
                });

                const result = await processWebAIMessage(uid, groqMessages, {
                    isFirstMessage,
                    isGreeting,
                    isCapabilitiesQuestion
                });

                res.json({
                    reply: result.text
                });
            } catch (error) {
                logger.error('Web AI chat error', {
                    uid,
                    error: error instanceof Error ? error.message : 'unknown'
                });
                res.status(500).json({
                    error: 'Erro ao processar mensagem com a IA. Tente novamente.'
                });
            }
        }
    );

    return router;
}
