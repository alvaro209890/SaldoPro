"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryGroqAssistant = queryGroqAssistant;
const env_1 = require("../config/env");
function buildSystemPrompt(categories, recentTransactions) {
    const categoriesList = categories
        .map((c) => `- ID: "${c.id}", Nome: "${c.name}", Tipo: ${c.type}`)
        .join('\n');
    const txList = recentTransactions
        .slice(0, env_1.env.whatsappAiRecentTransactions)
        .map((t) => `- ID: "${t.id}", Data: ${t.date}, Desc: "${t.description}", Valor: ${t.amount}, Tipo: ${t.type}, CatID: ${t.category}`)
        .join('\n');
    const today = new Date().toISOString().split('T')[0];
    return `Você é o SaldoPro AI, assistente financeiro pessoal do usuário via WhatsApp.

Regras obrigatórias:
1) Responda SEMPRE com um JSON válido contendo exatamente duas chaves:
   - "reply": texto em Markdown para o usuário (use emojis, listas e negrito quando útil).
   - "actionObject": objeto de ação conforme os formatos abaixo.
2) Não escreva NADA fora do JSON. Nunca use blocos de código ou texto antes/depois do JSON.
3) Quando o usuário mencionar qualquer gasto, receita, compra, pagamento ou enviar
   comprovante/recibo — SEMPRE use "add_transaction" com os dados extraídos.
   - Para imagens de comprovante: leia o valor total pago, a data e a descrição do recibo.
   - Escolha o "categoryId" mais adequado dentre as categorias disponíveis abaixo.
   - Se não tiver certeza da categoria, use a que mais se aproxima pelo tipo (expense/income).
4) Use {"action":"none"} APENAS para perguntas, consultas e análises puras (sem transação).

Formatos aceitos para "actionObject":
- {"action":"none"}
- {"action":"add_transaction","type":"expense|income","amount":15.5,"description":"Lanche","categoryId":"id","date":"YYYY-MM-DD","paymentMethod":"pix|credit|debit|cash|transfer|boleto"}
- {"action":"update_transaction","id":"transaction_id","changes":{"amount":20}}
- {"action":"delete_transaction","id":"transaction_id"}

Diretrizes para o campo "reply":
- Seja direto e consultivo.
- Ao confirmar um lançamento, indique o que foi registrado (valor, descrição, categoria).
- Para análises, traga insights práticos sobre os gastos quando útil.

Categorias disponíveis:
${categoriesList || '- (nenhuma categoria)'}

Transações recentes:
${txList || '- (nenhuma transação)'}

Data de referência: ${today}`;
}
function parseAssistantPayload(content) {
    try {
        return JSON.parse(content);
    }
    catch {
        const start = content.indexOf('{');
        const end = content.lastIndexOf('}');
        if (start >= 0 && end > start) {
            return JSON.parse(content.slice(start, end + 1));
        }
        throw new Error('Groq response is not valid JSON');
    }
}
async function queryGroqAssistant(messages, categories, recentTransactions) {
    if (messages.length === 0) {
        throw new Error('At least one message is required');
    }
    const lastMessage = messages[messages.length - 1];
    const targetModel = lastMessage?.imageDataUrl ? env_1.env.groqVisionModel : env_1.env.groqModel;
    const formattedMessages = messages.map((message) => {
        if (message.imageDataUrl) {
            return {
                role: message.role,
                content: [
                    {
                        type: 'text',
                        text: message.content.trim() ||
                            'Analise a imagem enviada e extraia os dados financeiros relevantes.'
                    },
                    { type: 'image_url', image_url: { url: message.imageDataUrl } }
                ]
            };
        }
        return {
            role: message.role,
            content: message.content
        };
    });
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${env_1.env.groqApiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: targetModel,
            temperature: 0.2,
            // response_format is not supported by vision models (e.g. llama-3.2-90b-vision-preview)
            // The system prompt already instructs the model to return valid JSON
            ...(lastMessage?.imageDataUrl ? {} : { response_format: { type: 'json_object' } }),
            messages: [
                {
                    role: 'system',
                    content: buildSystemPrompt(categories, recentTransactions)
                },
                ...formattedMessages
            ]
        })
    });
    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Groq request failed: ${response.status} ${detail}`);
    }
    const data = (await response.json());
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error('Groq did not return content');
    }
    const parsed = parseAssistantPayload(content);
    return {
        reply: (parsed.reply ?? '').toString().trim() || 'Nao consegui entender. Pode reformular?',
        actionObject: parsed.actionObject ?? { action: 'none' }
    };
}
