import express from "express";
import { authRequired } from "../middleware/auth.js";
import Book from "../models/Book.js";
import Loan from "../models/Loan.js";
import ResearchProject from "../models/ResearchProject.js";
import { getBookLocation, getBookStock, getBookTotalCopies } from "../utils/bookRecord.js";

const router = express.Router();

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "llama3.2";
const OLLAMA_TIMEOUT_MS = 20000;

const TOPIC_SYNONYMS = {
  ptsd: ["post traumatic stress", "post-traumatic stress", "trauma", "mental health", "clinical psychology"],
  trauma: ["ptsd", "post traumatic stress", "mental health", "resilience"],
  "mental health": ["wellbeing", "depression", "anxiety", "trauma", "ptsd"],
  economics: ["microeconomics", "macroeconomics", "econometrics", "markets", "public policy economics"],
  microeconomics: ["economics", "price theory", "markets", "consumer behavior"],
  macroeconomics: ["economics", "fiscal policy", "monetary policy", "growth"],
  econometrics: ["economics", "statistics", "data analysis", "quantitative methods"],
  "urban poverty": ["poverty", "urban inequality", "slums", "social policy", "development economics", "income inequality"],
  poverty: ["urban poverty", "inequality", "social policy", "welfare economics", "development"],
  inequality: ["urban poverty", "income inequality", "social stratification", "public policy"],
  "urban inequality": ["urban poverty", "poverty", "housing inequality", "social policy"],
  fitness: ["exercise", "physical health", "wellness", "wellbeing", "anatomy", "physiology"],
  exercise: ["fitness", "training", "physical health", "wellness", "physiology"],
  wellness: ["fitness", "exercise", "wellbeing", "health", "mental health"],
  story: ["fiction", "novel", "narrative", "literature", "short stories"],
  "story books": ["stories", "fiction", "novels", "literature", "short stories"],
  fiction: ["story", "novel", "narrative", "literature"],
};

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "with", "by", "at", "from", "is", "are",
  "this", "that", "these", "those", "about", "into", "across", "as", "be", "it", "its", "their", "your", "what",
  "which", "should", "read", "books", "book", "research", "please", "help", "me", "suggest", "some", "available", "you",
]);

function getOllamaBaseUrl() {
  const baseUrl = process.env.OLLAMA_BASE_URL || process.env.AI_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
  return baseUrl.replace(/\/+$/, "");
}

function getConfiguredOllamaModel() {
  return String(process.env.OLLAMA_MODEL || process.env.AI_MODEL || "").trim();
}

function mapMessages(messages) {
  return (messages || [])
    .slice(-6)
    .map((msg) => ({ role: msg.role === "ai" ? "assistant" : msg.role, content: String(msg.text || msg.content || "") }))
    .filter((msg) => ["user", "assistant"].includes(msg.role) && msg.content.trim().length > 0);
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 2 && !STOP_WORDS.has(x))
    .slice(0, 12);
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toTokenRegex(term) {
  const escaped = escapeRegex(String(term || "").trim());
  if (!escaped) return null;
  return escaped.includes(" ") ? new RegExp(escaped, "i") : new RegExp(`\\b${escaped}\\b`, "i");
}

