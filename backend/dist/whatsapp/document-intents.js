"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeDocumentText = normalizeDocumentText;
exports.detectDocumentSaveIntent = detectDocumentSaveIntent;
exports.detectDocumentFetchIntent = detectDocumentFetchIntent;
exports.tokenizeDocumentSearch = tokenizeDocumentSearch;
exports.isMeaningfulDocumentLabel = isMeaningfulDocumentLabel;
const SAVE_KEYWORDS = ['guardar', 'guarda', 'guarde', 'salvar', 'salva', 'salve', 'arquivar', 'arquiva', 'arquive'];
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
const LEADING_LABEL_FILLER_WORDS = new Set([
    'a',
    'as',
    'essa',
    'esse',
    'esta',
    'este',
    'foto',
    'imagem',
    'isso',
    'isto',
    'o',
    'os',
    'doc',
    'documento',
    'arquivo',
    'uma',
    'um',
    'como'
]);
function collapseWhitespace(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function normalizeDocumentText(text) {
    return collapseWhitespace(text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' '));
}
function removeKeywordOnce(value, keyword) {
    const pattern = new RegExp(`\\b${keyword}\\b`, 'i');
    return collapseWhitespace(value.replace(pattern, ' '));
}
function isSingleEditOrAdjacentSwap(a, b) {
    if (!a || !b || Math.abs(a.length - b.length) > 1)
        return false;
    if (a === b)
        return true;
    if (a.length === b.length) {
        const mismatches = [];
        for (let index = 0; index < a.length; index += 1) {
            if (a[index] !== b[index]) {
                mismatches.push(index);
                if (mismatches.length > 2)
                    return false;
            }
        }
        if (mismatches.length === 1) {
            return true;
        }
        if (mismatches.length === 2) {
            const [first, second] = mismatches;
            return (second === first + 1 &&
                a[first] === b[second] &&
                a[second] === b[first]);
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
        if (edits > 1)
            return false;
        longIndex += 1;
    }
    return true;
}
function matchSaveKeywordToken(token) {
    if (!token)
        return false;
    if (SAVE_KEYWORDS.includes(token))
        return true;
    if (token.length < 5)
        return false;
    return SAVE_KEYWORDS.some((keyword) => isSingleEditOrAdjacentSwap(token, keyword));
}
function stripLeadingLabelFillers(rawTokens) {
    let startIndex = 0;
    while (startIndex < rawTokens.length) {
        const normalizedToken = normalizeDocumentText(rawTokens[startIndex]);
        if (!normalizedToken || LEADING_LABEL_FILLER_WORDS.has(normalizedToken)) {
            startIndex += 1;
            continue;
        }
        break;
    }
    return collapseWhitespace(rawTokens.slice(startIndex).join(' '));
}
function detectDocumentSaveIntent(text) {
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
        labelCandidate: stripLeadingLabelFillers(rawTokens.slice(matchedIndex + 1))
    };
}
function detectDocumentFetchIntent(text) {
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
function tokenizeDocumentSearch(text) {
    const normalized = normalizeDocumentText(text);
    if (!normalized)
        return [];
    return normalized
        .split(' ')
        .filter((token) => token.length >= 2)
        .filter((token) => !STOPWORDS.has(token))
        .filter((token) => !SAVE_KEYWORDS.includes(token))
        .filter((token) => !FETCH_VERBS.includes(token))
        .filter((token) => !DOCUMENT_NOUNS.includes(token));
}
function isMeaningfulDocumentLabel(text) {
    const rawNormalized = normalizeDocumentText(text);
    if (!rawNormalized)
        return false;
    const rawTokens = rawNormalized.split(' ').filter(Boolean);
    if (rawTokens.length === 0)
        return false;
    if (rawTokens.every((token) => GENERIC_LABEL_WORDS.has(token) || STOPWORDS.has(token))) {
        return false;
    }
    return tokenizeDocumentSearch(text).length > 0;
}
