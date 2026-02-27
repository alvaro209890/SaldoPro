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

export interface AIActionAddRecurring {
  action: 'add_recurring_transaction';
  type: 'income' | 'expense';
  amount: number;
  description: string;
  categoryId: string;
  date: string;
  paymentMethod: PaymentMethod;
  frequency: 'weekly' | 'monthly' | 'yearly';
  endDate?: string | null;
}

export interface AIActionNone {
  action: 'none';
}

export type AIAction = AIActionAdd | AIActionUpdate | AIActionDelete | AIActionAddRecurring | AIActionNone;

export interface GroqAssistantResult {
  reply: string;
  actionObjects: AIAction[];
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

type PromptMode = 'compact_query' | 'full_financial';

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

/**
 * Detects whether the last user message is a query/conversation that does NOT
 * require action capabilities (add/update/delete transactions).
 * When true, a compact system prompt is used to save tokens.
 */
function isQueryOnlyIntent(messages: GroqChatMessage[], context: UserFinancialContext): boolean {
  // Media messages always need the full prompt
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || lastMsg.imageDataUrl || lastMsg.audioDataUrl) return false;

  // Greetings/first messages are conversational and should use compact mode
  if (isLightweightContext(context)) return true;

  const text = lastMsg.content
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  if (!text) return false;

  // Action verbs → needs full prompt
  if (/\b(gastei|paguei|comprei|recebi|ganhei|registr|lanca|adiciona|coloca|bota|paga|gasta|receb|todo mes|toda semana|mensal|semanal|anual|edita|altera|muda|exclui|delet|apaga|remove)\b/.test(text)) {
    return false;
  }

  // Explicit query patterns → compact prompt
  if (/\b(quanto|qual|quais|como|onde|quando|quem|porque|por ?que|mostr|resum|saldo|total|relat|analise|dica|conselho|sugest|explica|ajuda|me fala|me diz|me conta)\b/.test(text)) {
    return true;
  }

  // Short messages without numbers are likely conversational
  if (text.length < 60 && !/\d/.test(text)) return true;

  return false;
}

function detectPromptMode(messages: GroqChatMessage[], context: UserFinancialContext): PromptMode {
  return isQueryOnlyIntent(messages, context) ? 'compact_query' : 'full_financial';
}

function buildPromptByMode(mode: PromptMode, context: UserFinancialContext): string {
  return mode === 'compact_query' ? buildCompactSystemPrompt(context) : buildSystemPrompt(context);
}

function enforceActionByPromptMode(actions: AIAction[], mode: PromptMode): AIAction[] {
  if (mode === 'compact_query') {
    return [{ action: 'none' }];
  }
  return actions.length > 0 ? actions : [{ action: 'none' }];
}

/**
 * Compact system prompt for query-only messages.
 * No action formats, no transaction IDs, just financial summary + reply instructions.
 */
