import express from "express";
import Book from "../models/Book.js";
import { authRequired } from "../middleware/auth.js";
import { getBookStock, serializeBook } from "../utils/bookRecord.js";

const router = express.Router();

const TOPIC_SYNONYMS = {
  "machine learning": ["ml", "artificial intelligence", "ai", "predictive modeling", "data science"],
  "artificial intelligence": ["ai", "machine learning", "intelligent systems", "neural networks"],
  "mental health": ["wellbeing", "depression", "anxiety", "social isolation", "loneliness"],
  loneliness: ["social isolation", "mental health", "wellbeing"],
  microeconomics: ["price theory", "market structures", "consumer behavior", "economics"],
  biochemistry: ["molecular biology", "enzymology", "organic chemistry", "genetics"],
  cybersecurity: ["information security", "network security", "cryptography", "cyber defense"],
  statistics: ["probability", "data analysis", "inference", "quantitative methods"],
  economics: ["microeconomics", "macroeconomics", "econometrics", "markets", "public policy economics"],
  microeconomics: ["economics", "price theory", "markets", "consumer behavior"],
  macroeconomics: ["economics", "fiscal policy", "monetary policy", "growth"],
  econometrics: ["economics", "statistics", "data analysis", "quantitative methods"],
  "urban poverty": ["poverty", "urban inequality", "slums", "social policy", "development economics", "income inequality"],
  poverty: ["urban poverty", "inequality", "social policy", "welfare economics", "development"],
  inequality: ["urban poverty", "income inequality", "social stratification", "public policy"],
  "urban inequality": ["urban poverty", "poverty", "housing inequality", "social policy"],
  "story books": ["stories", "fiction", "novels", "literature", "short stories"],
  story: ["fiction", "novel", "narrative", "literature"],
  fiction: ["story", "novel", "literature"],
};

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "with", "by", "at", "from", "is", "are",
  "this", "that", "these", "those", "about", "into", "across", "as", "be", "it", "its", "their", "your",
]);

const METHODS_TERMS = ["case study", "qualitative", "quantitative", "survey", "comparative", "literature review"];

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toTokenRegex(term) {
  const escaped = escapeRegex(term.trim());
  if (!escaped) return null;
  // Use whole-word matching for single tokens to avoid false positives like "story" matching "history".
  return escaped.includes(" ") ? new RegExp(escaped, "i") : new RegExp(`\\b${escaped}\\b`, "i");
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return normalizeText(text)
    .split(" ")
    .map((x) => x.trim())
    .filter((x) => x && !STOP_WORDS.has(x));
}

