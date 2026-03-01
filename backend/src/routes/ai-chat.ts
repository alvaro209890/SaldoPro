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
            const [settings, profile, serverCategories, serverRecentTransactions] = await Promise.all([
                getUserSettings(uid),
                getUserProfile(uid),
                getUserCategories(uid),
                getRecentTransactions(uid, 50)
            ]);

            const requestCategories = Array.isArray(body.categories) ? body.categories : [];
            const requestTransactions = Array.isArray(body.transactions) ? body.transactions : [];

            // Prefer the frontend payload when available, but fall back to server data
            // if the page sends empty arrays before snapshots finish loading.
            const categoriesSource = requestCategories.length > 0
                ? requestCategories.map(c => ({
                    id: c.id,
                    name: c.name,
                    type: c.type,
                    color: '',
                    icon: ''
                }))
                : serverCategories;

            const transactionsSource = requestTransactions.length > 0
                ? requestTransactions.map(t => ({
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
                }))
                : serverRecentTransactions;

            const categories = categoriesSource.map(c => ({
                id: c.id,
                name: c.name,
                type: c.type,
                color: '',
                icon: ''
            }));

            const recentTransactions = transactionsSource.slice(0, 50).map(t => ({
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
                actionObjects: result.actionObjects
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
