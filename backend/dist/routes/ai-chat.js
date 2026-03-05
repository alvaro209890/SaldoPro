"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAiChatRouter = createAiChatRouter;
const express_1 = require("express");
const firebase_auth_1 = require("../middleware/firebase-auth");
const plan_access_1 = require("../middleware/plan-access");
const groq_1 = require("../ai/groq");
const firestore_1 = require("../lib/firestore");
const logger_1 = require("../lib/logger");
function createAiChatRouter() {
    const router = (0, express_1.Router)();
    // All routes require Firebase Auth
    router.use(firebase_auth_1.requireFirebaseAuth);
    router.post('/chat', (0, plan_access_1.requirePlanFeature)('web_ai_chat', {
        code: 'PLAN_REQUIRED_FOR_WEB_AI',
        message: 'O chat com IA exige um plano ativo.'
    }), async (req, res) => {
        const uid = req.uid;
        const body = req.body;
        if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
            res.status(400).json({ error: 'messages é obrigatório e deve conter ao menos uma mensagem.' });
            return;
        }
        try {
            // Build financial context from what the frontend sent + server-side data
            const [settings, profile, serverCategories, serverRecentTransactions] = await Promise.all([
                (0, firestore_1.getUserSettings)(uid),
                (0, firestore_1.getUserProfile)(uid),
                (0, firestore_1.getUserCategories)(uid),
                (0, firestore_1.getRecentTransactions)(uid, 50)
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
                    paymentMethod: 'pix',
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
                monthKey: ('monthKey' in t && t.monthKey) ? t.monthKey : t.date?.substring(0, 7) || '',
                paymentMethod: 'pix',
                createdAt: '',
                updatedAt: ''
            }));
            // Convert frontend messages to GroqChatMessage format
            const groqMessages = body.messages.map(msg => ({
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
            const context = {
                profile,
                settings,
                categories,
                recentTransactions,
                isFirstMessage,
                isGreeting,
                isCapabilitiesQuestion
            };
            logger_1.logger.info('Web AI chat request', {
                uid,
                messageCount: groqMessages.length,
                hasImage: groqMessages.some(m => Boolean(m.imageDataUrl)),
                isFirstMessage,
                isGreeting
            });
            const result = await (0, groq_1.queryGroqAssistant)(groqMessages, context);
            res.json({
                reply: result.reply,
                actionObjects: result.actionObjects
            });
        }
        catch (error) {
            logger_1.logger.error('Web AI chat error', {
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
