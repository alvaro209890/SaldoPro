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
  audioDataUrl?: string;
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

/**
 * Determines whether the current message is a simple conversational turn
 * (greeting, capabilities question, first message, conversation restart)
 * that does NOT need the full transaction list or detailed categories.
 * This keeps token usage low for lightweight interactions.
 */
function isLightweightContext(context: UserFinancialContext): boolean {
  return Boolean(
    context.isGreeting ||
    context.isFirstMessage ||
    context.isCapabilitiesQuestion ||
    context.isConversationRestart ||
    context.shouldSendCapabilitiesSummary
  );
}

function buildSystemPrompt(context: UserFinancialContext): string {
  const { profile, settings, categories, recentTransactions } = context;

  const userName = profile.displayName?.split(' ')[0] || '';
  const userInfo = userName ? `Nome do usuario: ${userName}.` : 'Nome do usuario: nao informado.';

  const lightweight = isLightweightContext(context);

  const shouldSendSummary = lightweight;

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

  // --- Financial context section (lightweight vs full) ---
  let financialContextBlock: string;

  if (lightweight) {
    // For greetings / capability questions: only include a brief summary, no tx list
    const financialSummary = buildFinancialSummary(recentTransactions, settings);
    const categoryNames = categories.map((c) => c.name).join(', ');

    financialContextBlock = `CONTEXTO FINANCEIRO (resumido)
${financialSummary}

Categorias disponiveis: ${categoryNames || '(nenhuma)'}

Data de hoje: ${today}
Moeda: ${settings.currency}
${settings.budget > 0 ? `Orcamento mensal definido: ${formatCurrency(settings.budget, settings.currency)}` : 'Sem orcamento mensal definido.'}`;
  } else {
    // Full context: categories with IDs + recent transactions for edit/delete operations
    const financialSummary = buildFinancialSummary(recentTransactions, settings);

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

    financialContextBlock = `CONTEXTO FINANCEIRO
${financialSummary}

Categorias disponiveis:
${categoriesList || '(nenhuma categoria cadastrada)'}

Transacoes recentes (referencia interna; nao mostrar IDs):
${txList || '(nenhuma transacao)'}${txNote}

Data de hoje: ${today}
Moeda: ${settings.currency}
${settings.budget > 0 ? `Orcamento mensal definido: ${formatCurrency(settings.budget, settings.currency)}` : 'Sem orcamento mensal definido.'}`;
  }

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
- Pode escrever respostas mais completas no WhatsApp quando isso ajudar o usuario.
- Em duvidas, orientacoes e analises, prefira 4 a 12 linhas com estrutura clara.
- Nunca exiba IDs tecnicos para o usuario.

COMPREENSAO DE LINGUAGEM NATURAL
- O usuario pode escrever de forma informal, com erros de digitacao ou abreviacoes. Interprete com boa vontade.
- VERBOS DE ACAO = REGISTRAR AUTOMATICAMENTE (use add_transaction, NAO pergunte se quer registrar):
  - "gastei 50 no mercado" = registrar despesa de R$50 em supermercado
  - "recebi 1500" = registrar receita de R$1500
  - "paguei 200 de luz" = registrar despesa de R$200 em conta de luz
  - "comprei um lanche por 25" = registrar despesa de R$25 em alimentacao
  - "recebi meu salario de 2100" = registrar receita de R$2100 (salario)
  - "ganhei 500 de freelance" = registrar receita de R$500
- FRASES INFORMATIVAS = NAO registrar (use action "none"):
  - "minhas despesas sao de 800 reais" = informacao, responda com analise
  - "meu salario e 3000" = informacao contextual, NAO transacao
  - "quanto gastei esse mes?" = pergunta, responda com resumo
- REGRA: quando o usuario usa verbos no passado (gastei, paguei, comprei, recebi, ganhei) com um valor, SEMPRE registre automaticamente. Nao pergunte "quer registrar?". Apenas registre e confirme.

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
1) Retorne SEMPRE um JSON valido com exatamente duas chaves:
   - "reply": string com texto para WhatsApp.
   - "actionObject": objeto com uma das acoes abaixo.
