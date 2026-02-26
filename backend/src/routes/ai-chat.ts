import { Router, type Request, type Response } from 'express';
import { requireFirebaseAuth } from '../middleware/firebase-auth';
import { queryGroqAssistant, type GroqChatMessage, type UserFinancialContext } from '../ai/groq';
import { getUserCategories, getRecentTransactions, getUserSettings, getUserProfile } from '../lib/firestore';
import { logger } from '../lib/logger';

interface WebChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    imageBase64?: string;
}

interface WebChatRequestBody {
    messages: WebChatMessage[];
    categories: Array<{ id: string; name: string; type: 'income' | 'expense' }>;
    transactions: Array<{
        id: string;
        date: string;
        description: string;
        amount: number;
        type: 'income' | 'expense';
        category: string;
        monthKey?: string;
    }>;
}

export function createAiChatRouter(): Router {
    const router = Router();

    // All routes require Firebase Auth
    router.use(requireFirebaseAuth);

    router.post('/chat', async (req: Request, res: Response): Promise<void> => {
        const uid = (req as Request & { uid: string }).uid;
        const body = req.body as WebChatRequestBody;

        if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
            res.status(400).json({ error: 'messages é obrigatório e deve conter ao menos uma mensagem.' });
            return;
        }

        try {
            // Build financial context from what the frontend sent + server-side data
            const [settings, profile] = await Promise.all([
                getUserSettings(uid),
                getUserProfile(uid)
            ]);

            // Use frontend-provided categories and transactions (they're already filtered by month/user)
            const categories = (body.categories || []).map(c => ({
                id: c.id,
                name: c.name,
                type: c.type,
                color: '',
                icon: ''
            }));

            const recentTransactions = (body.transactions || []).slice(0, 50).map(t => ({
                id: t.id,
                date: t.date,
                description: t.description,
                amount: t.amount,
                type: t.type,
                category: t.category,
                monthKey: t.monthKey || t.date?.substring(0, 7) || '',
                paymentMethod: 'pix' as const,
                createdAt: '',
                updatedAt: ''
            }));

            const context: UserFinancialContext = {
                profile,
                settings,
                categories,
                recentTransactions
            };

            // Convert frontend messages to GroqChatMessage format
            const groqMessages: GroqChatMessage[] = body.messages.map(msg => ({
                role: msg.role,
                content: msg.content,
                ...(msg.imageBase64 ? { imageDataUrl: msg.imageBase64 } : {})
            }));

            logger.info('Web AI chat request', {
                uid,
                messageCount: groqMessages.length,
                hasImage: groqMessages.some(m => m.imageDataUrl)
            });

            const result = await queryGroqAssistant(groqMessages, context);

            res.json({
                reply: result.reply,
                actionObject: result.actionObject
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
    });

    return router;
}