function uniqueStrings(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = normalizeText(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
    const w = idf.get(term) || 1;
    const a = (aFreq.get(term) || 0) * w;
    const b = (bFreq.get(term) || 0) * w;
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
  const q = normalizeText(query);
  return /\bshort\b/.test(q) && /\bstory\b|\bstories\b/.test(q);
}

function matchesShortStoryBook(book) {
  const title = normalizeText(book.title || "");
  const topics = normalizeText((book.semanticTopics || []).join(" "));
  const tags = normalizeText((book.tags || []).join(" "));
  const haystack = `${title} ${topics} ${tags}`;

  const hasShortSignal = /\bshort\b|\banthology\b|\bcollection\b|\bcollections\b/.test(haystack);
  const hasStorySignal = /\bstory\b|\bstories\b|\bnarrative\b/.test(haystack);
  return hasShortSignal && hasStorySignal;
}

function isEconomicsIntent(query) {
  const q = normalizeText(query);
  return /\beconomics\b|\bmicroeconomics\b|\bmacroeconomics\b|\beconometrics\b|\bmarket\b|\bmarkets\b/.test(q);
}

function matchesEconomicsBook(book) {
  const category = normalizeText(book.category || "");
  const title = normalizeText(book.title || "");
  const topics = normalizeText((book.semanticTopics || []).join(" "));
  const tags = normalizeText((book.tags || []).join(" "));
  const haystack = `${category} ${title} ${topics} ${tags}`;
  return /\beconomics\b|\bmicroeconomics\b|\bmacroeconomics\b|\beconometrics\b|\bmarket\b|\bpolicy\b/.test(haystack);
}

function isUrbanPovertyIntent(query) {
  const q = normalizeText(query);
  return /\burban\b/.test(q) && /\bpoverty\b/.test(q)
    || /\burban poverty\b|\burban inequality\b|\bincome inequality\b/.test(q);
}

function matchesUrbanPovertyBook(book) {
  const category = normalizeText(book.category || "");
  const title = normalizeText(book.title || "");
  const topics = normalizeText((book.semanticTopics || []).join(" "));
  const tags = normalizeText((book.tags || []).join(" "));
  const haystack = `${category} ${title} ${topics} ${tags}`;

  const povertySignal = /\bpoverty\b|\binequality\b|\bwelfare\b|\bpublic policy\b|\bdevelopment\b/.test(haystack);
  const urbanSignal = /\burban\b|\bsocial\b|\bcommunity\b|\bpolicy\b/.test(haystack);
  const domainSignal = /\beconomics\b|\bhealth sciences\b|\bhistory\b|\beducation\b/.test(haystack);
  return (povertySignal && urbanSignal) || (povertySignal && domainSignal);
}

function matchesUrbanSupportBook(book) {
  const title = normalizeText(book.title || "");
  const topics = normalizeText((book.semanticTopics || []).join(" "));
  const tags = normalizeText((book.tags || []).join(" "));
  const haystack = `${normalizeText(book.category || "")} ${title} ${topics} ${tags}`;
  return /\bpolicy\b|\bdevelopment\b|\bsocial\b|\bcommunity\b|\beconomics\b|\bwelfare\b|\bpublic health\b/.test(haystack);
}

function buildIntentLabels(query) {
  const q = normalizeText(query);
  const labels = [];

  if (q) labels.push("topic search");
  if (METHODS_TERMS.some((term) => q.includes(term))) labels.push("methods refined");
  if (/\bavailable\b|\bin stock\b|\bcopy\b/.test(q)) labels.push("availability aware");
  if (/\bby\b|\bauthor\b/.test(q)) labels.push("author-led");

  return uniqueStrings(labels);
}

function buildSuggestedQueries(query, relatedThemes) {
  const trimmed = String(query || "").trim();
  if (!trimmed) return [];

  const needsMethod = !METHODS_TERMS.some((term) => normalizeText(trimmed).includes(term));
  const suggestions = [
    needsMethod ? `${trimmed} qualitative study` : "",
    needsMethod ? `${trimmed} literature review` : "",
    `${trimmed} case study`,
    `${trimmed} beginner guide`,
    ...((relatedThemes || []).slice(0, 3).map((theme) => `${trimmed} ${theme}`)),
  ];

  return uniqueStrings(suggestions).slice(0, 6);
}

function buildSearchPlan(query, relatedThemes) {
  const topTheme = relatedThemes?.[0];
  const plan = [
    "Start with your core topic phrase and scan the top 3 books for category overlap.",
    "Add one methods term such as qualitative, quantitative, or case study to narrow the search.",
    topTheme
      ? `Try the related theme "${topTheme}" if the first results are too narrow or repetitive.`
      : "Use a related theme from the result list to widen the search when needed.",
  ];

  return uniqueStrings(plan);
}

function expandedTermsFromQuery(query) {
  const q = query.toLowerCase().trim();
  const terms = new Set(q.split(/\s+/).filter(Boolean));
  terms.add(q);

  Object.entries(TOPIC_SYNONYMS).forEach(([topic, synonyms]) => {
    const topicMatched = q.includes(topic) || [...terms].some((term) => topic.includes(term));
    const synonymMatched = synonyms.some((syn) => q.includes(syn) || [...terms].includes(syn));
    if (topicMatched || synonymMatched) {
      terms.add(topic);
      synonyms.forEach((syn) => terms.add(syn));
    }
  });

  return [...terms];
}

router.get("/semantic", authRequired, async (req, res) => {
  const { q = "", limit = 20 } = req.query;
  if (!q.trim()) return res.json({ topic: "", books: [], relatedThemes: [] });

  const expandedTerms = expandedTermsFromQuery(q);
  const regexes = expandedTerms.map((term) => toTokenRegex(term)).filter(Boolean);

  const directCandidates = await Book.find({
    $or: [
      { title: { $regex: q, $options: "i" } },
      { author: { $regex: q, $options: "i" } },
      { subject: { $regex: q, $options: "i" } },
      { category: { $in: regexes } },
      { semanticTopics: { $in: regexes } },
      { topicClusters: { $in: regexes } },
      { keywords: { $in: regexes } },
      { tags: { $in: regexes } },
      { courseCodes: { $in: regexes } },
    ],
  }).limit(300);

  const books = directCandidates.length ? directCandidates : await Book.find({}).limit(500);

  const expandedTokens = tokenize(expandedTerms.join(" "));
  const queryFreq = termFreq(expandedTokens);

  const docs = [];
  const df = new Map();

  books.forEach((book) => {
    const tokens = tokenize(weightedBookText(book));
    const freq = termFreq(tokens);
    const tokenSet = new Set(tokens);
    docs.push({ book, freq, tokenSet });

    new Set(tokens).forEach((token) => {
      df.set(token, (df.get(token) || 0) + 1);
    });
  });

  const docCount = Math.max(docs.length, 1);
  const idf = new Map();
  df.forEach((value, token) => {
    idf.set(token, Math.log(1 + docCount / (1 + value)));
  });

  const ranked = docs
    .map(({ book, freq, tokenSet }) => {
      const cosine = cosineSimilarity(queryFreq, freq, idf);
      const overlap = overlapScore(expandedTokens, tokenSet);

      const phraseBoost = expandedTerms.some((term) => {
        const rx = toTokenRegex(term);
        if (!rx) return false;
        return (
          rx.test(book.title || "")
          || rx.test(book.category || "")
          || (book.semanticTopics || []).some((topic) => rx.test(topic))
          || (book.tags || []).some((tag) => rx.test(tag))
        );
      })
        ? 0.25
        : 0;

      const stockBoost = getBookStock(book) > 0 ? 0.05 : 0;
      const score = cosine * 0.62 + overlap * 0.33 + phraseBoost + stockBoost;
      return { book, score };
    })
    .filter((entry) => entry.score > 0.08)
    .sort((a, b) => b.score - a.score);

  // Keep only the strongest hit per title/category to avoid repetitive result lists.
  const uniqueByTitle = new Map();
  ranked.forEach((entry) => {
    const key = `${normalizeText(entry.book.title)}::${normalizeText(entry.book.category)}`;
    if (!uniqueByTitle.has(key)) {
      uniqueByTitle.set(key, entry);
    }
  });

  const deduped = [...uniqueByTitle.values()];
  const strictShortStory = isShortStoryIntent(q);
  const strictEconomics = isEconomicsIntent(q);
  const strictUrbanPoverty = isUrbanPovertyIntent(q);
  const filtered = strictShortStory
    ? deduped.filter((entry) => matchesShortStoryBook(entry.book))
    : strictUrbanPoverty
      ? (() => {
        const strict = deduped.filter((entry) => matchesUrbanPovertyBook(entry.book));
        if (strict.length >= 3) return strict;

        const topUp = deduped.filter((entry) => matchesUrbanSupportBook(entry.book));
        const merged = [];
        const seen = new Set();
        [...strict, ...topUp].forEach((entry) => {
          const key = `${normalizeText(entry.book.title)}::${normalizeText(entry.book.category)}`;
          if (!seen.has(key)) {
            seen.add(key);
            merged.push(entry);
          }
        });
        return merged;
      })()
      : strictEconomics
      ? deduped.filter((entry) => matchesEconomicsBook(entry.book))
      : deduped;

  const finalEntries = filtered.length ? filtered : deduped;
  const capped = finalEntries.slice(0, Number(limit) > 0 ? Math.min(Number(limit), 50) : 20);
  const rankedBooks = capped.map((entry) => entry.book);

  const topicBuckets = {};
  rankedBooks.forEach((book) => {
    (book.semanticTopics || []).forEach((topic) => {
      topicBuckets[topic] = (topicBuckets[topic] || 0) + 1;
    });
  });

  const relatedThemes = Object.entries(topicBuckets)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([topic]) => topic);

  if (!relatedThemes.length) {
    expandedTerms.forEach((term) => {
      if (TOPIC_SYNONYMS[term]) {
        TOPIC_SYNONYMS[term].forEach((syn) => {
          topicBuckets[syn] = (topicBuckets[syn] || 0) + 1;
        });
      }
    });
  }

  const related = Object.keys(topicBuckets).slice(0, 6);
  const relatedForUi = related.length ? related : relatedThemes;
  const suggestedQueries = buildSuggestedQueries(q, relatedForUi);
  const intentLabels = buildIntentLabels(q);

  return res.json({
    topic: q,
    books: rankedBooks.map(serializeBook),
    relatedThemes: relatedForUi,
    meta: {
      totalCandidates: books.length,
      returned: rankedBooks.length,
      strategy: "weighted-semantic-ranking",
      intentLabels,
      expandedTerms: uniqueStrings(expandedTerms).slice(0, 8),
      suggestedQueries,
      plan: buildSearchPlan(q, relatedForUi),
    },
  });
});

export default router;