function expandedTermsFromQuery(query) {
  const q = normalizeText(query);
  const terms = new Set(q.split(/\s+/).filter(Boolean));
  if (q) terms.add(q);

  Object.entries(TOPIC_SYNONYMS).forEach(([topic, synonyms]) => {
    const topicMatched = q.includes(topic) || [...terms].some((term) => topic.includes(term));
    const synonymMatched = synonyms.some((syn) => q.includes(syn) || terms.has(syn));
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

async function rankBooksForQuery(query, limit = 8) {
  const expandedTerms = expandedTermsFromQuery(query);
  const regexes = expandedTerms.map((term) => toTokenRegex(term)).filter(Boolean);

  const directCandidates = await Book.find({
    $or: [
      { title: { $regex: query, $options: "i" } },
      { author: { $regex: query, $options: "i" } },
      { subject: { $regex: query, $options: "i" } },
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
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.book);

  return ranked;
}

function buildBookSources(books) {
  return (books || []).map((book) => ({
    bookId: book._id,
    title: book.title,
    author: book.author,
    category: book.category,
    stock: getBookStock(book),
    totalCopies: getBookTotalCopies(book),
    location: getBookLocation(book),
  }));
}

function topBookSignals(book) {
  const location = getBookLocation(book);
  return `${book.title} by ${book.author} | ${book.category} | Floor ${location.floor} | Shelf ${location.shelf} | Stock ${getBookStock(book)}/${getBookTotalCopies(book)}`;
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

function buildSuggestedPrompts({ queryText, books, activeProjects }) {
  const focusTopic = String(queryText || activeProjects?.[0]?.topic || books?.[0]?.title || "my topic").trim();
  const topBook = books?.[0]?.title;
  const prompts = [
    `Turn "${focusTopic}" into a better library search plan.`,
    `Give me 3 keyword combinations for researching "${focusTopic}".`,
    topBook ? `Compare "${topBook}" with two other useful books for "${focusTopic}".` : "",
    `What should I read first for "${focusTopic}" and why?`,
  ];

  return uniqueStrings(prompts).slice(0, 4);
}

function buildFallbackReply({ userText, books, activeProjects, activeLoans }) {
  const topBooks = (books || []).slice(0, 4);
  const booksBlock = topBooks.length
    ? topBooks.map((book, index) => `${index + 1}. ${topBookSignals(book)}`).join("\n")
    : "No close library matches were found. Try broadening the topic keywords.";

  const projectsLine = activeProjects.length
    ? `Your recent project topics: ${activeProjects.map((project) => project.topic).join("; ")}.`
    : "You have no recent research projects saved.";

  const loansLine = activeLoans.length
    ? `You currently have ${activeLoans.length} active loan(s).`
    : "You currently have no active loans.";

  return [
    `Here are the best library-aware matches I found for: ${userText}`,
    "",
    booksBlock,
    "",
    projectsLine,
    loansLine,
    "",
    "Suggested next step:",
    "Use one subject term and one methods term together in search, then compare the top 3 relevant books.",
  ].join("\n");
}

function buildFallbackPayload({ userText, books, activeProjects, activeLoans, model, warning, latencyMs, suggestedPrompts }) {
  return {
    reply: buildFallbackReply({ userText, books, activeProjects, activeLoans }),
    provider: "local-library-fallback",
    model,
    sources: buildBookSources(books),
    latencyMs,
    suggestedPrompts: suggestedPrompts || [],
    context: {
      projectsUsed: activeProjects.length,
      loansUsed: activeLoans.length,
      booksUsed: books.length,
    },
    ...(warning ? { warning } : {}),
  };
}

function withTimeout(signal, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timeout);
    },
  };
}

async function fetchOllamaJson(path, payload) {
  const { signal, clear } = withTimeout(null, OLLAMA_TIMEOUT_MS);

  try {
    const response = await fetch(`${getOllamaBaseUrl()}${path}`, {
      method: payload ? "POST" : "GET",
      headers: payload ? { "Content-Type": "application/json" } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      signal,
    });

    const raw = await response.text();
    const data = raw ? JSON.parse(raw) : {};

    if (!response.ok) {
      const detail = data?.error || response.statusText || "Unknown Ollama error";
      throw new Error(`Ollama request failed (${response.status}): ${detail}`);
    }

    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Ollama request timed out after ${Math.round(OLLAMA_TIMEOUT_MS / 1000)} seconds.`);
    }
    throw error;
  } finally {
    clear();
  }
}

async function listOllamaModels() {
  const data = await fetchOllamaJson("/api/tags");
  return Array.isArray(data?.models) ? data.models : [];
}

async function resolveOllamaModel() {
  const configuredModel = getConfiguredOllamaModel();
  const installedModels = await listOllamaModels();
  const installedNames = installedModels
    .map((item) => String(item?.name || item?.model || "").trim())
    .filter(Boolean);

  if (configuredModel) {
    return {
      model: configuredModel,
      installedModels: installedNames,
    };
  }

  return {
    model: installedNames[0] || "",
    installedModels: installedNames,
  };
}

async function chatWithOllama(messages) {
  const { model, installedModels } = await resolveOllamaModel();

  if (!model) {
    throw new Error(
      `No Ollama models were found at ${getOllamaBaseUrl()}. Pull a model first, for example: ollama pull ${DEFAULT_OLLAMA_MODEL}`
    );
  }

  const data = await fetchOllamaJson("/api/chat", {
    model,
    stream: false,
    options: {
      temperature: 0.2,
      num_predict: 180,
      num_ctx: 2048,
    },
    messages,
  });

  return {
    reply: String(data?.message?.content || "").trim(),
    model: String(data?.model || model).trim() || model,
    installedModels,
  };
}

router.post("/assistant", authRequired, async (req, res) => {
  const startedAt = Date.now();
  try {
    const text = String(req.body.message || "").trim();
    const history = mapMessages(req.body.messages);
    if (!text && !history.length) return res.status(400).json({ message: "Message is required" });

    const queryText = text || [...history].reverse().find((msg) => msg.role === "user")?.content || "";

    const [activeProjects, activeLoans, rankedBooks] = await Promise.all([
      ResearchProject.find({ user: req.user._id }).sort({ updatedAt: -1 }).limit(2),
      Loan.find({
        user: req.user._id,
        returnedAt: null,
        $or: [{ status: "approved" }, { status: { $exists: false } }],
      })
        .populate("book", "title author category stock totalCopies location")
        .sort({ createdAt: -1 })
        .limit(3),
      rankBooksForQuery(queryText, 4),
    ]);

    const booksForContext = rankedBooks.length
      ? rankedBooks
      : await Book.find({}).limit(4);
    const suggestedPrompts = buildSuggestedPrompts({
      queryText,
      books: booksForContext,
      activeProjects,
    });

    const projectsContext = activeProjects.length
      ? activeProjects.map((project, idx) => `${idx + 1}. ${project.topic}`).join("\n")
      : "None";

    const loansContext = activeLoans.length
      ? activeLoans
        .map((loan, idx) => `${idx + 1}. ${loan.book?.title || "Unknown"} (due ${loan.dueDate?.toISOString?.().slice(0, 10) || "n/a"})`)
        .join("\n")
      : "None";

    const booksContext = booksForContext.length
      ? booksForContext.map((book, idx) => `${idx + 1}. ${topBookSignals(book)}`).join("\n")
      : "None";

    const systemPrompt = [
      "You are an AI Research Helper inside a university library portal.",
      "Goal: help students formulate research questions, build literature reviews, discover sources, and improve search strategy using this library's inventory and user context.",
      "Behavior requirements:",
      "- Be practical and actionable. Use short step-by-step advice.",
      "- Convert vague research ideas into search-ready keywords, themes, and query combinations.",
      "- Prefer recommending books from the provided in-library context before generic advice.",
      "- Mention stock and location when recommending books.",
      "- If the question is broad, give a short plan and 3 immediate actions.",
      "- Do not fabricate citations, books, or journal facts.",
      "- If uncertain, say so and suggest how to verify inside the portal.",
      "- Do not write full assignments for the student.",
      "Tone: supportive, concise, academically helpful.",
    ].join("\n");

    const contextPrompt = [
      "Library context (use this first):",
      `User active projects:\n${projectsContext}`,
      `User current loans:\n${loansContext}`,
      `Top in-library matches for current topic:\n${booksContext}`,
    ].join("\n\n");

    const ollamaMessages = [
      { role: "system", content: systemPrompt },
      { role: "system", content: contextPrompt },
      ...history,
      ...(text ? [{ role: "user", content: text }] : []),
    ];

    try {
      const { reply, model } = await chatWithOllama(ollamaMessages);

      if (!reply) {
        return res.json(buildFallbackPayload({
          userText: queryText,
          books: booksForContext,
          activeProjects,
          activeLoans,
          model: "local-library-fallback",
          latencyMs: Date.now() - startedAt,
          suggestedPrompts,
          warning: "Ollama returned an empty response. Local library-aware guidance was used instead.",
        }));
      }

      return res.json({
        reply,
        provider: "ollama",
        model,
        sources: buildBookSources(booksForContext),
        latencyMs: Date.now() - startedAt,
        suggestedPrompts,
        context: {
          projectsUsed: activeProjects.length,
          loansUsed: activeLoans.length,
          booksUsed: booksForContext.length,
        },
      });
    } catch (error) {
      return res.json(buildFallbackPayload({
        userText: queryText,
        books: booksForContext,
        activeProjects,
        activeLoans,
        model: "local-library-fallback",
        latencyMs: Date.now() - startedAt,
        suggestedPrompts,
        warning: `${error.message} Local library-aware guidance was used instead.`,
      }));
    }
  } catch (error) {
    return res.json(buildFallbackPayload({
      userText: String(req.body.message || "").trim() || "your topic",
      books: [],
      activeProjects: [],
      activeLoans: [],
      model: "local-library-fallback",
      latencyMs: Date.now() - startedAt,
      suggestedPrompts: [],
      warning: `AI assistant request failed before reaching Ollama. Local fallback was used. ${error.message}`,
    }));
  }
});

export default router;