function buildCompactSystemPrompt(context: UserFinancialContext): string {
  const { profile, settings, categories, recentTransactions } = context;

  const userName = profile.displayName?.split(' ')[0] || '';
  const userInfo = userName ? `Nome do usuario: ${userName}.` : '';
  const today = new Date().toISOString().split('T')[0];

  const financialSummary = buildFinancialSummary(recentTransactions, settings);
  const categoryNames = categories.map((c) => c.name).join(', ');

  return `Voce e o SaldoPro, assistente financeiro pessoal via WhatsApp.
${userInfo}

Responda a pergunta ou duvida do usuario com base no contexto financeiro abaixo.
Seja natural, objetivo e util. Nao inclua IDs tecnicos.

${financialSummary}

Categorias: ${categoryNames || '(nenhuma)'}
Data de hoje: ${today}
Moeda: ${settings.currency}
${settings.budget > 0 ? `Orcamento mensal: ${formatCurrency(settings.budget, settings.currency)}` : ''}

FORMATO: Retorne SEMPRE um JSON valido com exatamente duas chaves:
{"reply":"sua resposta aqui","actionObjects":[{"action":"none"}]}`;
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
- SE A MENSAGEM TIVER IMAGEM/COMPROVANTE: analise a imagem e extraia valor, data, forma de pagamento e descricao.
- NUNCA diga "nao consigo ver/visualizar imagem" quando houver imagem enviada.
- Se houver valor identificado no comprovante, registre automaticamente a transacao (add_transaction), mesmo sem categoria explicita.
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
- TRANSACOES RECORRENTES: quando o usuario mencionar frequencia, use "add_recurring_transaction" em vez de "add_transaction":
  - Palavras-chave: "todo mes", "toda semana", "mensal", "semanal", "anual", "todo ano", "semanalmente", "mensalmente", "por mes", "por semana"
  - "pago 500 de aluguel todo mes" = add_recurring_transaction, frequency "monthly"
  - "gasto 50 por semana no transporte" = add_recurring_transaction, frequency "weekly"
  - "recebo 3000 de salario mensalmente" = add_recurring_transaction, frequency "monthly"
  - "pago 1200 de seguro por ano" = add_recurring_transaction, frequency "yearly"

REGRAS DE RESUMO DE CAPACIDADES
- ${summaryInstruction}
- ${greetingInstruction}
- ${capabilitiesQuestionInstruction}

QUANDO RESUMIR CAPACIDADES, PRIORIZE ESTES ITENS
- Registrar despesas e receitas por texto.
- Criar transacoes recorrentes (mensal, semanal, anual) para gastos fixos.
- Ler comprovante/recibo em imagem e sugerir ou registrar lancamento.
- Mostrar resumo do mes (receitas, despesas e saldo).
- Ajudar no controle de orcamento e alertar excesso de gastos.
- Editar e excluir lancamentos.
- Sugerir melhorias financeiras com base nos dados reais.
- Tirar duvidas financeiras praticas (economia, planejamento e habitos).

REGRAS TECNICAS (OBRIGATORIO)
1) Retorne SEMPRE um JSON valido com exatamente duas chaves:
   - "reply": string com texto para WhatsApp.
   - "actionObjects": array de objetos de acao (AIAction[]).
2) Nao escreva nada antes nem depois do JSON. A resposta inteira deve ser o JSON.
3) Para registrar gasto/receita unico: use "add_transaction". Quando o usuario usa verbos de acao no passado (gastei, paguei, comprei, recebi, ganhei) com valor, REGISTRE AUTOMATICAMENTE sem perguntar.
4) Para registrar gasto/receita recorrente (todo mes, semanal, etc.): use "add_recurring_transaction" com o campo "frequency".
5) Para conversas gerais, duvidas, orientacoes e informacoes: use {"action":"none"}.
6) Se faltar o VALOR (nao a categoria ou data), pergunte no "reply" e use action none. Se faltar categoria, escolha a mais adequada. Se faltar data, use hoje.
7) NUNCA registre transacao quando o usuario usa frases descritivas/informativas ('minhas despesas sao', 'meu gasto mensal e', 'tenho de conta').
8) Se o usuario citar MULTIPLAS transacoes na mesma mensagem, adicione MULTIPLOS objetos em "actionObjects", na mesma ordem em que aparecem.

FORMATOS DE ACTIONOBJECT
- {"action":"none"}
- {"action":"add_transaction","type":"expense|income","amount":15.5,"description":"Lanche","categoryId":"id","date":"YYYY-MM-DD","paymentMethod":"pix|credit|debit|cash|transfer|boleto"}
- {"action":"add_recurring_transaction","type":"expense|income","amount":500,"description":"Aluguel","categoryId":"id","date":"YYYY-MM-DD","paymentMethod":"pix","frequency":"weekly|monthly|yearly","endDate":null}
- {"action":"update_transaction","id":"transaction_id","changes":{"amount":20}}
- {"action":"delete_transaction","id":"transaction_id"}

EXEMPLO DE RESPOSTA (formato exato):
{"reply":"Lancamentos registrados!","actionObjects":[{"action":"add_transaction","type":"expense","amount":50,"description":"Mercado","categoryId":"alimentacao","date":"${today}","paymentMethod":"pix"},{"action":"add_transaction","type":"expense","amount":15,"description":"Uber","categoryId":"transporte","date":"${today}","paymentMethod":"pix"}]}

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
 * Validates that a parsed action has the correct field types.
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

  if (action === 'add_recurring_transaction') {
    const type = obj.type;
    const amount = Number(obj.amount);
    const description = typeof obj.description === 'string' ? obj.description : '';
    const categoryId = typeof obj.categoryId === 'string' ? obj.categoryId : '';
    const date = typeof obj.date === 'string' ? obj.date : '';
    const paymentMethod = typeof obj.paymentMethod === 'string' ? obj.paymentMethod : 'pix';
    const frequency = obj.frequency;
    const endDate = typeof obj.endDate === 'string' ? obj.endDate : null;

    if (type !== 'income' && type !== 'expense') return { action: 'none' };
    if (!Number.isFinite(amount) || amount <= 0) return { action: 'none' };
    if (frequency !== 'weekly' && frequency !== 'monthly' && frequency !== 'yearly') return { action: 'none' };

    return {
      action: 'add_recurring_transaction',
      type,
      amount,
      description,
      categoryId,
      date,
      paymentMethod: paymentMethod as PaymentMethod,
      frequency,
      endDate,
    };
  }

  return { action: 'none' };
}

