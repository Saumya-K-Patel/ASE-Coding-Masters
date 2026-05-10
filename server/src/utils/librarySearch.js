const TOPIC_SYNONYMS = {
  "machine learning": ["ml", "artificial intelligence", "ai", "predictive modeling", "data science"],
  "artificial intelligence": ["ai", "machine learning", "intelligent systems", "neural networks"],
  ptsd: ["post traumatic stress", "post-traumatic stress", "trauma", "mental health", "clinical psychology"],
  trauma: ["ptsd", "post traumatic stress", "mental health", "resilience"],
  "mental health": ["wellbeing", "depression", "anxiety", "social isolation", "loneliness"],
  loneliness: ["social isolation", "mental health", "wellbeing"],
  economics: ["microeconomics", "macroeconomics", "econometrics", "markets", "public policy economics"],
  microeconomics: ["economics", "price theory", "market structures", "markets", "consumer behavior"],
  macroeconomics: ["economics", "fiscal policy", "monetary policy", "growth"],
  econometrics: ["economics", "statistics", "data analysis", "quantitative methods"],
  cybersecurity: ["information security", "network security", "cryptography", "cyber defense"],
  statistics: ["probability", "data analysis", "inference", "quantitative methods"],
  biochemistry: ["molecular biology", "enzymology", "organic chemistry", "genetics"],
  "urban poverty": ["poverty", "urban inequality", "slums", "social policy", "development economics", "income inequality"],
  poverty: ["urban poverty", "inequality", "social policy", "welfare economics", "development"],
  inequality: ["urban poverty", "income inequality", "social stratification", "public policy"],
  "urban inequality": ["urban poverty", "poverty", "housing inequality", "social policy"],
  fitness: ["exercise", "physical health", "wellness", "wellbeing", "anatomy", "physiology"],
  exercise: ["fitness", "training", "physical health", "wellness", "physiology"],
  wellness: ["fitness", "exercise", "wellbeing", "health", "mental health"],
  "story books": ["stories", "fiction", "novels", "literature", "short stories"],
  story: ["fiction", "novel", "narrative", "literature", "short stories"],
  fiction: ["story", "novel", "narrative", "literature"],
};

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "with", "by", "at", "from", "is", "are",
  "this", "that", "these", "those", "about", "into", "across", "as", "be", "it", "its", "their", "your", "what",
  "which", "should", "read", "books", "book", "research", "please", "help", "me", "suggest", "some", "available", "you",
]);

const MATCHABLE_BOOK_FIELDS = [
  { label: "title", values: (book) => [book?.title] },
  { label: "author", values: (book) => [book?.author] },
  { label: "category", values: (book) => [book?.category] },
  { label: "subject", values: (book) => [book?.subject] },
  { label: "semantic topics", values: (book) => book?.semanticTopics || [] },
  { label: "tags", values: (book) => book?.tags || [] },
  { label: "course codes", values: (book) => book?.courseCodes || [] },
];

