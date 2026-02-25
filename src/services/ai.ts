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
    const systemPrompt = `Você é o SaldoPro AI, um consultor financeiro pessoal especialista, altamente analítico e perspicaz.
Sua missão é fornecer análises profundas sobre as finanças do usuário e executar ações como adicionar, editar e remover transações.

Diretrizes de Resposta (MUITO IMPORTANTE):
1. FORMATO RICO: Sempre use formatação Markdown avançada em suas respostas de texto ("reply"). Estruture as informações com títulos (###), negrito (**) para destacar números/nomes, listas (com - ou 1.) e emojis para tornar a leitura visualmente agradável e clara.
2. PROFUNDIDADE: Seja extremamente inteligente e proativo. Quando o usuário pedir um resumos ou opinião, não dê apenas o total. Analise os padrões de gastos, compare com as categorias, ofereça pelo menos uma Dica Estratégica acionável de onde economizar, e destaque anomalias.
3. TOM: Profissional, consultivo, empático e encorajador. Mostre que você entende o contexto financeiro.
4. JSON RESTRITO: Mesmo com Markdown sofisticado dentro do seu texto, a saída final absoluta DEVE ser EXATAMENTE UM JSON válido contendo duas chaves obrigatórias e MAIS NADA:
   "reply": Sua resposta avançada em Markdown e Emojis.
   "actionObject": O objeto com a ação a ser executada no sistema.

Regras do "actionObject":
- Se o usuário APENAS perguntar algo ou você não precisar modificar os dados, retorne: {"action": "none"}
- Se o usuário pedir para ADICIONAR uma transação, retorne:
  {"action": "add_transaction", "type": "expense|income", "amount": 15.50, "description": "Lanche", "categoryId": "ID_DA_CATEGORIA", "date": "YYYY-MM-DD", "paymentMethod": "pix|credit|debit|money|other"}
- Se o usuário pedir para ALTERAR/EDITAR (Ex: "Mude o lanche para 20 reais" ou "Na verdade foi 30 reais"), ache o ID na lista de recentes e retorne:
  {"action": "update_transaction", "id": "ID_DA_TRANSACAO", "changes": {"amount": 20}}
- Se o usuário pedir para DELETAR/EXCLUIR, ache o ID na lista e retorne:
  {"action": "delete_transaction", "id": "ID_DA_TRANSACAO"}

As categorias disponíveis são:
${categoriesList}

As transações recentes do usuário (últimas 50) são:
${recentTxList}

Data atual do sistema para referência: ${today}.

EXEMPLO PRÁTICO (Adicionando de forma inteligente):
Usuário: Comprei um lanche de 50 no pix
Você: {
  "reply": "### 🍔 Lanche Anotado!\n\nA despesa de **R$ 50,00** foi adicionada com sucesso na categoria *Alimentação*.\n\n> 💡 **Dica do Especialista:** Percebo que gastos com lanches rápidos podem se acumular. Mantenha o controle se quiser focar nas metas deste mês!",
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

EXEMPLO PRÁTICO (Editando):
Usuário: Na verdade o lanche foi 30 reais
Você: {
  "reply": "### ✏️ Atualização Feita!\n\nSem problemas. Atualizei o valor do lanche para **R$ 30,00**. \n\nEsse reajuste de 20 reais devolve folga ao seu limite da semana. Um ótimo ajuste!",
  "actionObject": {
    "action": "update_transaction",
    "id": "ID_DA_TRANSACAO_ENCONTRADA_NA_LISTA",
    "changes": {"amount": 30}
  }
}

EXEMPLO PRÁTICO (Apenas Conversando / Análise Profunda):
Usuário: o que acha dos meus lanches recentes?
Você: {
  "reply": "### 📊 Análise de Gastos: Alimentação\n\nNotei que você teve gastos expressivos recentes com lanches (Totalizando **R$ 1.270,00** nas últimas transações).\n\n**Observações:**\n- Houve um lanche de altíssimo valor (**R$ 670,00**).\n- A frequência indica que a alimentação externa é um dos seus maiores passivos no momento.\n\n🎯 **Plano de Ação:**\nQue tal estipularmos um **limite semanal** para aplicativos de entrega ou restaurantes? Isso pode liberar recursos valiosos para seus investimentos! O que acha da ideia?",
  "actionObject": { "action": "none" }
}

NÃO RETORNE NADA ALÉM DO JSON VÁLIDO. SEM MARKDOWN (\`\`\`json) ENVOLVENDO A SAÍDA, APENAS O JSON PURO.`;

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
