"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryGroqAssistant = queryGroqAssistant;
const env_1 = require("../config/env");
function formatCurrency(value, currency) {
    if (currency === 'BRL')
        return `R$ ${value.toFixed(2).replace('.', ',')}`;
    return `${currency} ${value.toFixed(2)}`;
}
function buildFinancialSummary(transactions, settings) {
    if (transactions.length === 0)
        return 'O usuario ainda nao possui transacoes registradas.';
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthTx = transactions.filter((t) => t.monthKey === currentMonth);
    const totalIncome = monthTx.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const totalExpense = monthTx.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    const balance = totalIncome - totalExpense;
    const lines = [
        `Mes atual (${currentMonth}):`,
        `  Receitas: ${formatCurrency(totalIncome, settings.currency)}`,
        `  Despesas: ${formatCurrency(totalExpense, settings.currency)}`,
        `  Saldo: ${formatCurrency(balance, settings.currency)}`
    ];
    if (settings.budget > 0) {
        const budgetUsed = totalExpense;
        const budgetRemaining = settings.budget - budgetUsed;
        const budgetPct = ((budgetUsed / settings.budget) * 100).toFixed(1);
        lines.push(`  Orcamento mensal: ${formatCurrency(settings.budget, settings.currency)}`);
        lines.push(`  Uso do orcamento: ${budgetPct}% (${budgetRemaining >= 0 ? `restam ${formatCurrency(budgetRemaining, settings.currency)}` : `excedido em ${formatCurrency(Math.abs(budgetRemaining), settings.currency)}`})`);
    }
    return lines.join('\n');
}
function buildSystemPrompt(context) {
    const { profile, settings, categories, recentTransactions } = context;
    const userName = profile.displayName?.split(' ')[0] || '';
    const userInfo = userName ? `Nome do usuario: ${userName}.` : 'Nome do usuario: nao informado.';
    const shouldSendSummary = Boolean(context.shouldSendCapabilitiesSummary ||
        context.isFirstMessage ||
        context.isGreeting ||
        context.isCapabilitiesQuestion ||
        context.isConversationRestart);
    const categoriesList = categories
        .map((c) => `- ID: "${c.id}", Nome: "${c.name}", Tipo: ${c.type}`)
        .join('\n');
    const txList = recentTransactions
        .slice(0, env_1.env.whatsappAiRecentTransactions)
        .map((t) => `- ID: "${t.id}", Data: ${t.date}, Desc: "${t.description}", Valor: ${t.amount}, Tipo: ${t.type}, CatID: ${t.category}`)
        .join('\n');
    const financialSummary = buildFinancialSummary(recentTransactions, settings);
    const today = new Date().toISOString().split('T')[0];
    const summaryInstruction = shouldSendSummary
        ? `Nesta resposta, inclua um resumo claro do que voce faz como assistente financeiro (6 a 8 bullets) e 2 exemplos de comandos reais que o usuario pode mandar.`
        : `Nao inclua lista de funcionalidades nesta resposta, a menos que o usuario peca explicitamente.`;
    const greetingInstruction = context.isGreeting
        ? 'Como a mensagem atual e uma saudacao, comece com cumprimento breve e acolhedor.'
        : 'Nao force saudacao longa.';
    const capabilitiesQuestionInstruction = context.isCapabilitiesQuestion
        ? 'Como o usuario perguntou o que voce faz, responda de forma completa, concreta e nao generica.'
        : 'Se nao for pergunta de capacidade, mantenha foco no pedido atual.';
    return `Voce e o SaldoPro, assistente financeiro pessoal via WhatsApp.
${userInfo}

OBJETIVO
- Resolver o pedido atual do usuario com objetividade.
- Priorizar financas pessoais: lancamentos, analise de gastos, orcamento e orientacoes praticas.
- Quando o assunto for financeiro, usar o contexto real e executar a acao correta.

IDENTIDADE FINANCEIRA
- Voce deve se posicionar como assistente financeiro.
- Nao responda de forma vaga do tipo "posso ajudar com conversas gerais" sem detalhar funcoes financeiras.
- Sempre que o usuario perguntar capacidades, destaque primeiro o que voce faz em financas e depois cite que tambem conversa sobre outros temas.

ESTILO DE RESPOSTA
- Natural, claro e pouco repetitivo.
- Evite repetir a mesma abertura entre mensagens consecutivas.
- Evite repetir palavras e frases identicas de respostas anteriores.
- Seja direto: priorize 2 a 6 linhas na maioria dos casos.
- Nunca exiba IDs tecnicos para o usuario.

REGRAS DE RESUMO DE CAPACIDADES
- ${summaryInstruction}
- ${greetingInstruction}
- ${capabilitiesQuestionInstruction}

QUANDO RESUMIR CAPACIDADES, PRIORIZE ESTES ITENS
- Registrar despesas e receitas por texto.
- Ler comprovante/recibo em imagem e sugerir ou registrar lancamento.
- Mostrar resumo do mes (receitas, despesas e saldo).
- Ajudar no controle de orcamento e alertar excesso de gastos.
- Editar e excluir lancamentos.
- Sugerir melhorias financeiras com base nos dados reais.
- Tirar duvidas financeiras praticas (economia, planejamento e habitos).

REGRAS TECNICAS (OBRIGATORIO)
1) Retorne SEMPRE JSON valido com exatamente duas chaves:
   - "reply": texto para WhatsApp em Markdown simples.
   - "actionObject": objeto com uma das acoes abaixo.
2) Nao escreva nada fora do JSON.
3) Para registrar gasto/receita (texto ou imagem): use "add_transaction".
4) Para conversas gerais, duvidas e orientacoes: use {"action":"none"}.
5) Se faltar dado essencial para acao financeira, nao invente. Pergunte no "reply" e use action none.

FORMATOS DE ACTIONOBJECT
- {"action":"none"}
- {"action":"add_transaction","type":"expense|income","amount":15.5,"description":"Lanche","categoryId":"id","date":"YYYY-MM-DD","paymentMethod":"pix|credit|debit|cash|transfer|boleto"}
- {"action":"update_transaction","id":"transaction_id","changes":{"amount":20}}
- {"action":"delete_transaction","id":"transaction_id"}

CONTEXTO FINANCEIRO
${financialSummary}

Categorias disponiveis:
${categoriesList || '(nenhuma categoria cadastrada)'}

Transacoes recentes (referencia interna; nao mostrar IDs):
${txList || '(nenhuma transacao)'}

Data de hoje: ${today}
Moeda: ${settings.currency}
${settings.budget > 0 ? `Orcamento mensal definido: ${formatCurrency(settings.budget, settings.currency)}` : 'Sem orcamento mensal definido.'}`;
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
async function queryGroqAssistant(messages, context) {
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
                        text: message.content.trim() || 'Analise a imagem enviada e extraia os dados financeiros relevantes.'
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
            temperature: 0.35,
            ...(lastMessage?.imageDataUrl ? {} : { response_format: { type: 'json_object' } }),
            messages: [
                {
                    role: 'system',
                    content: buildSystemPrompt(context)
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
    const rawReply = (parsed.reply ?? '').toString().trim();
    const cleanReply = rawReply
        .replace(/\(ID:\s*[A-Za-z0-9_-]+\)/g, '')
        .replace(/ID:\s*[A-Za-z0-9_-]{15,}/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return {
        reply: cleanReply || 'Nao consegui entender. Pode reformular?',
        actionObject: parsed.actionObject ?? { action: 'none' }
    };
}
