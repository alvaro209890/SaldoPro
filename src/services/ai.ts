import type { Category } from '@/types';

// O usuário forneceu a chave no prompt, estamos usando como fallback para garantir que funcione de imediato
const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY || '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';

interface AIParseResult {
    type: 'income' | 'expense';
    amount: number;
    description: string;
    categoryId: string;
    date: string; // YYYY-MM-DD
}

export async function parseTransactionWithAI(
    message: string,
    categories: Category[]
): Promise<AIParseResult> {
    if (!GROQ_API_KEY) {
        throw new Error('Chave da API do Groq não configurada.');
    }

    const categoriesList = categories
        .map((c) => `- ID: "${c.id}", Nome: "${c.name}", Tipo: ${c.type}`)
        .join('\n');

    const today = new Date().toISOString().split('T')[0];

    const systemPrompt = `Você é um assistente financeiro inteligente.
Sua tarefa é extrair os dados de uma transação financeira a partir do texto do usuário e retornar EXATAMENTE um objeto JSON válido, sem markdown, sem explicações extras.

Regras:
1. "type": Deve ser "expense" (despesa) ou "income" (receita/ganho).
2. "amount": Deve ser um número positivo usando ponto como separador decimal (ex: 50.00).
3. "description": Uma descrição curta e clara do que foi gasto ou recebido (ex: "Lanche", "Salário", "Uber").
4. "categoryId": Você DEVE escolher o ID de categoria que MAIS se aproxima da despesa/receita, a partir da lista fornecida abaixo. Se não souber, use uma categoria genérica de "Outros" se existir na lista, ou a mais próxima.
5. "date": Use a data atual (${today}) se não for mencionada nenhuma outra data específica no passado. Formato YYYY-MM-DD.

Lista de Categorias Disponíveis:
${categoriesList}

EXEMPLO DE RESPOSTA (Retorne apenas o JSON):
{
  "type": "expense",
  "amount": 50.00,
  "description": "Lanche na padaria",
  "categoryId": "alimentacao",
  "date": "${today}"
}`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: message }
            ],
            model: 'llama3-8b-8192',
            temperature: 0.1,
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
        const parsed = JSON.parse(content) as AIParseResult;
        return parsed;
    } catch (err) {
        console.error('Erro ao fazer parse do JSON da IA:', content);
        throw new Error('A resposta da inteligência artificial foi inválida.');
    }
}
