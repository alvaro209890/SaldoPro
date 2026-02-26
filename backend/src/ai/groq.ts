import { env } from '../config/env';
import { logger } from '../lib/logger';
import type { UserCategory, UserProfileBackend, UserSettingsBackend, UserTransaction } from '../lib/firestore';

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
  isFirstMessage?: boolean;
  isGreeting?: boolean;
  isCapabilitiesQuestion?: boolean;
  isConversationRestart?: boolean;
  shouldSendCapabilitiesSummary?: boolean;
}

function formatCurrency(value: number, currency: string): string {
  if (currency === 'BRL') return `R$ ${value.toFixed(2).replace('.', ',')}`;
  return `${currency} ${value.toFixed(2)}`;
}

function buildFinancialSummary(transactions: UserTransaction[], settings: UserSettingsBackend): string {
  if (transactions.length === 0) return 'O usuario ainda nao possui transacoes registradas.';

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const monthTx = transactions.filter((t) => t.monthKey === currentMonth);
  const totalIncome = monthTx.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  const totalExpense = monthTx.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
  const balance = totalIncome - totalExpense;

  const lines: string[] = [
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
    lines.push(
      `  Uso do orcamento: ${budgetPct}% (${budgetRemaining >= 0 ? `restam ${formatCurrency(budgetRemaining, settings.currency)}` : `excedido em ${formatCurrency(Math.abs(budgetRemaining), settings.currency)}`})`
    );
  }

  return lines.join('\n');
}

/** Max transactions to embed in the system prompt (keeps token usage reasonable). */
const PROMPT_TX_LIMIT = 15;

