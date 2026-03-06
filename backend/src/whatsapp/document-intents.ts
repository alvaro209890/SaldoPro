import type { UserDocument } from '../lib/firestore';

const SAVE_KEYWORDS = ['guardar', 'guarda', 'guarde', 'salvar', 'salva', 'salve', 'arquivar', 'arquiva', 'arquive'];
const FETCH_VERBS = [
  'me manda de volta',
  'manda de volta',
  'me mandar de volta',
  'mandar de volta',
  'me manda',
  'me mandar',
  'manda',
  'mandar',
  'me envia',
  'me enviar',
  'envia',
  'enviar',
  'me mostra',
  'me mostrar',
  'mostra',
  'mostrar',
  'me devolve',
  'devolve',
  'busca',
  'buscar',
  'procura',
  'procurar',
  'cade',
  'cade a',
  'onde ta',
  'onde esta'
];
const DOCUMENT_NOUNS = ['imagem', 'foto', 'arquivo', 'documento', 'doc'];
const LABEL_HINT_WORDS = new Set(['titulo', 'nome']);
const DESCRIPTION_HINT_WORDS = new Set(['descricao', 'desc', 'observacao', 'obs']);
const STOPWORDS = new Set([
  'a',
  'ai',
  'aquela',
  'aquele',
  'aqui',
  'aquilo',
  'as',
  'da',
  'das',
  'de',
  'dessa',
  'desse',
  'desta',
  'deste',
  'do',
  'dos',
  'e',
  'ela',
  'elas',
  'ele',
  'eles',
  'em',
  'essa',
  'esse',
  'esta',
  'este',
  'isso',
  'la',
  'me',
  'nela',
  'nele',
  'nessa',
  'nesse',
  'nesta',
  'neste',
  'nisso',
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
  'titulo',
  'nome',
  'descricao',
  'desc',
  'isso',
  'essa',
  'esse',
  'este',
  'isto'
]);
const LEADING_LABEL_FILLER_WORDS = new Set([
  'a',
  'ai',
  'aquela',
  'aquele',
  'aqui',
  'aquilo',
  'arquivo',
  'as',
  'como',
  'desc',
  'descricao',
  'dessa',
  'desse',
  'desta',
  'deste',
  'doc',
  'documento',
  'ela',
  'elas',
  'ele',
  'eles',
  'essa',
  'esse',
  'esta',
  'este',
  'foto',
  'imagem',
  'isso',
  'isto',
  'la',
  'nela',
  'nele',
  'nessa',
  'nesse',
  'nesta',
  'neste',
  'nisso',
  'nome',
  'o',
  'os',
  'titulo',
  'um',
  'uma'
]);
const LEADING_LABEL_CONNECTOR_WORDS = new Set([
  'com',
  'como',
  'e',
  'eh',
  'para',
  'pra',
  'por',
  'ser',
  'seria',
  'fica',
  'ficar',
  'vai'
]);
const POST_MARKER_SKIP_WORDS = new Set([
  'a',
  'as',
  'da',
  'das',
  'de',
  'do',
  'dos',
  'e',
  'eh',
  'esta',
  'este',
  'o',
  'os',
  'ser',
  'seria',
  'um',
  'uma',
  'vai'
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

function trimWrappedQuotes(value: string): string {
  return value
    .replace(/^[`"']+/, '')
    .replace(/[`"']+$/, '')
    .trim();
}

function cleanExtractedSegment(value: string): string {
  return trimWrappedQuotes(
    collapseWhitespace(value)
      .replace(/^[:\-.,;]+/, '')
      .replace(/[:\-.,;]+$/, '')
  );
}

function findFirstTokenIndex(
  normalizedTokens: string[],
  matcher: (token: string) => boolean,
  startIndex = 0
): number {
  for (let index = startIndex; index < normalizedTokens.length; index += 1) {
    if (matcher(normalizedTokens[index])) {
      return index;
    }
  }

  return -1;
}

function skipIgnorableLabelTokens(
  normalizedTokens: string[],
  startIndex: number,
  extraWords?: Set<string>
): number {
  let currentIndex = startIndex;

  while (currentIndex < normalizedTokens.length) {
    const token = normalizedTokens[currentIndex];
    if (
      !token ||
      LEADING_LABEL_FILLER_WORDS.has(token) ||
      LEADING_LABEL_CONNECTOR_WORDS.has(token) ||
      (extraWords?.has(token) ?? false)
    ) {
      currentIndex += 1;
      continue;
    }
    break;
  }

  return currentIndex;
}

function parseDocumentLabelTokens(rawTokens: string[]): { title: string; description: string } {
  if (rawTokens.length === 0) {
    return { title: '', description: '' };
  }

  const normalizedTokens = rawTokens.map((token) => normalizeDocumentText(token));
  const explicitTitleIndex = findFirstTokenIndex(normalizedTokens, (token) => LABEL_HINT_WORDS.has(token));
  const titleStartIndex = explicitTitleIndex === -1
    ? skipIgnorableLabelTokens(normalizedTokens, 0)
    : skipIgnorableLabelTokens(normalizedTokens, explicitTitleIndex + 1, POST_MARKER_SKIP_WORDS);

  const explicitDescriptionIndex = findFirstTokenIndex(
    normalizedTokens,
    (token) => DESCRIPTION_HINT_WORDS.has(token),
    titleStartIndex
  );

  const rawTitle = rawTokens.slice(
    titleStartIndex,
    explicitDescriptionIndex === -1 ? rawTokens.length : explicitDescriptionIndex
  ).join(' ');
  const rawDescription = explicitDescriptionIndex === -1
    ? ''
    : rawTokens.slice(
      skipIgnorableLabelTokens(normalizedTokens, explicitDescriptionIndex + 1, POST_MARKER_SKIP_WORDS)
    ).join(' ');

  const title = cleanExtractedSegment(rawTitle);
  const description = cleanExtractedSegment(rawDescription);

  if (!title && description) {
    return { title: description, description: '' };
  }

  return { title, description };
}

function extractRelevantLabelText(rawTokens: string[]): string {
  if (rawTokens.length === 0) return '';

  const normalizedTokens = rawTokens.map((token) => normalizeDocumentText(token));
  const explicitTitleIndex = findFirstTokenIndex(normalizedTokens, (token) => LABEL_HINT_WORDS.has(token));
  const startIndex = explicitTitleIndex === -1
    ? skipIgnorableLabelTokens(normalizedTokens, 0)
    : skipIgnorableLabelTokens(normalizedTokens, explicitTitleIndex + 1, POST_MARKER_SKIP_WORDS);

  return cleanExtractedSegment(rawTokens.slice(startIndex).join(' '));
}

function isSingleEditOrAdjacentSwap(a: string, b: string): boolean {
  if (!a || !b || Math.abs(a.length - b.length) > 1) return false;
  if (a === b) return true;

  if (a.length === b.length) {
    const mismatches: number[] = [];
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) {
        mismatches.push(index);
        if (mismatches.length > 2) return false;
      }
    }

    if (mismatches.length === 1) {
      return true;
    }

    if (mismatches.length === 2) {
      const [first, second] = mismatches;
      return (
        second === first + 1 &&
        a[first] === b[second] &&
        a[second] === b[first]
      );
    }

    return false;
  }

  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  let shortIndex = 0;
  let longIndex = 0;
  let edits = 0;

  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
      continue;
    }

    edits += 1;
    if (edits > 1) return false;
    longIndex += 1;
  }

  return true;
}

