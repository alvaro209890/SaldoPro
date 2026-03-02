const SAVE_KEYWORDS = ['guardar', 'guarda', 'salvar', 'salva', 'arquivar', 'arquiva'];
const FETCH_VERBS = [
  'me manda',
  'manda',
  'me envia',
  'envia',
  'me mostra',
  'mostra',
  'busca',
  'procura',
  'cade',
  'cade a',
  'onde ta',
  'onde esta'
];
const DOCUMENT_NOUNS = ['imagem', 'foto', 'arquivo', 'documento', 'doc'];
const STOPWORDS = new Set([
  'a',
  'as',
  'da',
  'das',
  'de',
  'do',
  'dos',
  'e',
  'em',
  'essa',
  'esse',
  'esta',
  'este',
  'isso',
  'me',
  'o',
  'os',
  'ou',
  'para',
  'pra',
  'pro',
  'que',
  'ta',
  'uma',
  'um'
]);
const GENERIC_LABEL_WORDS = new Set([
  'arquivo',
  'documento',
  'doc',
  'foto',
  'imagem',
  'isso',
  'essa',
  'esse',
  'este',
  'isto'
]);

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeDocumentText(text: string): string {
  return collapseWhitespace(
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
  );
}

function removeKeywordOnce(value: string, keyword: string): string {
  const pattern = new RegExp(`\\b${keyword}\\b`, 'i');
  return collapseWhitespace(value.replace(pattern, ' '));
}

export function detectDocumentSaveIntent(text: string): { matched: boolean; labelCandidate: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { matched: false, labelCandidate: '' };
  }

  const normalized = normalizeDocumentText(trimmed);
  const matchedKeyword = SAVE_KEYWORDS.find((keyword) => new RegExp(`\\b${keyword}\\b`).test(normalized));
  if (!matchedKeyword) {
    return { matched: false, labelCandidate: '' };
  }

  return {
    matched: true,
    labelCandidate: removeKeywordOnce(trimmed, matchedKeyword)
  };
}

export function detectDocumentFetchIntent(text: string): { matched: boolean; query: string } {
  const normalized = normalizeDocumentText(text);
  if (!normalized) {
    return { matched: false, query: '' };
  }

  const hasVerb = FETCH_VERBS.some((verb) => normalized.includes(verb));
  const hasDocumentNoun = DOCUMENT_NOUNS.some((noun) => new RegExp(`\\b${noun}\\b`).test(normalized));
  if (!hasVerb || !hasDocumentNoun) {
    return { matched: false, query: '' };
  }

  let query = normalized;
  for (const verb of [...FETCH_VERBS].sort((a, b) => b.length - a.length)) {
    query = query.replace(new RegExp(`\\b${verb.replace(/\s+/g, '\\s+')}\\b`, 'g'), ' ');
  }

  for (const noun of DOCUMENT_NOUNS) {
    query = query.replace(new RegExp(`\\b${noun}\\b`, 'g'), ' ');
  }

  query = collapseWhitespace(query);
  const filtered = query
    .split(' ')
    .filter((token) => token && !STOPWORDS.has(token))
    .join(' ');

  return {
    matched: true,
    query: collapseWhitespace(filtered)
  };
}

export function tokenizeDocumentSearch(text: string): string[] {
  const normalized = normalizeDocumentText(text);
  if (!normalized) return [];

  return normalized
    .split(' ')
    .filter((token) => token.length >= 2)
    .filter((token) => !STOPWORDS.has(token))
    .filter((token) => !SAVE_KEYWORDS.includes(token))
    .filter((token) => !FETCH_VERBS.includes(token))
    .filter((token) => !DOCUMENT_NOUNS.includes(token));
}

export function isMeaningfulDocumentLabel(text: string): boolean {
  const rawNormalized = normalizeDocumentText(text);
  if (!rawNormalized) return false;

  const rawTokens = rawNormalized.split(' ').filter(Boolean);
  if (rawTokens.length === 0) return false;
  if (rawTokens.every((token) => GENERIC_LABEL_WORDS.has(token) || STOPWORDS.has(token))) {
    return false;
  }

  return tokenizeDocumentSearch(text).length > 0;
}

