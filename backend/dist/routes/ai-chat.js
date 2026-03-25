"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAiChatRouter = createAiChatRouter;
const express_1 = require("express");
const supabase_auth_1 = require("../middleware/supabase-auth");
const plan_access_1 = require("../middleware/plan-access");
const assistant_1 = require("../ai/assistant");
const logger_1 = require("../lib/logger");
function normalizeUtf8Text(value) {
    return value.normalize('NFC');
}
function createAiChatRouter() {
    const router = (0, express_1.Router)();
    router.use(supabase_auth_1.requireSupabaseAuth);
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
            const groqMessages = body.messages.map(msg => ({
                role: msg.role,
                content: normalizeUtf8Text(msg.content),
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
            logger_1.logger.info('Web AI chat request', {
                uid,
                messageCount: groqMessages.length,
                hasImage: groqMessages.some(m => Boolean(m.imageDataUrl)),
                isFirstMessage,
                isGreeting
            });
            const result = await (0, assistant_1.processWebAIMessage)(uid, groqMessages, {
                isFirstMessage,
                isGreeting,
                isCapabilitiesQuestion
            });
            res.json({
                reply: normalizeUtf8Text(result.text)
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