function matchSaveKeywordToken(token: string): boolean {
  if (!token) return false;
  if (SAVE_KEYWORDS.includes(token)) return true;
  if (token.length < 5) return false;
  return SAVE_KEYWORDS.some((keyword) => isSingleEditOrAdjacentSwap(token, keyword));
}

function matchFetchKeywordToken(token: string, keyword: string): boolean {
  if (!token || !keyword) return false;
  if (token === keyword) return true;
  if (token.length < 4 || keyword.length < 4) return false;
  return isSingleEditOrAdjacentSwap(token, keyword);
}

function findFetchVerbMatch(normalizedTokens: string[]): { phrase: string; startIndex: number; length: number } | null {
  const normalizedPhrases = [...FETCH_VERBS]
    .map((phrase) => ({
      phrase,
      tokens: phrase.split(' ')
    }))
    .sort((a, b) => b.tokens.length - a.tokens.length);

  for (const candidate of normalizedPhrases) {
    const { tokens } = candidate;
    if (tokens.length === 0 || tokens.length > normalizedTokens.length) continue;

    for (let startIndex = 0; startIndex <= normalizedTokens.length - tokens.length; startIndex += 1) {
      let matches = true;
      for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
        if (!matchFetchKeywordToken(normalizedTokens[startIndex + tokenIndex], tokens[tokenIndex])) {
          matches = false;
          break;
        }
      }

      if (matches) {
        return {
          phrase: candidate.phrase,
          startIndex,
          length: tokens.length
        };
      }
    }
  }

  return null;
}

