"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAiChatRouter = createAiChatRouter;
const express_1 = require("express");
const firebase_auth_1 = require("../middleware/firebase-auth");
const groq_1 = require("../ai/groq");
const firestore_1 = require("../lib/firestore");
const logger_1 = require("../lib/logger");
function createAiChatRouter() {
    const router = (0, express_1.Router)();
    // All routes require Firebase Auth
    router.use(firebase_auth_1.requireFirebaseAuth);
    router.post('/chat', async (req, res) => {
        const uid = req.uid;
        const body = req.body;
        if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
            res.status(400).json({ error: 'messages é obrigatório e deve conter ao menos uma mensagem.' });
            return;
        }
        try {
            // Build financial context from what the frontend sent + server-side data
            const [settings, profile] = await Promise.all([
                (0, firestore_1.getUserSettings)(uid),
                (0, firestore_1.getUserProfile)(uid)
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
                paymentMethod: 'pix',
                createdAt: '',
                updatedAt: ''
            }));
            const context = {
                profile,
                settings,
                categories,
                recentTransactions
            };
            // Convert frontend messages to GroqChatMessage format
            const groqMessages = body.messages.map(msg => ({
                role: msg.role,
                content: msg.content,
                ...(msg.imageBase64 ? { imageDataUrl: msg.imageBase64 } : {})
            }));
            logger_1.logger.info('Web AI chat request', {
                uid,
                messageCount: groqMessages.length,
                hasImage: groqMessages.some(m => m.imageDataUrl)
            });
            const result = await (0, groq_1.queryGroqAssistant)(groqMessages, context);
            res.json({
                reply: result.reply,
                actionObject: result.actionObject
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