2) Nao escreva nada antes nem depois do JSON. A resposta inteira deve ser o JSON.
3) Para registrar gasto/receita: use "add_transaction". Quando o usuario usa verbos de acao no passado (gastei, paguei, comprei, recebi, ganhei) com valor, REGISTRE AUTOMATICAMENTE sem perguntar.
4) Para conversas gerais, duvidas, orientacoes e informacoes: use {"action":"none"}.
5) Se faltar o VALOR (nao a categoria ou data), pergunte no "reply" e use action none. Se faltar categoria, escolha a mais adequada. Se faltar data, use hoje.
6) NUNCA registre transacao quando o usuario usa frases descritivas/informativas ('minhas despesas sao', 'meu gasto mensal e', 'tenho de conta').

FORMATOS DE ACTIONOBJECT
- {"action":"none"}
- {"action":"add_transaction","type":"expense|income","amount":15.5,"description":"Lanche","categoryId":"id","date":"YYYY-MM-DD","paymentMethod":"pix|credit|debit|cash|transfer|boleto"}
- {"action":"update_transaction","id":"transaction_id","changes":{"amount":20}}
- {"action":"delete_transaction","id":"transaction_id"}

EXEMPLO DE RESPOSTA (formato exato):
{"reply":"Lancamento registrado! Despesa de R$ 50,00 em Alimentacao.","actionObject":{"action":"add_transaction","type":"expense","amount":50,"description":"Mercado","categoryId":"alimentacao","date":"${today}","paymentMethod":"pix"}}