export function parseDocumentLabelInput(text: string): { title: string; description: string } {
  const rawTokens = collapseWhitespace(text).split(' ').filter(Boolean);
  return parseDocumentLabelTokens(rawTokens);
}

export function detectDocumentSaveIntent(text: string): { matched: boolean; labelCandidate: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { matched: false, labelCandidate: '' };
  }

  const rawTokens = collapseWhitespace(trimmed).split(' ').filter(Boolean);
  const normalizedTokens = rawTokens.map((token) => normalizeDocumentText(token));
  const matchedIndex = normalizedTokens.findIndex((token) => matchSaveKeywordToken(token));

  if (matchedIndex === -1) {
    return { matched: false, labelCandidate: '' };
  }

  return {
    matched: true,
    labelCandidate: extractRelevantLabelText(rawTokens.slice(matchedIndex + 1))
  };
}

export function detectDocumentFetchIntent(text: string): { matched: boolean; query: string } {
  const normalized = normalizeDocumentText(text);
  if (!normalized) {
    return { matched: false, query: '' };
  }

  const normalizedTokens = normalized.split(' ').filter(Boolean);
  const verbMatch = findFetchVerbMatch(normalizedTokens);
  if (!verbMatch) {
    return { matched: false, query: '' };
  }

  const queryTokens = normalizedTokens.filter((_, index) => {
    if (index >= verbMatch.startIndex && index < verbMatch.startIndex + verbMatch.length) {
      return false;
    }
    return true;
  });

  const filtered = queryTokens
    .filter((token) => token && !STOPWORDS.has(token))
    .filter((token) => !DOCUMENT_NOUNS.includes(token))
    .join(' ');

  const hasDocumentNoun = DOCUMENT_NOUNS.some((noun) => normalizedTokens.includes(noun));
  const impliesReturnRequest = normalized.includes('de volta') || normalized.includes('de novo');
  const query = collapseWhitespace(filtered);

  if (!query && !hasDocumentNoun && !impliesReturnRequest) {
    return { matched: false, query: '' };
  }

  return {
    matched: true,
    query
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
    .filter((token) => !LABEL_HINT_WORDS.has(token))
    .filter((token) => !DESCRIPTION_HINT_WORDS.has(token))
    .filter((token) => !FETCH_VERBS.includes(token))
    .filter((token) => !DOCUMENT_NOUNS.includes(token));
}

export function isMeaningfulDocumentLabel(text: string): boolean {
  const { title } = parseDocumentLabelInput(text);
  const rawNormalized = normalizeDocumentText(title);
  if (!rawNormalized) return false;

  const rawTokens = rawNormalized.split(' ').filter(Boolean);
  if (rawTokens.length === 0) return false;
  if (rawTokens.every((token) => GENERIC_LABEL_WORDS.has(token) || STOPWORDS.has(token))) {
    return false;
  }

  return tokenizeDocumentSearch(title).length > 0;
}

export interface RankedDocumentMatch {
  document: UserDocument;
  score: number;
}

const DOCUMENT_RECENCY_BONUS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function scoreRecentDocuments(documents: UserDocument[], query: string): RankedDocumentMatch[] {
  const normalizedQuery = normalizeDocumentText(query);
  const queryTokens = [...new Set(tokenizeDocumentSearch(query))];
  const now = Date.now();

  return documents
    .map((document) => {
      let score = 0;
      const normalizedTitle = document.normalizedTitle;
      const normalizedDescription = document.normalizedDescription ?? '';
      const tokenSet = new Set(document.searchTokens);

      if (normalizedQuery) {
        if (normalizedTitle === normalizedQuery) {
          score += 100;
        } else if (normalizedTitle.includes(normalizedQuery)) {
          score += 60;
        }
      }

      for (const token of queryTokens) {
        if (normalizedTitle.includes(token)) score += 25;
        if (normalizedDescription.includes(token)) score += 15;
        if (tokenSet.has(token)) score += 10;
      }

      const createdAt = Date.parse(document.createdAt);
      if (Number.isFinite(createdAt) && now - createdAt <= DOCUMENT_RECENCY_BONUS_WINDOW_MS) {
        score += 10;
      }

      return { document, score };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.document.createdAt.localeCompare(a.document.createdAt);
    });
}