/**
 * Validates an AI action list payload.
 * Accepts both new format (array) and legacy single-object format.
 */
function validateActions(raw: unknown): AIAction[] {
  const list = Array.isArray(raw) ? raw : [raw];
  const sanitized = list
    .map((entry) => validateAction(entry))
    .filter((action) => action.action !== 'none');

  if (sanitized.length > 0) return sanitized;
  return [{ action: 'none' }];
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

function normalizeTextForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function parseBrazilianAmount(text: string): number | null {
  const explicitCurrency = text.match(/r\$\s*([\d.,]+)/i)?.[1];
  const labeledAmount = text.match(/\b(?:valor|total|pagamento)\s*[:\-]?\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2})\b/i)?.[1];
  const fallbackDecimal = text.match(/\b(\d+[.,]\d{2})\b/)?.[1];

  const raw = explicitCurrency ?? labeledAmount ?? fallbackDecimal;
  if (!raw) return null;

  let normalized = raw.replace(/\s/g, '');
  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');

  if (hasComma && hasDot) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    normalized = normalized.replace(',', '.');
  }

  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

function parseDateFromText(text: string): string | null {
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (iso) return iso;

  const dmy = text.match(/\b(\d{2})[\/\-](\d{2})[\/\-](\d{4})\b/);
  if (dmy) {
    const day = dmy[1];
    const month = dmy[2];
    const year = dmy[3];
    return `${year}-${month}-${day}`;
  }

  return null;
}

function detectPaymentMethod(text: string): PaymentMethod {
  const normalized = normalizeTextForMatch(text);
  if (normalized.includes('pix')) return 'pix';
  if (normalized.includes('credito') || normalized.includes('cartao de credito')) return 'credit';
  if (normalized.includes('debito') || normalized.includes('cartao de debito')) return 'debit';
  if (normalized.includes('dinheiro')) return 'cash';
  if (normalized.includes('transferencia') || normalized.includes('ted') || normalized.includes('doc')) return 'transfer';
  if (normalized.includes('boleto')) return 'boleto';
  return 'pix';
}

function detectTransactionType(text: string): 'income' | 'expense' {
  const normalized = normalizeTextForMatch(text);
  if (/\b(recebi|recebido|salario|ganhei|entrada|deposito)\b/.test(normalized)) return 'income';
  return 'expense';
}

function extractDescriptionFromText(text: string): string {
  const labeledDescription = text.match(/\b(?:descricao|estabelecimento|loja|empresa|favorecido|recebedor)\s*[:\-]\s*([^\n,.;]+)/i)?.[1];
  if (labeledDescription) {
    const value = labeledDescription.trim().slice(0, 120);
    if (value.length > 0) return value;
  }
  return 'Lancamento via comprovante';
}

function stripVisionContradictions(reply: string): string {
  const normalized = normalizeTextForMatch(reply);
  if (
    normalized.includes('nao consigo visualizar imagens') ||
    normalized.includes('nao consigo ver imagens') ||
    normalized.includes('nao consigo analisar imagem')
  ) {
    return 'Comprovante analisado. Extrai os dados e vou registrar para voce.';
  }
  return reply;
}

