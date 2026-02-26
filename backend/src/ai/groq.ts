import { env } from '../config/env';
import type { UserCategory, UserTransaction } from '../lib/firestore';

export type PaymentMethod = 'pix' | 'credit' | 'debit' | 'cash' | 'transfer' | 'boleto';

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
  id: string;
  changes: Partial<{
    type: 'income' | 'expense';
    amount: number;
    date: string;
    category: string;
    categoryId: string;
    description: string;
    paymentMethod: PaymentMethod;
  }>;
}

export interface AIActionDelete {
  action: 'delete_transaction';
  id: string;
}

export interface AIActionNone {
  action: 'none';
}

export type AIAction = AIActionAdd | AIActionUpdate | AIActionDelete | AIActionNone;

export interface GroqAssistantResult {
  reply: string;
  actionObject: AIAction;
}

export interface GroqChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  imageDataUrl?: string;
}

function buildSystemPrompt(categories: UserCategory[], recentTransactions: UserTransaction[]): string {
  const categoriesList = categories
    .map((c) => `- ID: "${c.id}", Nome: "${c.name}", Tipo: ${c.type}`)
    .join('\n');

  const txList = recentTransactions
    .slice(0, env.whatsappAiRecentTransactions)
    .map(
      (t) =>
        `- ID: "${t.id}", Data: ${t.date}, Desc: "${t.description}", Valor: ${t.amount}, Tipo: ${t.type}, CatID: ${t.category}`
    )
    .join('\n');

  const today = new Date().toISOString().split('T')[0];

  return `Você é o SaldoPro AI, consultor financeiro pessoal do usuário.
Atue como na aba de IA do site: respostas inteligentes, analíticas e úteis.

Regras obrigatórias:
1) A saída final deve ser EXATAMENTE um JSON válido com:
   - "reply": texto em Markdown (pode usar títulos, listas, negrito e emojis).
   - "actionObject": objeto de ação.
2) Não escreva texto fora do JSON.
3) Se o usuário só fez perguntas/análise, use {"action":"none"}.

Formato aceito para "actionObject":
- {"action":"none"}
- {"action":"add_transaction","type":"expense|income","amount":15.5,"description":"Lanche","categoryId":"id","date":"YYYY-MM-DD","paymentMethod":"pix|credit|debit|cash|transfer|boleto"}
- {"action":"update_transaction","id":"transaction_id","changes":{"amount":20}}
- {"action":"delete_transaction","id":"transaction_id"}

Diretrizes de qualidade da resposta em "reply":
- Seja consultivo, claro e direto.
- Quando possível, traga leitura estratégica dos gastos e sugestões práticas.
- Ao confirmar operações, indique o que foi entendido.

Categorias disponíveis:
${categoriesList || '- (nenhuma categoria)'}

Transações recentes:
${txList || '- (nenhuma transação)'}

Data de referência: ${today}`;
}

function parseAssistantPayload(content: string): Partial<GroqAssistantResult> {
  try {
    return JSON.parse(content) as Partial<GroqAssistantResult>;
  } catch {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(content.slice(start, end + 1)) as Partial<GroqAssistantResult>;
    }
    throw new Error('Groq response is not valid JSON');
  }
}

export async function queryGroqAssistant(
  messages: GroqChatMessage[],
  categories: UserCategory[],
  recentTransactions: UserTransaction[]
): Promise<GroqAssistantResult> {
  if (messages.length === 0) {
    throw new Error('At least one message is required');
  }

  const lastMessage = messages[messages.length - 1];
  const targetModel = lastMessage?.imageDataUrl ? env.groqVisionModel : env.groqModel;

  const formattedMessages = messages.map((message) => {
    if (message.imageDataUrl) {
      return {
        role: message.role,
        content: [
          {
            type: 'text',
            text:
              message.content.trim() ||
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
      Authorization: `Bearer ${env.groqApiKey}`,
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

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Groq did not return content');
  }

  const parsed = parseAssistantPayload(content);
  return {
    reply: (parsed.reply ?? '').toString().trim() || 'Nao consegui entender. Pode reformular?',
    actionObject: (parsed.actionObject as AIAction) ?? { action: 'none' }
  };
}