function buildSystemPrompt(context: UserFinancialContext): string {
  const { profile, settings, categories, recentTransactions } = context;

  const userName = profile.displayName?.split(' ')[0] || '';
  const userInfo = userName ? `Nome do usuario: ${userName}.` : 'Nome do usuario: nao informado.';

  const shouldSendSummary = Boolean(
    context.shouldSendCapabilitiesSummary ||
    context.isFirstMessage ||
    context.isGreeting ||
    context.isCapabilitiesQuestion ||
    context.isConversationRestart
  );

  const categoriesList = categories
    .map((c) => `- ID: "${c.id}", Nome: "${c.name}", Tipo: ${c.type}`)
    .join('\n');

  const txList = recentTransactions
    .slice(0, PROMPT_TX_LIMIT)
    .map(
      (t) =>
        `- ID: "${t.id}", Data: ${t.date}, Desc: "${t.description}", Valor: ${t.amount}, Tipo: ${t.type}, CatID: ${t.category}`
    )
    .join('\n');

  const txNote = recentTransactions.length > PROMPT_TX_LIMIT
    ? `\n(mostrando ${PROMPT_TX_LIMIT} de ${recentTransactions.length} transacoes recentes)`
    : '';

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
- Pode escrever respostas mais completas no WhatsApp quando isso ajudar o usuario.
- Em duvidas, orientacoes e analises, prefira 4 a 12 linhas com estrutura clara.
- Quando o usuario pedir detalhe, passo a passo ou explicacao, pode estender para ate 16 linhas.
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
${txList || '(nenhuma transacao)'}${txNote}

Data de hoje: ${today}
Moeda: ${settings.currency}
${settings.budget > 0 ? `Orcamento mensal definido: ${formatCurrency(settings.budget, settings.currency)}` : 'Sem orcamento mensal definido.'}`;
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

/**
 * Validates that a parsed actionObject has the correct field types.
 * Returns a sanitized action or falls back to { action: 'none' }.
 */
function validateAction(raw: unknown): AIAction {
  if (!raw || typeof raw !== 'object') return { action: 'none' };

  const obj = raw as Record<string, unknown>;
  const action = obj.action;

  if (action === 'add_transaction') {
    const type = obj.type;
    const amount = Number(obj.amount);
    const description = typeof obj.description === 'string' ? obj.description : '';
    const categoryId = typeof obj.categoryId === 'string' ? obj.categoryId : '';
    const date = typeof obj.date === 'string' ? obj.date : '';
    const paymentMethod = typeof obj.paymentMethod === 'string' ? obj.paymentMethod : 'pix';

    if (type !== 'income' && type !== 'expense') return { action: 'none' };
    if (!Number.isFinite(amount) || amount <= 0) return { action: 'none' };

    return {
      action: 'add_transaction',
      type,
      amount,
      description,
      categoryId,
      date,
      paymentMethod: paymentMethod as PaymentMethod
    };
  }

  if (action === 'update_transaction') {
    const id = typeof obj.id === 'string' ? obj.id : '';
    if (!id) return { action: 'none' };
    const changes = typeof obj.changes === 'object' && obj.changes !== null ? obj.changes : {};
    return { action: 'update_transaction', id, changes } as AIActionUpdate;
  }

  if (action === 'delete_transaction') {
    const id = typeof obj.id === 'string' ? obj.id : '';
    if (!id) return { action: 'none' };
    return { action: 'delete_transaction', id };
  }

  return { action: 'none' };
}

/** Determines if the HTTP status code is retryable (429 or 5xx). */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function queryGroqAssistant(
  messages: GroqChatMessage[],
  context: UserFinancialContext
): Promise<GroqAssistantResult> {
  if (messages.length === 0) {
    throw new Error('At least one message is required');
  }

  const lastMessage = messages[messages.length - 1];
  const isVisionRequest = Boolean(lastMessage?.imageDataUrl);
  const targetModel = isVisionRequest ? env.groqVisionModel : env.groqModel;

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

  const requestBody = JSON.stringify({
    model: targetModel,
    temperature: 0.5,
    ...(isVisionRequest ? {} : { response_format: { type: 'json_object' } }),
    messages: [
      {
        role: 'system',
        content: buildSystemPrompt(context)
      },
      ...formattedMessages
    ]
  });

  // --- Retry loop with timeout ---
  let lastError: unknown;

  for (let attempt = 1; attempt <= env.groqMaxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), env.groqTimeoutMs);

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.groqApiKey}`,
          'Content-Type': 'application/json'
        },
        body: requestBody,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const detail = await response.text();

        if (isRetryableStatus(response.status) && attempt < env.groqMaxRetries) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
          logger.warn('Groq request failed, retrying', {
            status: response.status,
            attempt,
            backoffMs,
            detail: detail.slice(0, 200)
          });
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }

        throw new Error(`Groq request failed: ${response.status} ${detail}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Groq did not return content');
      }

      // --- Parse response (with vision fallback) ---
      let parsed: Partial<GroqAssistantResult>;
      try {
        parsed = parseAssistantPayload(content);
      } catch {
        if (isVisionRequest) {
          // Vision model may return plain text instead of JSON — use it as the reply
          logger.warn('Groq vision response is not valid JSON, using raw content as reply', {
            contentPreview: content.slice(0, 100)
          });
          return {
            reply: content.trim().slice(0, env.maxMessageLength),
            actionObject: { action: 'none' }
          };
        }
        throw new Error('Groq response is not valid JSON');
      }

      const rawReply = (parsed.reply ?? '').toString().trim();

      const cleanReply = rawReply
        .replace(/\(ID:\s*[A-Za-z0-9_-]+\)/g, '')
        .replace(/ID:\s*[A-Za-z0-9_-]{15,}/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      return {
        reply: cleanReply || 'Nao consegui entender. Pode reformular?',
        actionObject: validateAction(parsed.actionObject)
      };
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;

      const isAbort = error instanceof Error && error.name === 'AbortError';

      if (isAbort) {
        logger.warn('Groq request timed out', { attempt, timeoutMs: env.groqTimeoutMs });
      }

      if (attempt < env.groqMaxRetries) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
        logger.warn('Groq request error, retrying', {
          attempt,
          backoffMs,
          error: error instanceof Error ? error.message : 'unknown'
        });
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
    }
  }

  // --- Groq failed after all retries, try Gemini fallback ---
  if (env.geminiApiKey) {
    logger.warn('Groq failed after retries, falling back to Gemini', {
      error: lastError instanceof Error ? lastError.message : 'unknown'
    });
    try {
      return await queryGeminiAssistant(messages, context);
    } catch (geminiError) {
      logger.error('Gemini fallback also failed', geminiError);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Groq request failed after retries');
}

/**
 * Fallback to Gemini 2.5 Flash when Groq is unavailable.
 * Uses Google's Generative Language API format.
 */
async function queryGeminiAssistant(
  messages: GroqChatMessage[],
  context: UserFinancialContext
): Promise<GroqAssistantResult> {
  const systemPrompt = buildSystemPrompt(context);
  const lastMessage = messages[messages.length - 1];
  const isVisionRequest = Boolean(lastMessage?.imageDataUrl);

  // Convert messages to Gemini format
  const geminiContents: Array<{ role: string; parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }> = [];

  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

    if (msg.content) {
      parts.push({ text: msg.content });
    }

    if (msg.imageDataUrl) {
      // Extract base64 and mime type from data URL
      const match = msg.imageDataUrl.match(/^data:(.+?);base64,(.+)$/);
      if (match) {
        parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
      }
    }

    if (parts.length > 0) {
      geminiContents.push({ role, parts });
    }
  }

  const geminiBody = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: geminiContents,
    generationConfig: {
      temperature: 0.5,
      ...(isVisionRequest ? {} : { responseMimeType: 'application/json' })
    }
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), env.groqTimeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: geminiBody,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Gemini request failed: ${response.status} ${detail.slice(0, 300)}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw new Error('Gemini did not return content');
    }

    logger.info('Gemini fallback succeeded', { contentLength: content.length });

    // Parse response (same logic as Groq)
    let parsed: Partial<GroqAssistantResult>;
    try {
      parsed = parseAssistantPayload(content);
    } catch {
      if (isVisionRequest) {
        return {
          reply: content.trim().slice(0, env.maxMessageLength),
          actionObject: { action: 'none' }
        };
      }
      // Try to use raw content as reply
      return {
        reply: content.trim().slice(0, env.maxMessageLength),
        actionObject: { action: 'none' }
      };
    }

    const rawReply = (parsed.reply ?? '').toString().trim();
    const cleanReply = rawReply
      .replace(/\(ID:\s*[A-Za-z0-9_-]+\)/g, '')
      .replace(/ID:\s*[A-Za-z0-9_-]{15,}/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return {
      reply: cleanReply || 'Nao consegui entender. Pode reformular?',
      actionObject: validateAction(parsed.actionObject)
    };
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}