export function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function uniqueStrings(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = normalizeText(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function toTokenRegex(term) {
  const escaped = escapeRegex(String(term || "").trim());
  if (!escaped) return null;
  return escaped.includes(" ") ? new RegExp(escaped, "i") : new RegExp(`\\b${escaped}\\b`, "i");
}

export function tokenize(text) {
  return normalizeText(text)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token && token.length > 2 && !STOP_WORDS.has(token));
}

export function expandQueryTerms(query) {
  const normalized = normalizeText(query);
  const terms = new Set(normalized.split(/\s+/).filter(Boolean));
  if (normalized) terms.add(normalized);

  Object.entries(TOPIC_SYNONYMS).forEach(([topic, synonyms]) => {
    const topicMatched = normalized.includes(topic) || [...terms].some((term) => topic.includes(term));
    const synonymMatched = synonyms.some((syn) => normalized.includes(syn) || terms.has(syn));
    if (topicMatched || synonymMatched) {
      terms.add(topic);
      synonyms.forEach((syn) => terms.add(syn));
    }
  });

  return [...terms];
}

function termFreq(tokens) {
  const freq = new Map();
  tokens.forEach((token) => {
    freq.set(token, (freq.get(token) || 0) + 1);
  });
  return freq;
}

function cosineSimilarity(aFreq, bFreq, idf) {
  const terms = new Set([...aFreq.keys(), ...bFreq.keys()]);
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;

  terms.forEach((term) => {
    const weight = idf.get(term) || 1;
    const a = (aFreq.get(term) || 0) * weight;
    const b = (bFreq.get(term) || 0) * weight;
    dot += a * b;
    aNorm += a * a;
    bNorm += b * b;
  });

  if (!aNorm || !bNorm) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

function overlapScore(queryTokens, tokenSet) {
  if (!queryTokens.length) return 0;
  const matches = queryTokens.filter((token) => tokenSet.has(token)).length;
  return matches / queryTokens.length;
}

function weightedBookText(book) {
  const title = `${book.title || ""} ${book.title || ""} ${book.title || ""}`;
  const category = `${book.category || ""} ${book.category || ""}`;
  const topics = [...(book.semanticTopics || []), ...(book.topicClusters || []), ...(book.keywords || [])].join(" ");
  const tags = (book.tags || []).join(" ");
  const author = book.author || "";
  const courses = (book.courseCodes || []).join(" ");
  const subject = book.subject || "";
  return `${title} ${category} ${topics} ${topics} ${tags} ${author} ${courses} ${subject}`;
}

function isShortStoryIntent(query) {
  const normalized = normalizeText(query);
  return /\bshort\b/.test(normalized) && /\bstory\b|\bstories\b/.test(normalized);
}

function matchesShortStoryBook(book) {
  const haystack = normalizeText([
    book.title || "",
    ...(book.semanticTopics || []),
    ...(book.tags || []),
    book.category || "",
  ].join(" "));

  const hasShortSignal = /\bshort\b|\banthology\b|\bcollection\b|\bcollections\b/.test(haystack);
  const hasStorySignal = /\bstory\b|\bstories\b|\bnarrative\b|\bfiction\b/.test(haystack);
  return hasShortSignal && hasStorySignal;
}

function isEconomicsIntent(query) {
  return /\beconomics\b|\bmicroeconomics\b|\bmacroeconomics\b|\beconometrics\b|\bmarket\b|\bmarkets\b/.test(normalizeText(query));
}

function matchesEconomicsBook(book) {
  const haystack = normalizeText([
    book.category || "",
    book.title || "",
    ...(book.semanticTopics || []),
    ...(book.tags || []),
  ].join(" "));
  return /\beconomics\b|\bmicroeconomics\b|\bmacroeconomics\b|\beconometrics\b|\bmarket\b|\bpolicy\b/.test(haystack);
}

function isUrbanPovertyIntent(query) {
  const normalized = normalizeText(query);
  return (/\burban\b/.test(normalized) && /\bpoverty\b/.test(normalized))
    || /\burban poverty\b|\burban inequality\b|\bincome inequality\b/.test(normalized);
}

function matchesUrbanPovertyBook(book) {
  const haystack = normalizeText([
    book.category || "",
    book.title || "",
    ...(book.semanticTopics || []),
    ...(book.tags || []),
  ].join(" "));

  const povertySignal = /\bpoverty\b|\binequality\b|\bwelfare\b|\bpublic policy\b|\bdevelopment\b/.test(haystack);
  const urbanSignal = /\burban\b|\bsocial\b|\bcommunity\b|\bpolicy\b|\bhousing\b/.test(haystack);
  const domainSignal = /\beconomics\b|\bhealth sciences\b|\bhistory\b|\beducation\b|\bmathematics\b/.test(haystack);
  return (povertySignal && urbanSignal) || (povertySignal && domainSignal);
}

function matchesUrbanSupportBook(book) {
  const haystack = normalizeText([
    book.category || "",
    book.title || "",
    ...(book.semanticTopics || []),
    ...(book.tags || []),
  ].join(" "));
  return /\bpolicy\b|\bdevelopment\b|\bsocial\b|\bcommunity\b|\beconomics\b|\bwelfare\b|\bpublic health\b|\bstatistics\b/.test(haystack);
}

function joinWithAnd(values) {
  const items = values.filter(Boolean);
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function collectMatchEvidence(book, expandedTerms) {
  const matchedFields = [];
  const evidence = [];

  for (const term of expandedTerms) {
    const regex = toTokenRegex(term);
    if (!regex) continue;

    for (const field of MATCHABLE_BOOK_FIELDS) {
      const values = field.values(book)
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      const sample = values.find((value) => regex.test(value));
      if (!sample) continue;

      matchedFields.push(field.label);
      evidence.push({ term, field: field.label, sample });
    }
  }

  return {
    matchedFields: uniqueStrings(matchedFields).slice(0, 4),
    matchedTerms: uniqueStrings(evidence.map((entry) => entry.sample)).slice(0, 4),
    evidence: evidence.slice(0, 6),
  };
}

export function buildBookRelevance(book, query, expandedTerms, score = 0) {
  const { matchedFields, matchedTerms, evidence } = collectMatchEvidence(book, expandedTerms);
  const summary = matchedTerms.length && matchedFields.length
    ? `Matches "${query}" through ${joinWithAnd(matchedFields)}, especially ${matchedTerms.map((term) => `"${term}"`).join(", ")}.`
    : matchedFields.length
      ? `Matches "${query}" through ${joinWithAnd(matchedFields)} in the catalog metadata.`
      : `Related to "${query}" based on overall semantic overlap in the catalog.`;

  return {
    matchedTerms,
    matchedFields,
    evidence,
    summary,
    score: Number(score.toFixed(3)),
  };
}

export function buildBookMatchContext(book, queryText, expandedTerms = expandQueryTerms(queryText)) {
  return buildBookRelevance(book, String(queryText || "").trim(), expandedTerms, 0);
}

function applyIntentFilters(query, entries) {
  const shortStoryIntent = isShortStoryIntent(query);
  const economicsIntent = isEconomicsIntent(query);
  const urbanPovertyIntent = isUrbanPovertyIntent(query);

  if (shortStoryIntent) {
    const filtered = entries.filter((entry) => matchesShortStoryBook(entry.book));
    return filtered.length ? filtered : entries;
  }

  if (urbanPovertyIntent) {
    const strict = entries.filter((entry) => matchesUrbanPovertyBook(entry.book));
    if (strict.length >= 3) return strict;

    const support = entries.filter((entry) => matchesUrbanSupportBook(entry.book));
    const merged = [];
    const seen = new Set();

    [...strict, ...support].forEach((entry) => {
      const key = `${normalizeText(entry.book.title)}::${normalizeText(entry.book.category)}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(entry);
    });

    return merged.length ? merged : entries;
  }

  if (economicsIntent) {
    const filtered = entries.filter((entry) => matchesEconomicsBook(entry.book));
    return filtered.length ? filtered : entries;
  }

  return entries;
}

export function rankBooksByQuery(query, books, { limit = 8, minScore = 0.08 } = {}) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];

  const expandedTerms = expandQueryTerms(query);
  const expandedTokens = tokenize(expandedTerms.join(" "));
  const queryFreq = termFreq(expandedTokens);

  const docs = [];
  const df = new Map();

  for (const book of books || []) {
    const tokens = tokenize(weightedBookText(book));
    const freq = termFreq(tokens);
    const tokenSet = new Set(tokens);
    docs.push({ book, freq, tokenSet });
    new Set(tokens).forEach((token) => {
      df.set(token, (df.get(token) || 0) + 1);
    });
  }

  const docCount = Math.max(docs.length, 1);
  const idf = new Map();
  df.forEach((value, token) => {
    idf.set(token, Math.log(1 + docCount / (1 + value)));
  });

  const scored = docs
    .map(({ book, freq, tokenSet }) => {
      const cosine = cosineSimilarity(queryFreq, freq, idf);
      const overlap = overlapScore(expandedTokens, tokenSet);
      const phraseRegexes = expandedTerms.map((term) => toTokenRegex(term)).filter(Boolean);
      const exactTitleMatch = normalizedQuery && normalizeText(book.title || "").includes(normalizedQuery);
      const exactAuthorMatch = normalizedQuery && normalizeText(book.author || "").includes(normalizedQuery);
      const exactFieldMatch = phraseRegexes.some((regex) => (
        regex.test(book.title || "")
        || regex.test(book.category || "")
        || regex.test(book.subject || "")
        || (book.semanticTopics || []).some((topic) => regex.test(topic))
        || (book.tags || []).some((tag) => regex.test(tag))
        || (book.courseCodes || []).some((code) => regex.test(code))
      ));

      const relevance = buildBookRelevance(book, query, expandedTerms, 0);
      const fieldCoverageBoost = Math.min(relevance.matchedFields.length * 0.08, 0.24);
      const termCoverageBoost = Math.min(relevance.matchedTerms.length * 0.05, 0.2);
      const exactBoost = (exactTitleMatch ? 0.8 : 0) + (exactAuthorMatch ? 0.45 : 0) + (exactFieldMatch ? 0.35 : 0);
      const stockBoost = Number(book.stock) > 0 ? 0.05 : 0;
      const score = cosine * 0.44 + overlap * 0.26 + fieldCoverageBoost + termCoverageBoost + exactBoost + stockBoost;

      return {
        book,
        score,
        relevance: {
          ...relevance,
          score: Number(score.toFixed(3)),
        },
      };
    })
    .filter((entry) => entry.score >= minScore || entry.relevance.matchedFields.length >= 2 || entry.relevance.matchedTerms.length >= 2)
    .sort((left, right) => right.score - left.score);

  const precisionFiltered = scored.some((entry) => entry.relevance.matchedFields.length > 0)
    ? scored.filter((entry) => entry.relevance.matchedFields.length > 0)
    : scored;

  const deduped = [];
  const seen = new Set();
  applyIntentFilters(query, precisionFiltered).forEach((entry) => {
    const key = `${normalizeText(entry.book.title)}::${normalizeText(entry.book.category)}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(entry);
  });

  return deduped.slice(0, Math.max(1, limit));
}