${financialContextBlock}`;
}

function parseAssistantPayload(content: string): Partial<GroqAssistantResult> {
  // Remove markdown code fences if present (```json ... ```)
  let cleaned = content.trim();
  // Handle both single and multiple backtick fences
  cleaned = cleaned.replace(/^```+(?:json)?\s*/i, '').replace(/\s*```+$/i, '').trim();

  try {
    return JSON.parse(cleaned) as Partial<GroqAssistantResult>;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as Partial<GroqAssistantResult>;
    }
    throw new Error('Response is not valid JSON');
  }
}

/**
 * Safety net: if `text` looks like a raw JSON object containing a `reply` field,
 * extract just the reply text. This prevents leaking raw JSON to users.
 */
function sanitizeReply(text: string): string {
  const trimmed = text.trim();
  // Quick bail if it doesn't look like JSON
  if (!trimmed.startsWith('{')) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.reply === 'string' && parsed.reply.length > 0) {
      return parsed.reply.trim();
    }
  } catch {
    // Not valid JSON — return as-is
  }
  return trimmed;
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

/**
 * Ordered list of Groq models to try. When one hits rate limit (429),
 * the next model in the chain is attempted automatically.
 * Vision-capable models are marked with `vision: true`.
 */
const GROQ_MODEL_CHAIN = [
  { id: 'llama-3.3-70b-versatile', vision: false },
  { id: 'meta-llama/llama-4-scout-17b-16e-instruct', vision: true },
  { id: 'qwen/qwen3-32b', vision: false },
  { id: 'moonshotai/kimi-k2-instruct-0905', vision: false },
  { id: 'openai/gpt-oss-20b', vision: false }
];

/**
 * Strip thinking/reasoning blocks that some models emit (e.g. Qwen 3, DeepSeek).
 * These appear as <think>...</think> tags wrapping internal chain-of-thought.
 */
function stripThinkingBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/** Remove internal IDs and excess whitespace from AI replies before sending to user. */
function cleanAiReply(raw: string): string {
  return raw
    .replace(/\(ID:\s*[A-Za-z0-9_-]+\)/g, '')
    .replace(/ID:\s*[A-Za-z0-9_-]{15,}/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Determines if the HTTP status code means we should try the next model (429) or retry same (5xx). */
function isRateLimitStatus(status: number): boolean {
  return status === 429;
}

function isServerErrorStatus(status: number): boolean {
  return status >= 500;
}

/**
 * Attempt a single Groq model call. Returns the result or throws.
 */
async function callGroqModel(
  modelId: string,
  systemPrompt: string,
  formattedMessages: Array<Record<string, unknown>>,
  isVisionRequest: boolean
): Promise<GroqAssistantResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), env.groqTimeoutMs);
  const startTime = Date.now();

  try {
    const requestBody = JSON.stringify({
      model: modelId,
      temperature: 0.5,
      ...(isVisionRequest ? {} : { response_format: { type: 'json_object' } }),
      messages: [
        { role: 'system', content: systemPrompt },
        ...formattedMessages
      ]
    });

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
      const err = new Error(`Groq request failed: ${response.status} ${detail.slice(0, 300)}`);
      (err as Error & { statusCode: number }).statusCode = response.status;
      throw err;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new Error('Groq did not return content');
    }

    // Strip thinking blocks from models that use chain-of-thought
    const content = stripThinkingBlocks(rawContent);
    const elapsedMs = Date.now() - startTime;

    // --- Parse response (with vision fallback) ---
    let parsed: Partial<GroqAssistantResult>;
    try {
      parsed = parseAssistantPayload(content);
    } catch {
      if (isVisionRequest) {
        logger.warn('Groq vision response is not valid JSON, using raw content as reply', {
          model: modelId,
          contentPreview: content.slice(0, 100)
        });
        return {
          reply: sanitizeReply(content).slice(0, env.maxMessageLength),
          actionObject: { action: 'none' }
        };
      }
      throw new Error('Groq response is not valid JSON');
    }

    const reply = cleanAiReply(sanitizeReply((parsed.reply ?? '').toString()));
    const finalAction = validateAction(parsed.actionObject);

    logger.info('Groq model response parsed successfully', {
      model: modelId,
      elapsedMs,
      actionType: finalAction.action,
      replyLength: reply.length
    });

    return {
      reply: reply || 'Nao consegui entender. Pode reformular?',
      actionObject: finalAction
    };
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export async function queryGroqAssistant(
  messages: GroqChatMessage[],
  context: UserFinancialContext
): Promise<GroqAssistantResult> {
  if (messages.length === 0) {
    throw new Error('At least one message is required');
  }

  // --- CHECK REQUEST TYPE ---
  const lastMessage = messages[messages.length - 1];
  const isVisionRequest = Boolean(lastMessage?.imageDataUrl);
  const isAudioRequest = Boolean(lastMessage?.audioDataUrl);

  // --- AUDIO REQUESTS: Fast-path to Gemini (Groq does not support conversational audio) ---
  if (isAudioRequest) {
    if (!env.geminiApiKey) {
      throw new Error('Transcricao e analise de audio indisponivel. Configure a chave do Gemini.');
    }
    logger.info('Audio request detected, bypassing Groq and routing directly to Gemini.');
    return queryGeminiAssistant(messages, context);
  }

  // --- PREPARE GROQ MESSAGES ---
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
    return { role: message.role, content: message.content };
  });

  const systemPrompt = buildSystemPrompt(context);

  // Filter models: for vision requests, only use vision-capable models
  const modelsToTry = isVisionRequest
    ? GROQ_MODEL_CHAIN.filter((m) => m.vision)
    : GROQ_MODEL_CHAIN;

  let lastGroqError: unknown;

  // --- PRIMARY: Try all Groq models in chain ---
  for (const model of modelsToTry) {
    try {
      logger.info('Groq: trying model', { model: model.id, isVisionRequest });
      const result = await callGroqModel(model.id, systemPrompt, formattedMessages, isVisionRequest);
      logger.info('Groq: model succeeded', { model: model.id });
      return result;
    } catch (error) {
      lastGroqError = error;
      const statusCode = (error as Error & { statusCode?: number }).statusCode;
      const errorMsg = error instanceof Error ? error.message : 'unknown';

      if (isRateLimitStatus(statusCode ?? 0)) {
        logger.warn('Groq: model rate-limited (429), trying next model', {
          model: model.id,
          detail: errorMsg.slice(0, 200)
        });
        continue;
      }

      if (isServerErrorStatus(statusCode ?? 0)) {
        logger.warn('Groq: model server error, trying next model', {
          model: model.id,
          status: statusCode,
          detail: errorMsg.slice(0, 200)
        });
        continue;
      }

      const isAbort = error instanceof Error && error.name === 'AbortError';
      if (isAbort) {
        logger.warn('Groq: model timed out, trying next model', {
          model: model.id,
          timeoutMs: env.groqTimeoutMs
        });
        continue;
      }

      // Non-retryable error — try next model anyway
      logger.warn('Groq: model failed with non-retryable error, trying next model', {
        model: model.id,
        error: errorMsg.slice(0, 200)
      });
      continue;
    }
  }

  // --- FALLBACK: Gemini (if configured) ---
  if (env.geminiApiKey) {
    logger.warn('All Groq models exhausted, falling back to Gemini', {
      lastError: lastGroqError instanceof Error ? lastGroqError.message : 'unknown'
    });
    try {
      return await queryGeminiAssistant(messages, context);
    } catch (geminiError) {
      logger.error('Gemini fallback also failed', {
        error: geminiError instanceof Error ? geminiError.message : 'unknown'
      });
    }
  }

  throw lastGroqError instanceof Error
    ? lastGroqError
    : new Error('AI request failed: all Groq models and Gemini exhausted');
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

    if (msg.audioDataUrl) {
      const match = msg.audioDataUrl.match(/^data:(.+?);base64,(.+)$/);
      if (match) {
        parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
      }
    }

    if (parts.length > 0) {
      geminiContents.push({ role, parts });
    }
  }

  const hasMedia = isVisionRequest || Boolean(lastMessage?.audioDataUrl);
  const geminiBody = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: geminiContents,
    generationConfig: {
      temperature: 0.5,
      ...(hasMedia ? {} : { responseMimeType: 'application/json' })
    }
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), env.groqTimeoutMs);
  const startTime = Date.now();

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
    const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawContent) {
      throw new Error('Gemini did not return content');
    }

    // Strip any thinking blocks
    const content = stripThinkingBlocks(rawContent);
    const elapsedMs = Date.now() - startTime;

    logger.info('Gemini primary succeeded', { model: env.geminiModel, contentLength: content.length, elapsedMs });

    // Parse response (same logic as Groq)
    let parsed: Partial<GroqAssistantResult>;
    try {
      parsed = parseAssistantPayload(content);
    } catch {
      // Couldn't parse as JSON — treat raw content as reply but sanitize first
      const fallbackReply = sanitizeReply(content).trim().slice(0, env.maxMessageLength);
      logger.warn('Gemini response not parseable as JSON, using sanitized fallback', {
        contentPreview: content.slice(0, 80)
      });
      return {
        reply: fallbackReply || 'Nao consegui entender. Pode reformular?',
        actionObject: { action: 'none' }
      };
    }

    const reply = cleanAiReply(sanitizeReply((parsed.reply ?? '').toString()));
    const finalAction = validateAction(parsed.actionObject);

    logger.info('Gemini response parsed successfully', {
      model: env.geminiModel,
      elapsedMs,
      actionType: finalAction.action,
      replyLength: reply.length
    });

    return {
      reply: reply || 'Nao consegui entender. Pode reformular?',
      actionObject: finalAction
    };
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}
