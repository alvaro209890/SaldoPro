import type { Category, Transaction, PaymentMethod } from '@/types';
import { formatBRL } from '@/utils/formatBRL';

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY || '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';

export type Role = 'user' | 'assistant' | 'system';

export interface ChatMessage {
    role: Role;
    content: string;
    imageBase64?: string;
}

export interface AIActionAdd {
    action: 'add_transaction';
    type: 'income' | 'expense';
    amount: number;
    description: string;
    categoryId: string;
    date: string;
    paymentMethod: PaymentMethod;
}

export interface AIActionUpdate {
    action: 'update_transaction';
    id: string; // The transaction ID
    changes: Partial<Omit<Transaction, 'id' | 'createdAt'>>;
}

export interface AIActionDelete {
    action: 'delete_transaction';
    id: string; // The transaction ID
}

export interface AIActionNone {
    action: 'none';
}

export type AIAction = AIActionAdd | AIActionUpdate | AIActionDelete | AIActionNone;

export interface AIChatResponse {
    message: string;
    parsedAction: AIAction;
}

export async function chatWithAI(
    messages: ChatMessage[],
    categories: Category[],
    recentTransactions: Transaction[]
): Promise<AIChatResponse> {
    if (!GROQ_API_KEY) {
        throw new Error('Chave da API do Groq não configurada.');
    }

    const categoriesList = categories
        .map((c) => `- ID: "${c.id}", Nome: "${c.name}", Tipo: ${c.type}`)
        .join('\n');

    // To help the AI know what transactions exist (for updating/deleting/querying)
    const recentTxList = recentTransactions
        .slice(0, 50) // Limit to avoid massive prompt
        .map(t => `- ID: "${t.id}", Data: ${t.date}, Desc: "${t.description}", Valor: ${t.amount}, Tipo: ${t.type}, CatID: ${t.category}`)
        .join('\n');

    const today = new Date().toISOString().split('T')[0];

    // Build the system prompt with strict JSON structure
    const systemPrompt = `Você é um assistente financeiro pessoal muito amigável chamado SaldoPro AI.
Sua tarefa é ajudar o usuário a controlar suas finanças, respondendo a perguntas sobre seus gastos ("Quanto gastei em Uber?") e também executando ações como adicionar, editar e remover transações.

Você TEM que retornar EXATAMENTE UM JSON válido contendo duas chaves obrigatórias:
1. "reply": Sua resposta amigável em texto para o usuário. (Ex: "Claro, lancei a despesa do almoço para você!"). Use emojis.
2. "actionObject": Um objeto que representa a ação que você quer tomar no aplicativo, baseado no que o usuário pediu.

Regras do "actionObject":
- Se o usuário APENAS perguntar algo ou você não precisar modificar os dados, retorne: {"action": "none"}
- Se o usuário pedir para ADICIONAR uma transação, retorne:
  {"action": "add_transaction", "type": "expense|income", "amount": 15.50, "description": "Lanche", "categoryId": "ID_DA_CATEGORIA", "date": "YYYY-MM-DD", "paymentMethod": "pix|credit|debit|money|other"}
- Se o usuário pedir para ALTERAR/EDITAR (Ex: "Mude o lanche para 20 reais"), ache o ID na lista de recentes e retorne:
  {"action": "update_transaction", "id": "ID_DA_TRANSACAO", "changes": {"amount": 20}}
- Se o usuário pedir para DELETAR/EXCLUIR, ache o ID na lista e retorne:
  {"action": "delete_transaction", "id": "ID_DA_TRANSACAO"}

As categorias disponíveis são:
${categoriesList}

As transações recentes do usuário (últimas 50) são:
${recentTxList}

Data atual do sistema para referência: ${today}.

EXEMPLO PRÁTICO (Adicionando):
Usuário: Comprei um lanche de 50 no pix
Você: {
  "reply": "Lanche anotado! 🍔 Despesa de R$ 50,00 adicionada.",
  "actionObject": {
    "action": "add_transaction",
    "type": "expense",
    "amount": 50,
    "description": "Lanche",
    "categoryId": "alimentacao",
    "date": "${today}",
    "paymentMethod": "pix"
  }
}

EXEMPLO PRÁTICO (Apenas Conversando):
Usuário: Qual meu maior gasto recente?
Você: {
  "reply": "Olhando suas últimas transações, seu maior gasto foi R$ 1500 com o Aluguel no dia 05! 🏠",
  "actionObject": { "action": "none" }
}

NÃO RETORNE NADA ALÉM DO JSON VÁLIDO. SEM MARKDOWN (\`\`\`json).`;

    // Map our messages to Groq's format
    let targetModel = 'llama-3.3-70b-versatile';

    // Check if the VERY LAST message from user has an image. If so, use Vision model
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.imageBase64) {
        targetModel = 'llama-3.2-90b-vision-preview';
    }

    const formattedMessages = messages.map(msg => {
        if (msg.imageBase64) {
            return {
                role: msg.role,
                content: [
                    { type: 'text', text: msg.content || 'Analise a imagem deste comprovante/nota fiscal e extraia os dados.' },
                    { type: 'image_url', image_url: { url: msg.imageBase64 } }
                ]
            };
        }
        return {
            role: msg.role,
            content: msg.content
        };
    });

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            messages: [
                { role: 'system', content: systemPrompt },
                ...formattedMessages
            ],
            model: targetModel,
            temperature: 0.2, // slightly higher for conversational tone, but low enough for JSON structure
            response_format: { type: "json_object" }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Erro na Groq API:', errorText);
        throw new Error('Falha ao comunicar com a inteligência artificial.');
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
        throw new Error('A IA não retornou nenhum dado.');
    }

    try {
        const parsed = JSON.parse(content) as { reply: string, actionObject: AIAction };
        return {
            message: parsed.reply || 'Não entendi direito, pode repetir?',
            parsedAction: parsed.actionObject || { action: 'none' }
        };
    } catch (err) {
        console.error('Erro ao fazer parse do JSON da IA:', content);
        throw new Error('A resposta da inteligência artificial falhou na estruturação geométrica do JSON.');
    }
}
