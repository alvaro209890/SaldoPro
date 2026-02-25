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

  return `Voce e um assistente financeiro do SaldoPro que conversa por WhatsApp.
Responda de forma curta, direta e util em portugues.

Retorne EXATAMENTE um JSON valido com:
1) "reply": texto para responder no WhatsApp
2) "actionObject": objeto de acao

Acoes validas:
- {"action":"none"}
- {"action":"add_transaction","type":"expense|income","amount":15.5,"description":"Lanche","categoryId":"id","date":"YYYY-MM-DD","paymentMethod":"pix|credit|debit|cash|transfer|boleto"}
- {"action":"update_transaction","id":"transaction_id","changes":{"amount":20}}
- {"action":"delete_transaction","id":"transaction_id"}

Categorias disponiveis:
${categoriesList || '- (nenhuma categoria)'}

Transacoes recentes:
${txList || '- (nenhuma transacao)'}

Data de referencia: ${today}

Se o usuario nao pediu alteracao, use action=none.
Nao use markdown. Nao inclua texto fora do JSON.`;
}

export async function queryGroqAssistant(
  userText: string,
  categories: UserCategory[],
  recentTransactions: UserTransaction[]
): Promise<GroqAssistantResult> {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.groqApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: env.groqModel,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: buildSystemPrompt(categories, recentTransactions)
        },
        {
          role: 'user',
          content: userText
        }
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

  const parsed = JSON.parse(content) as Partial<GroqAssistantResult>;
  return {
    reply: (parsed.reply ?? '').toString().trim() || 'Nao consegui entender. Pode reformular?',
    actionObject: (parsed.actionObject as AIAction) ?? { action: 'none' }
  };
}