function buildVisionFallbackResult(content: string): GroqAssistantResult {
  const amount = parseBrazilianAmount(content);
  const date = parseDateFromText(content) ?? new Date().toISOString().split('T')[0];
  const paymentMethod = detectPaymentMethod(content);
  const type = detectTransactionType(content);
  const description = extractDescriptionFromText(content);

  if (amount && amount > 0) {
    return {
      reply: 'Comprovante analisado. Vou registrar a transacao agora.',
      actionObjects: [{
        action: 'add_transaction',
        type,
        amount,
        description,
        categoryId: '',
        date,
        paymentMethod
      }]
    };
  }

  const sanitized = stripVisionContradictions(sanitizeReply(content)).slice(0, env.maxMessageLength);
  return {
    reply: sanitized || 'Consegui analisar a imagem, mas preciso do valor para registrar a transacao.',
    actionObjects: [{ action: 'none' }]
  };
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
  isVisionRequest: boolean,
  promptMode: PromptMode
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
        const fallback = buildVisionFallbackResult(content);
        logger.warn('Groq vision response is not valid JSON, applying structured fallback', {
          model: modelId,
          contentPreview: content.slice(0, 100),
          fallbackAction: fallback.actionObjects[0]?.action ?? 'none'
        });
        return fallback;
      }
      throw new Error('Groq response is not valid JSON');
    }

    const reply = cleanAiReply(sanitizeReply((parsed.reply ?? '').toString()));
    const rawActionPayload = (parsed as Partial<GroqAssistantResult> & { actionObject?: unknown }).actionObjects
      ?? (parsed as Partial<GroqAssistantResult> & { actionObject?: unknown }).actionObject;
    const finalActions = validateActions(rawActionPayload);
    const enforcedActions = enforceActionByPromptMode(finalActions, promptMode);

    logger.info('Groq model response parsed successfully', {
      model: modelId,
      elapsedMs,
      actionCount: enforcedActions.length,
      actionTypes: enforcedActions.map((a) => a.action),
      replyLength: reply.length
    });

    return {
      reply: reply || 'Nao consegui entender. Pode reformular?',
      actionObjects: enforcedActions
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

  const promptMode = detectPromptMode(messages, context);
  const systemPrompt = buildPromptByMode(promptMode, context);
  logger.info('AI prompt mode selected', { provider: 'groq', promptMode, isVisionRequest });

  // Filter models: for vision requests, only use vision-capable models
  const modelsToTry = isVisionRequest
    ? GROQ_MODEL_CHAIN.filter((m) => m.vision)
    : GROQ_MODEL_CHAIN;

  let lastGroqError: unknown;

  // --- PRIMARY: Try all Groq models in chain ---
  for (const model of modelsToTry) {
    try {
      logger.info('Groq: trying model', { model: model.id, isVisionRequest });
      const result = await callGroqModel(model.id, systemPrompt, formattedMessages, isVisionRequest, promptMode);
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
      return await queryGeminiAssistant(messages, context, promptMode);
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
  context: UserFinancialContext,
  promptModeOverride?: PromptMode
): Promise<GroqAssistantResult> {
  const promptMode = promptModeOverride ?? detectPromptMode(messages, context);
  const systemPrompt = buildPromptByMode(promptMode, context);
  const lastMessage = messages[messages.length - 1];
  const isVisionRequest = Boolean(lastMessage?.imageDataUrl);
  logger.info('AI prompt mode selected', { provider: 'gemini', promptMode, isVisionRequest });

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
      if (isVisionRequest) {
        const fallback = buildVisionFallbackResult(content);
        logger.warn('Gemini vision response not parseable as JSON, applying structured fallback', {
          contentPreview: content.slice(0, 80),
          fallbackAction: fallback.actionObjects[0]?.action ?? 'none'
        });
        return fallback;
      }

      // Couldn't parse as JSON — treat raw content as reply but sanitize first
      const fallbackReply = sanitizeReply(content).trim().slice(0, env.maxMessageLength);
      logger.warn('Gemini response not parseable as JSON, using sanitized fallback', {
        contentPreview: content.slice(0, 80)
      });
      return {
        reply: fallbackReply || 'Nao consegui entender. Pode reformular?',
        actionObjects: [{ action: 'none' }]
      };
    }

    const reply = cleanAiReply(sanitizeReply((parsed.reply ?? '').toString()));
    const rawActionPayload = (parsed as Partial<GroqAssistantResult> & { actionObject?: unknown }).actionObjects
      ?? (parsed as Partial<GroqAssistantResult> & { actionObject?: unknown }).actionObject;
    const finalActions = validateActions(rawActionPayload);
    const enforcedActions = enforceActionByPromptMode(finalActions, promptMode);

    logger.info('Gemini response parsed successfully', {
      model: env.geminiModel,
      elapsedMs,
      actionCount: enforcedActions.length,
      actionTypes: enforcedActions.map((a) => a.action),
      replyLength: reply.length
    });

    return {
      reply: reply || 'Nao consegui entender. Pode reformular?',
      actionObjects: enforcedActions
    };
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}
