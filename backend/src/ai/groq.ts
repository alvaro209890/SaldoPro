import { env } from '../config/env';
import type { UserCategory, UserTransaction, UserSettingsBackend, UserProfileBackend } from '../lib/firestore';

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

export interface UserFinancialContext {
  profile: UserProfileBackend;
  settings: UserSettingsBackend;
  categories: UserCategory[];
  recentTransactions: UserTransaction[];
}

function formatCurrency(value: number, currency: string): string {
  if (currency === 'BRL') return `R$ ${value.toFixed(2).replace('.', ',')}`;
  return `${currency} ${value.toFixed(2)}`;
}

function buildFinancialSummary(transactions: UserTransaction[], settings: UserSettingsBackend): string {
  if (transactions.length === 0) return 'O usuário ainda não possui transações registradas.';

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const monthTx = transactions.filter((t) => t.monthKey === currentMonth);
  const totalIncome = monthTx.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  const totalExpense = monthTx.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
  const balance = totalIncome - totalExpense;

  const lines: string[] = [
    `Mês atual (${currentMonth}):`,
    `  Receitas: ${formatCurrency(totalIncome, settings.currency)}`,
    `  Despesas: ${formatCurrency(totalExpense, settings.currency)}`,
    `  Saldo: ${formatCurrency(balance, settings.currency)}`
  ];

  if (settings.budget > 0) {
    const budgetUsed = totalExpense;
    const budgetRemaining = settings.budget - budgetUsed;
    const budgetPct = ((budgetUsed / settings.budget) * 100).toFixed(1);
    lines.push(`  Orçamento mensal: ${formatCurrency(settings.budget, settings.currency)}`);
    lines.push(`  Gasto do orçamento: ${budgetPct}% (${budgetRemaining >= 0 ? `restam ${formatCurrency(budgetRemaining, settings.currency)}` : `excedido em ${formatCurrency(Math.abs(budgetRemaining), settings.currency)}`})`);
  }

  // Top spending categories this month
  const catSpending = new Map<string, number>();
  for (const t of monthTx.filter((t) => t.type === 'expense')) {
    catSpending.set(t.category, (catSpending.get(t.category) || 0) + t.amount);
  }
  if (catSpending.size > 0) {
    const topCats = [...catSpending.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([catId, amount]) => `  - ${catId}: ${formatCurrency(amount, settings.currency)}`);
    lines.push('  Maiores categorias de gasto:', ...topCats);
  }

  return lines.join('\n');
}

function buildSystemPrompt(context: UserFinancialContext): string {
  const { profile, settings, categories, recentTransactions } = context;

  const userName = profile.displayName?.split(' ')[0] || '';
  const greeting = userName ? `O nome do usuário é *${userName}*.` : '';

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

  const financialSummary = buildFinancialSummary(recentTransactions, settings);
  const today = new Date().toISOString().split('T')[0];

  return `Você é o *SaldoPro*, um assistente financeiro pessoal inteligente que conversa via WhatsApp.
${greeting}

## Sua Personalidade
- Seja **caloroso, amigável e empático** — como um consultor financeiro de confiança, não um robô.
- Use o primeiro nome do usuário naturalmente na conversa quando fizer sentido.
- Dê respostas que mostram que você **entende o contexto financeiro** do usuário.
- Quando o usuário mencionar metas como "quero economizar", "preciso guardar", etc., conecte com o orçamento e gastos reais dele.
- Ao registrar lançamentos, confirme de forma **natural e breve** (ex: "Registrei ✅ — R$ 45,00 em Alimentação").
- **NUNCA** mostre IDs de transação, IDs de categoria ou dados técnicos na resposta ao usuário.
- Use emojis de forma equilibrada e natural, sem exagero.
- Para saudações simples ("oi", "olá", "bom dia"), responda com uma saudação amigável e ofereça um **resumo rápido** da situação financeira atual do mês.
- Quando o usuário perguntar sobre metas, economia ou planejamento, use os dados reais abaixo para dar dicas personalizadas.
- Se o orçamento estiver perto de exceder ou já excedeu, mencione isso proativamente com tom de cuidado (não alarmista).

## Regras Técnicas (obrigatório)
1) Responda SEMPRE com um JSON válido contendo exatamente duas chaves:
   - "reply": texto em Markdown simples para WhatsApp (negrito com *, listas com •).
   - "actionObject": objeto de ação conforme os formatos abaixo.
2) Não escreva NADA fora do JSON. Sem blocos de código, sem texto antes/depois.
3) Quando o usuário mencionar gasto, receita, compra, pagamento ou enviar comprovante/recibo:
   - Use "add_transaction" com os dados extraídos.
   - Escolha o "categoryId" mais adequado das categorias disponíveis.
   - Se não tiver certeza da categoria, use a mais próxima pelo tipo (expense/income).
4) Use {"action":"none"} para conversas, perguntas, análises e saudações.

Formatos de "actionObject":
- {"action":"none"}
- {"action":"add_transaction","type":"expense|income","amount":15.5,"description":"Lanche","categoryId":"id","date":"YYYY-MM-DD","paymentMethod":"pix|credit|debit|cash|transfer|boleto"}
- {"action":"update_transaction","id":"transaction_id","changes":{"amount":20}}
- {"action":"delete_transaction","id":"transaction_id"}

## Contexto Financeiro do Usuário

${financialSummary}

Categorias disponíveis:
${categoriesList || '(nenhuma categoria cadastrada)'}

Transações recentes (para referência interna, NÃO mostre IDs ao usuário):
${txList || '(nenhuma transação)'}

Data de hoje: ${today}
Moeda: ${settings.currency}
${settings.budget > 0 ? `Orçamento mensal definido: ${formatCurrency(settings.budget, settings.currency)}` : 'Sem orçamento mensal definido.'}`;
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
  context: UserFinancialContext
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
      temperature: 0.4,
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

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Groq did not return content');
  }

  const parsed = parseAssistantPayload(content);
  const rawReply = (parsed.reply ?? '').toString().trim();

  // Strip any transaction/category IDs that may leak through despite prompt instructions
  const cleanReply = rawReply
    .replace(/\(ID:\s*[A-Za-z0-9_-]+\)/g, '')
    .replace(/ID:\s*[A-Za-z0-9_-]{15,}/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    reply: cleanReply || 'Não consegui entender. Pode reformular? 🤔',
    actionObject: (parsed.actionObject as AIAction) ?? { action: 'none' }
  };
}

