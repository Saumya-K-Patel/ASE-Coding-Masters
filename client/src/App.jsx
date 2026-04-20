import { useEffect, useMemo, useState } from "react";
import { api, setAuthToken } from "./api";

const adminRoles = ["librarian", "staff", "admin"];
const researchStatusOptions = ["planning", "sourcing", "reading", "writing", "revising", "completed"];
const taskStatusCycle = {
  todo: "in_progress",
  in_progress: "done",
  done: "todo",
};

const initialResearchForm = {
  topic: "",
  researchQuestion: "",
  methodology: "",
  keywords: "",
  notes: "",
  status: "planning",
  targetCompletionDate: "",
};

function fmtDate(value) {
  if (!value) return "-";
  return new Date(value).toISOString().slice(0, 10);
}

function fmtLongDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function startOfDay(value) {
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function daysLeft(value, now = new Date()) {
  const due = startOfDay(value);
  const today = startOfDay(now);
  if (!due || !today) return 0;
  return Math.round((due - today) / (1000 * 60 * 60 * 24));
}

function timeAgo(value) {
  if (!value) return "";
  const then = new Date(value);
  const now = new Date();
  const diffDays = Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return "1 week ago";
  return `${Math.floor(diffDays / 7)} weeks ago`;
}

function flattenTextParts(value, depth = 0) {
  if (depth > 5 || value == null) return [];
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];

  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenTextParts(item, depth + 1));
  }

  if (typeof value === "object") {
    const preferredKeys = ["text", "content", "message", "response", "summary", "title", "label"];
    const nested = preferredKeys.flatMap((key) => (
      Object.prototype.hasOwnProperty.call(value, key)
        ? flattenTextParts(value[key], depth + 1)
        : []
    ));

    if (nested.length) return nested;

    try {
      const serialized = JSON.stringify(value);
      return serialized && serialized !== "{}" ? [serialized] : [];
    } catch {
      return [];
    }
  }

  return [];
}

function asDisplayText(value, fallback = "") {
  const text = flattenTextParts(value)
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();

  return text || fallback;
}

function toneByDemand(score) {
  if (score > 40) return "danger";
  if (score > 24) return "warn";
  return "ok";
}

function clampPercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function getBorrowedCopies(item) {
  const totalCopies = Math.max(Number(item?.totalCopies) || 0, Number(item?.stock) || 0, 0);
  const stock = Math.max(0, Number(item?.stock) || 0);
  const explicitBorrowed = Number(item?.borrowedCopies);

  if (Number.isFinite(explicitBorrowed) && explicitBorrowed >= 0) {
    return Math.min(totalCopies, Math.round(explicitBorrowed));
  }

  return Math.max(0, totalCopies - stock);
}

function getBorrowPressurePercent(item) {
  const explicitPercent = Number(item?.demandBarPercent);
  if (Number.isFinite(explicitPercent)) return clampPercent(explicitPercent);

  const totalCopies = Math.max(Number(item?.totalCopies) || 0, Number(item?.stock) || 0, 0);
  if (totalCopies <= 0) return 0;
  return clampPercent((getBorrowedCopies(item) / totalCopies) * 100);
}

function toneByBorrowPressure(percent) {
  if (percent >= 80) return "danger";
  if (percent >= 45) return "warn";
  return "ok";
}

function formatBorrowPressure(item) {
  const totalCopies = Math.max(Number(item?.totalCopies) || 0, Number(item?.stock) || 0, 0);
  return `${getBorrowedCopies(item)}/${totalCopies || 0} borrowed`;
}

function formatRenewalPolicy(maxRenewals) {
  const renewals = Number(maxRenewals);
  if (!Number.isFinite(renewals) || renewals <= 0) return "No renewals";
  return `${renewals} renewal${renewals === 1 ? "" : "s"}`;
}

function getLoanPolicyView(loan) {
  const policy = loan?.policy || loan || {};
  const loanDays = Number(policy.loanDays ?? policy.borrowPolicyDays);
  const maxRenewals = Number(policy.maxRenewals);
  const overdueDailyRate = Number(policy.overdueDailyRate);
  const policyTier = String(policy.tier || policy.policyTier || "").trim();

  const pieces = [];
  if (Number.isFinite(loanDays) && loanDays > 0) {
    pieces.push(`${loanDays} day loan`);
  }
  pieces.push(formatRenewalPolicy(maxRenewals));
  if (Number.isFinite(overdueDailyRate) && overdueDailyRate > 0) {
    pieces.push(`$${overdueDailyRate.toFixed(2)}/day overdue`);
  }

  return {
    label: pieces.filter(Boolean).join(" • "),
    tier: policyTier,
  };
}

function keyActivatesCard(e) {
  return e.key === "Enter" || e.key === " ";
}

function shouldHideAiReplyText(message) {
  if (message?.role !== "ai") return false;
  if (!Array.isArray(message.sources) || message.sources.length === 0) return false;

  const text = String(message.text || "").trim().toLowerCase();
  return text.startsWith("top matches:");
}

function formatAiProvider(provider) {
  if (!provider) return "";
  if (provider === "ollama") return "Ollama";
  if (provider === "local-library-fallback") return "Local library fallback";
  return provider;
}

function formatWorkflowLabel(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getResearchTasks(project) {
  return Array.isArray(project?.tasks) ? project.tasks : [];
}

function getResearchTaskStats(project) {
  const tasks = getResearchTasks(project);
  const done = tasks.filter((task) => task.status === "done").length;
  const active = tasks.filter((task) => task.status === "in_progress").length;
  return {
    total: tasks.length,
    done,
    active,
    remaining: Math.max(tasks.length - done, 0),
  };
}

function getResearchProgress(project) {
  const stats = getResearchTaskStats(project);
  if (!stats.total) return 0;
  return Math.round((stats.done / stats.total) * 100);
}

function hashCode(value) {
  return Array.from(String(value || "")).reduce((total, char) => ((total << 5) - total) + char.charCodeAt(0), 0);
}

function buildBookSearchText(book) {
  return [
    book?.title,
    book?.author,
    book?.category,
    ...(Array.isArray(book?.semanticTopics) ? book.semanticTopics : []),
    ...(Array.isArray(book?.tags) ? book.tags : []),
  ]
    .join(" ")
    .toLowerCase();
}

function uniqueList(values) {
  return [...new Set(values.filter(Boolean))];
}

function toKeywordTokens(value) {
  return uniqueList(
    String(value || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length > 2)
  );
}

function getProjectTokens(project) {
  return uniqueList([
    ...toKeywordTokens(project?.topic),
    ...toKeywordTokens(project?.researchQuestion),
    ...toKeywordTokens(project?.methodology),
    ...(Array.isArray(project?.keywords) ? project.keywords.flatMap((keyword) => toKeywordTokens(keyword)) : []),
  ]);
}

function getBookThemes(book) {
  return uniqueList([
    ...(Array.isArray(book?.semanticTopics) ? book.semanticTopics : []),
    ...(Array.isArray(book?.tags) ? book.tags : []),
    book?.category,
  ].map((item) => String(item || "").trim()).filter(Boolean));
}

function getMatchedThemes(project, book) {
  const tokens = getProjectTokens(project);
  const themes = getBookThemes(book);
  const haystack = buildBookSearchText(book);

  const directThemeMatches = themes.filter((theme) => tokens.some((token) => theme.toLowerCase().includes(token)));
  const tokenMatches = tokens.filter((token) => haystack.includes(token));

  return uniqueList([...directThemeMatches, ...tokenMatches]).slice(0, 4);
}

function scoreBookForProject(project, book) {
  const tokens = getProjectTokens(project);

  if (!tokens.length) return 0;

  const haystack = buildBookSearchText(book);
  const matchedThemes = getMatchedThemes(project, book);
  return tokens.reduce((score, token) => (
    haystack.includes(token) ? score + (book?.title?.toLowerCase().includes(token) ? 5 : 2) : score
  ), 0) + (matchedThemes.length * 4) + Math.round((Number(book?.demandScore) || 0) / 20);
}

function getPopularComparisonBooks(book, allBooks) {
  return [...allBooks]
    .filter((candidate) => String(candidate?._id) !== String(book?._id))
    .sort((left, right) => (Number(right?.demandScore) || 0) - (Number(left?.demandScore) || 0))
    .slice(0, 3);
}

function buildBookOfferSummary(project, book, matchedThemes) {
  const focusLabel = matchedThemes[0] || book?.category || "your topic";
  const nextLabel = matchedThemes[1] || (Array.isArray(book?.semanticTopics) ? book.semanticTopics[0] : "") || "";

  if (String(book?.title || "").toLowerCase().includes("research")) {
    return `This title is strongest for shaping the structure of "${project?.topic || focusLabel}" because it gives you research language, framing, and methodology cues you can reuse in your review.`;
  }

  if ((Number(book?.demandScore) || 0) >= 40) {
    return `This is one of the library's most-used titles in this space. It gives you a strong overview of ${focusLabel}${nextLabel ? ` and ${nextLabel}` : ""}, so it works well as a primer before you move into narrower sources.`;
  }

  return `This book is most useful for "${project?.topic || focusLabel}" when you need grounded coverage of ${focusLabel}${nextLabel ? ` with extra attention to ${nextLabel}` : ""}. It looks more focused than a general survey text.`;
}

function buildDifferenceSummary(book, allBooks) {
  const comparisonBooks = getPopularComparisonBooks(book, allBooks);
  if (!comparisonBooks.length) {
    return "This title currently stands on its own in the catalog, so it can serve as a distinctive angle for your reading list.";
  }

  const comparisonTitles = comparisonBooks.map((item) => item.title).join(", ");
  const comparisonThemes = uniqueList(comparisonBooks.flatMap((item) => getBookThemes(item).map((theme) => theme.toLowerCase())));
  const uniqueThemes = getBookThemes(book).filter((theme) => !comparisonThemes.includes(theme.toLowerCase()));

  if (uniqueThemes.length) {
    return `Compared with popular titles like ${comparisonTitles}, this book is more specific about ${uniqueThemes.slice(0, 2).join(" and ")}, which gives you a less generic angle for analysis.`;
  }

  return `Compared with popular titles like ${comparisonTitles}, this book looks most useful as a complementary perspective rather than a duplicate, especially if you want a different author voice or narrower treatment of the topic.`;
}

function buildRelevantSections(project, book, matchedThemes) {
  const sections = [];
  const methodologyText = String(project?.methodology || "").toLowerCase();

  if (matchedThemes[0]) {
    sections.push(`Start with chapters or sections on ${matchedThemes[0]}.`);
  }

  if (matchedThemes[1]) {
    sections.push(`Use the table of contents or index to find places where ${matchedThemes[0] || project?.topic || "the topic"} connects to ${matchedThemes[1]}.`);
  }

  if (methodologyText.includes("compare") || methodologyText.includes("compar")) {
    sections.push("Prioritize comparison, contrast, or case-study sections that let you weigh multiple viewpoints.");
  } else if (methodologyText.includes("review") || methodologyText.includes("literature")) {
    sections.push("Read overview and synthesis sections first so you can build a cleaner literature review outline.");
  } else if (methodologyText.includes("method")) {
    sections.push("Scan the framework or methods-oriented sections first to strengthen your project design.");
  }

  if ((Number(book?.demandScore) || 0) >= 40) {
    sections.push("Read the introduction and early overview chapters first; this is already a popular primer in the library.");
  }

  if (!sections.length) {
    sections.push(`Begin with the introduction, then jump to sections tied to ${book?.category || "the main subject"} using the index.`);
  }

  return uniqueList(sections).slice(0, 3);
}

function buildBookInsight(project, book, allBooks) {
  const matchedThemes = getMatchedThemes(project, book);
  return {
    matchedThemes,
    offerSummary: buildBookOfferSummary(project, book, matchedThemes),
    differenceSummary: buildDifferenceSummary(book, allBooks),
    relevantSections: buildRelevantSections(project, book, matchedThemes),
  };
}

function BookCover({ book, compact = false }) {
  const seed = `${book?.title || ""}${book?.author || ""}${book?.category || ""}`;
  const hue = Math.abs(hashCode(seed)) % 360;
  const coverClassName = compact ? "book-cover compact" : "book-cover";

  if (book?.coverImageUrl) {
    return (
      <div className={coverClassName}>
        <img src={book.coverImageUrl} alt={`${book.title} cover`} />
      </div>
    );
  }

  return (
    <div
      className={`${coverClassName} generated`}
      style={{
        "--cover-start": `hsl(${hue} 68% 42%)`,
        "--cover-end": `hsl(${(hue + 36) % 360} 74% 62%)`,
      }}
    >
      <span className="book-cover-category">{book?.category || "Library"}</span>
      <strong>{book?.title || "Untitled Book"}</strong>
      <small>{book?.author || "Unknown Author"}</small>
    </div>
  );
}

function getLoanStatus(loan) {
  if (!loan) return "pending";
  if (loan.status) return loan.status;
  if (loan.returnedAt) return "returned";
  if (loan.dueDate || loan.borrowDate) return "approved";
  return "pending";
}

function isPendingLoan(loan) {
  return getLoanStatus(loan) === "pending";
}

function isActiveLoan(loan) {
  return getLoanStatus(loan) === "approved" && !loan.returnedAt;
}

function hasPendingRenewal(loan) {
  return loan?.renewalRequestStatus === "pending";
}

function hasRejectedRenewal(loan) {
  return loan?.renewalRequestStatus === "rejected";
}

function hasPendingReturn(loan) {
  return loan?.returnRequestStatus === "pending";
}

function hasRejectedReturn(loan) {
  return loan?.returnRequestStatus === "rejected";
}

function canRequestRenewal(loan) {
  const maxRenewals = Number(loan?.policy?.maxRenewals ?? loan?.maxRenewals);
  const renewalCount = Number(loan?.renewalCount);
  if (!Number.isFinite(maxRenewals) || maxRenewals <= 0) return false;
  if (!Number.isFinite(renewalCount)) return true;
  return renewalCount < maxRenewals;
}

const adminTabs = [
  { key: "dashboard", label: "Dashboard" },
  { key: "inventory", label: "Inventory" },
  { key: "borrowers", label: "Borrowers" },
  { key: "fines", label: "Fine Clearance" },
  { key: "demand", label: "Demand Predictor" },
  { key: "analytics", label: "Analytics" },
  { key: "alerts", label: "Notifications" },
];

const studentTabs = [
  { key: "home", label: "Home" },
  { key: "search", label: "Search" },
  { key: "loans", label: "My Loans" },
  { key: "research", label: "Research Tracker" },
  { key: "ar", label: "AR Navigator" },
  { key: "account", label: "My Account" },
];

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [user, setUser] = useState(null);
  const [authForm, setAuthForm] = useState({ email: "admin@uni.edu", password: "password123" });
  const [activeTab, setActiveTab] = useState("dashboard");
  const [timeMarker, setTimeMarker] = useState(() => Date.now());

  const [books, setBooks] = useState([]);
  const [loans, setLoans] = useState([]);
  const [fines, setFines] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [demand, setDemand] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsError, setAnalyticsError] = useState("");
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [research, setResearch] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);

  const [query, setQuery] = useState("");
  const [semantic, setSemantic] = useState(null);
  const [inventoryFilter, setInventoryFilter] = useState("All");
  const [inventoryStockFilter, setInventoryStockFilter] = useState("all");
  const [inventorySearch, setInventorySearch] = useState("");
  const [borrowersFilter, setBorrowersFilter] = useState("all");
  const [finesFilter, setFinesFilter] = useState("all");
  const [alertsFilter, setAlertsFilter] = useState("all");
  const [aiMessages, setAiMessages] = useState([
    {
      role: "ai",
      text: "Hello. I can help with research formulation, source discovery, and search strategy refinement using your local Ollama setup plus live library matches.",
      provider: "ollama",
    },
  ]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [arBookId, setArBookId] = useState("");
  const [arResult, setArResult] = useState(null);
  const [message, setMessage] = useState("");
  const [showResearchForm, setShowResearchForm] = useState(false);
  const [researchForm, setResearchForm] = useState(initialResearchForm);
  const [taskDrafts, setTaskDrafts] = useState({});

  const [bookForm, setBookForm] = useState({
    code: "",
    title: "",
    author: "",
    category: "",
    isbn: "",
    coverImageUrl: "",
    stock: 1,
    totalCopies: 1,
    examSeasonImpact: "Medium",
  });

  useEffect(() => {
    if (!message) return undefined;
    const timeout = setTimeout(() => setMessage(""), 2400);
    return () => clearTimeout(timeout);
  }, [message]);

  useEffect(() => {
    const interval = setInterval(() => setTimeMarker(Date.now()), 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setAuthToken(token);
    if (token) {
      localStorage.setItem("token", token);
      loadSession();
    } else {
      localStorage.removeItem("token");
      setUser(null);
    }
  }, [token]);

  useEffect(() => {
    if (!user) return;
    refreshAll();
    setActiveTab(adminRoles.includes(user.role) ? "dashboard" : "home");
  }, [user]);

  async function withAction(action, successText) {
    try {
      await action();
      if (successText) setMessage(successText);
    } catch (error) {
      const apiMessage = error?.response?.data?.message;
      const apiDetail = error?.response?.data?.error;
      setMessage(apiDetail ? `${apiMessage || "Action failed"}: ${apiDetail}` : (apiMessage || "Action failed"));
    }
  }

  async function loadSession() {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data.user);
    } catch {
      setToken("");
    }
  }

  async function refreshAll() {
    await Promise.all([
      loadBooks(),
      loadLoans(),
      loadFines(),
      loadAlerts(),
      loadDemand(),
      loadAnalytics(),
      loadResearch(),
      loadSubscriptions(),
    ]);
  }

  async function loadBooks() {
    const { data } = await api.get("/books");
    setBooks(data);
  }

  async function loadLoans() {
    const { data } = await api.get("/loans");
    setLoans(data);
  }

  async function loadFines() {
    const { data } = await api.get("/fines");
    setFines(data);
  }

  async function loadAlerts() {
    const { data } = await api.get("/alerts");
    setAlerts(data);
  }

  async function loadDemand() {
    try {
      const { data } = await api.get("/demand/forecast");
      setDemand(data);
    } catch {
      setDemand([]);
    }
  }

  async function loadAnalytics() {
    setAnalyticsLoading(true);
    try {
      const { data } = await api.get("/analytics/dashboard");
      setAnalytics(data);
      setAnalyticsError("");
    } catch {
      setAnalytics(null);
      setAnalyticsError("Analytics data is temporarily unavailable.");
    } finally {
      setAnalyticsLoading(false);
    }
  }

  async function loadResearch() {
    const { data } = await api.get("/research");
    setResearch(data);
  }

  async function loadSubscriptions() {
    const { data } = await api.get("/alerts/subscriptions");
    setSubscriptions(data);
  }

  async function login(e) {
    e.preventDefault();
    await withAction(async () => {
      const { data } = await api.post("/auth/login", authForm);
      setToken(data.token);
      setUser(data.user);
    });
  }

  async function createBook(e) {
    e.preventDefault();
    await withAction(async () => {
      await api.post("/books", {
        ...bookForm,
        location: { floor: 1, shelf: "NEW-01", row: 1 },
        semanticTopics: [bookForm.category.toLowerCase()],
        tags: [bookForm.category.toLowerCase()],
      });
      setBookForm({
        code: "",
        title: "",
        author: "",
        category: "",
        isbn: "",
        coverImageUrl: "",
        stock: 1,
        totalCopies: 1,
        examSeasonImpact: "Medium",
      });
      await loadBooks();
    }, "Book added");
  }

  async function deleteBook(id) {
    await withAction(async () => {
      await api.delete(`/books/${id}`);
      await loadBooks();
    }, "Book removed");
  }

  async function reserveBook(bookId) {
    await withAction(async () => {
      await api.post("/loans/reserve", { bookId });
      await loadSession();
      await refreshAll();
    }, "Reservation submitted");
  }

  async function approveReservation(id) {
    await withAction(async () => {
      await api.post(`/loans/${id}/approve`);
      await refreshAll();
    }, "Reservation approved");
  }

  async function rejectReservation(id) {
    const reason = window.prompt("Reason for rejecting this reservation?", "Reservation was not approved by the admin.");
    if (reason === null) return;
    await withAction(async () => {
      await api.post(`/loans/${id}/reject`, { reason });
      await refreshAll();
    }, "Reservation rejected");
  }

  async function renewLoan(id) {
    await withAction(async () => {
      await api.post(`/loans/${id}/renew`);
      await loadSession();
      await refreshAll();
    }, "Renewal request submitted");
  }

  async function approveRenewal(id) {
    await withAction(async () => {
      await api.post(`/loans/${id}/renew/approve`);
      await refreshAll();
    }, "Renewal approved");
  }

  async function rejectRenewal(id) {
    const reason = window.prompt("Reason for rejecting this renewal request?", "Renewal request was not approved.");
    if (reason === null) return;
    await withAction(async () => {
      await api.post(`/loans/${id}/renew/reject`, { reason });
      await refreshAll();
    }, "Renewal rejected");
  }

  async function returnLoan(id) {
    await withAction(async () => {
      await api.post(`/loans/${id}/return`);
      await loadSession();
      await refreshAll();
    }, "Return request submitted");
  }

  async function processReturn(id) {
    await withAction(async () => {
      await api.post(`/loans/${id}/return`);
      await refreshAll();
    }, "Return processed");
  }

  async function rejectReturn(id) {
    const reason = window.prompt("Reason for rejecting this return request?", "Return request needs more review before processing.");
    if (reason === null) return;
    await withAction(async () => {
      await api.post(`/loans/${id}/return/reject`, { reason });
      await refreshAll();
    }, "Return request rejected");
  }

  async function verifyFine(id) {
    const note = window.prompt("Add an optional payment note for this fine", "");
    if (note === null) return;
    await withAction(async () => {
      await api.post(`/fines/${id}/verify-payment`, { note });
      await loadSession();
      await refreshAll();
    }, "Fine cleared");
  }

  async function waiveFine(id) {
    const note = window.prompt("Why are you waiving this fine?", "Fine waived by admin review.");
    if (note === null) return;
    await withAction(async () => {
      await api.post(`/fines/${id}/waive`, { note });
      await loadSession();
      await refreshAll();
    }, "Fine waived");
  }

  async function markAlertRead(id) {
    await withAction(async () => {
      await api.post(`/alerts/${id}/read`);
      await loadAlerts();
    });
  }

  async function semanticSearch(nextQuery = query) {
    await withAction(async () => {
      const { data } = await api.get("/search/semantic", { params: { q: nextQuery, limit: 20 } });
      setSemantic(data);
    });
  }

  async function runHomeSearch(e) {
    e.preventDefault();
    if (!query.trim()) {
      setActiveTab("search");
      return;
    }

    await withAction(async () => {
      const { data } = await api.get("/search/semantic", { params: { q: query, limit: 20 } });
      setSemantic(data);
      setActiveTab("search");
    });
  }

  async function sendAI(nextText = null) {
    const outgoingText = String(nextText ?? aiInput).trim();
    if (!outgoingText || aiLoading) return;
    const mine = { role: "user", text: outgoingText };
    setAiMessages((prev) => [...prev, mine]);
    if (nextText === null) setAiInput("");
    setAiLoading(true);
    try {
      const history = [...aiMessages, mine].map((m) => ({ role: m.role, text: m.text })).slice(-12);
      const { data } = await api.post("/ai/assistant", { message: mine.text, messages: history });
        setAiMessages((prev) => [
          ...prev,
          {
            role: "ai",
            text: data.reply,
            provider: data.provider || "",
            model: data.model || "",
            warning: data.warning || "",
            context: data.context || null,
            suggestedPrompts: Array.isArray(data.suggestedPrompts) ? data.suggestedPrompts : [],
            sources: Array.isArray(data.sources) ? data.sources : [],
          },
        ]);
    } catch (error) {
      const errText = error?.response?.data?.message || "Ollama helper is unavailable right now.";
      setAiMessages((prev) => [...prev, { role: "ai", text: errText }]);
    } finally {
      setAiLoading(false);
    }
  }

  function openAiWithPrompt(prompt, sendNow = true) {
    const nextPrompt = String(prompt || "").trim();
    if (!nextPrompt) return;
    setAiOpen(true);
    if (sendNow) {
      sendAI(nextPrompt);
      return;
    }
    setAiInput(nextPrompt);
  }

  async function jumpToARFromSource(source) {
    if (!source?.bookId) return;
    await withAction(async () => {
      const { data } = await api.get(`/navigation/ar/${source.bookId}`);
      setArBookId(source.bookId);
      setArResult(data);
      setActiveTab("ar");
      setAiOpen(false);
    });
  }

  async function searchFromSource(source) {
    const title = source?.title || "";
    if (!title) return;
    await withAction(async () => {
      setQuery(title);
      const { data } = await api.get("/search/semantic", { params: { q: title, limit: 20 } });
      setSemantic(data);
      setActiveTab("search");
      setAiOpen(false);
    });
  }

  async function fetchAR() {
    if (!arBookId) return;
    await withAction(async () => {
      const { data } = await api.get(`/navigation/ar/${arBookId}`);
      setArResult(data);
    });
  }

  async function saveResearchProject(projectId, updates, successText) {
    await withAction(async () => {
      await api.put(`/research/${projectId}`, updates);
      await loadResearch();
    }, successText);
  }

  async function addResearch() {
    if (!researchForm.topic.trim()) {
      setMessage("Add a project topic to create a research workspace.");
      return;
    }

    await withAction(async () => {
      await api.post("/research", {
        topic: researchForm.topic.trim(),
        researchQuestion: researchForm.researchQuestion.trim(),
        methodology: researchForm.methodology.trim(),
        status: researchForm.status,
        keywords: researchForm.keywords.split(",").map((item) => item.trim()).filter(Boolean),
        notes: researchForm.notes.trim(),
        targetCompletionDate: researchForm.targetCompletionDate || null,
      });
      setResearchForm(initialResearchForm);
      setShowResearchForm(false);
      await loadResearch();
    }, "Research project created");
  }

  async function updateResearchStatus(projectId, nextStatus) {
    const project = research.find((item) => item._id === projectId);
    if (!project) return;
    await saveResearchProject(projectId, { ...project, status: nextStatus }, "Project status updated");
  }

  async function toggleResearchTask(projectId, taskIndex) {
    const project = research.find((item) => item._id === projectId);
    if (!project) return;

    const tasks = getResearchTasks(project).map((task, index) => (
      index === taskIndex
        ? { ...task, status: taskStatusCycle[task.status] || "todo" }
        : task
    ));

    await saveResearchProject(projectId, { ...project, tasks }, "Task progress updated");
  }

  async function addTaskToProject(projectId) {
    const title = String(taskDrafts[projectId] || "").trim();
    if (!title) {
      setMessage("Add a task title before saving it.");
      return;
    }

    const project = research.find((item) => item._id === projectId);
    if (!project) return;

    const tasks = [...getResearchTasks(project), { title, status: "todo", dueDate: null, notes: "" }];
    await saveResearchProject(projectId, { ...project, tasks }, "Task added");
    setTaskDrafts((prev) => ({ ...prev, [projectId]: "" }));
  }

  async function removeTaskFromProject(projectId, taskIndex) {
    const project = research.find((item) => item._id === projectId);
    if (!project) return;

    const tasks = getResearchTasks(project).filter((_, index) => index !== taskIndex);
    await saveResearchProject(projectId, { ...project, tasks }, "Task removed");
  }

  async function subscribe(bookId) {
    await withAction(async () => {
      await api.post("/alerts/subscriptions", { bookId });
      await loadSubscriptions();
    }, "Stock alert subscribed");
  }

  async function unsubscribe(bookId) {
    await withAction(async () => {
      await api.delete(`/alerts/subscriptions/${bookId}`);
      await loadSubscriptions();
    }, "Subscription removed");
  }

  async function runReminderSimulation() {
    await withAction(async () => {
      await api.get("/loans/reminders/simulate");
    }, "Reminder simulation generated");
  }

  function openInventoryWithStockFilter(stockFilter) {
    setInventoryStockFilter(stockFilter);
    setActiveTab("inventory");
  }

  function openBorrowersWithFilter(filter) {
    setBorrowersFilter(filter);
    setActiveTab("borrowers");
  }

  function openFinesWithFilter(filter) {
    setFinesFilter(filter);
    setActiveTab("fines");
  }

  function openAlertsWithFilter(filter) {
    setAlertsFilter(filter);
    setActiveTab("alerts");
  }

  function getRecommendedBooksForProject(project) {
    return [...books]
      .map((book) => {
        const score = scoreBookForProject(project, book);
        return {
          book,
          score,
          insight: buildBookInsight(project, book, books),
        };
      })
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 8);
  }

  const isAdmin = adminRoles.includes(user?.role);
  const isApprovalAdmin = adminRoles.includes(user?.role);
  const tabs = isAdmin ? adminTabs : studentTabs;

  const activeLoans = useMemo(() => loans.filter(isActiveLoan), [loans]);
  const pendingReservations = useMemo(() => loans.filter(isPendingLoan), [loans]);
  const rejectedReservations = useMemo(() => loans.filter((loan) => loan.status === "rejected"), [loans]);
  const dueSoonLoans = useMemo(
    () => activeLoans.filter((loan) => daysLeft(loan.dueDate) >= 0 && daysLeft(loan.dueDate) <= 3),
    [activeLoans, timeMarker]
  );
  const pendingFines = useMemo(() => fines.filter((fine) => fine.status === "pending"), [fines]);
  const outstandingFine = useMemo(
    () => pendingFines.reduce((sum, fine) => sum + fine.amount, 0),
    [pendingFines]
  );
  const pendingFineCount = useMemo(() => pendingFines.length, [pendingFines]);
  const paidFineCount = useMemo(() => fines.filter((fine) => fine.status === "paid").length, [fines]);
  const lowStockCount = useMemo(() => books.filter((book) => book.stock <= 2).length, [books]);
  const outOfStockCount = useMemo(() => books.filter((book) => book.stock === 0).length, [books]);
  const highDemandCount = useMemo(() => demand.filter((item) => item.demandScore >= 40).length, [demand]);
  const overdues = useMemo(() => activeLoans.filter((loan) => daysLeft(loan.dueDate) < 0).length, [activeLoans, timeMarker]);
  const unreadAlertsCount = useMemo(() => alerts.filter((a) => !a.read).length, [alerts]);
  const readAlertsCount = useMemo(() => alerts.filter((a) => a.read).length, [alerts]);
  const availabilityRate = useMemo(
    () => (books.length ? Math.round(((books.length - outOfStockCount) / books.length) * 100) : 0),
    [books.length, outOfStockCount]
  );
  const demandPressureRate = useMemo(
    () => (books.length ? Math.round((highDemandCount / books.length) * 100) : 0),
    [books.length, highDemandCount]
  );
  const onTimeReturnRate = useMemo(
    () => (activeLoans.length ? Math.round(((activeLoans.length - overdues) / activeLoans.length) * 100) : 100),
    [activeLoans.length, overdues]
  );
  const categories = useMemo(() => ["All", ...new Set(books.map((b) => b.category))], [books]);
  const inventoryRows = useMemo(
    () =>
      books.filter((book) => {
        if (inventoryFilter !== "All" && book.category !== inventoryFilter) return false;
        if (inventoryStockFilter === "low" && book.stock > 2) return false;
        if (inventoryStockFilter === "out" && book.stock !== 0) return false;
        if (!inventorySearch.trim()) return true;
        const q = inventorySearch.toLowerCase();
        return (
          book.title.toLowerCase().includes(q)
          || book.author.toLowerCase().includes(q)
          || book.category.toLowerCase().includes(q)
        );
      }),
    [books, inventoryFilter, inventorySearch, inventoryStockFilter]
  );
  const borrowerRows = useMemo(
    () => activeLoans.filter((loan) => {
      if (borrowersFilter === "overdue") return daysLeft(loan.dueDate) < 0;
      if (borrowersFilter === "dueSoon") {
        const days = daysLeft(loan.dueDate);
        return days >= 0 && days <= 3;
      }
      return true;
    }),
    [activeLoans, borrowersFilter, timeMarker]
  );
  const reservationRows = useMemo(
    () => pendingReservations.filter((loan) => {
      if (borrowersFilter === "overdue") return false;
      if (borrowersFilter === "dueSoon") return false;
      return true;
    }),
    [pendingReservations, borrowersFilter]
  );
  const fineRows = useMemo(
    () => fines.filter((fine) => {
      if (finesFilter === "pending") return fine.status === "pending";
      if (finesFilter === "paid") return fine.status === "paid";
      return true;
    }),
    [fines, finesFilter]
  );
  const alertRows = useMemo(
    () => alerts.filter((alert) => {
      if (alertsFilter === "unread") return !alert.read;
      if (alertsFilter === "read") return alert.read;
      return true;
    }),
    [alerts, alertsFilter]
  );
  const topTopics = useMemo(
    () => [...demand].sort((a, b) => b.demandScore - a.demandScore).slice(0, 4),
    [demand]
  );
  const studentDateLabel = useMemo(() => fmtLongDate(timeMarker), [timeMarker]);
  const researchDueSoonCount = useMemo(
    () => research.filter((project) => {
      if (!project?.targetCompletionDate || project.status === "completed") return false;
      const daysUntilDue = daysLeft(project.targetCompletionDate);
      return daysUntilDue >= 0 && daysUntilDue <= 7;
    }).length,
    [research, timeMarker]
  );
  const recentActivity = useMemo(() => {
    const items = [];

    const borrowed = [...loans]
      .filter((loan) => loan.borrowDate)
      .sort((a, b) => new Date(b.borrowDate) - new Date(a.borrowDate))[0];
    if (borrowed?.book?.title) {
      items.push({
        key: `borrowed-${borrowed._id}`,
        icon: "📖",
        title: `Borrowed \"${borrowed.book.title}\"`,
        meta: timeAgo(borrowed.borrowDate),
      });
    }

    const dueSoon = [...activeLoans]
      .filter((loan) => daysLeft(loan.dueDate) >= 0 && daysLeft(loan.dueDate) <= 3)
      .sort((a, b) => daysLeft(a.dueDate) - daysLeft(b.dueDate))[0];
    if (dueSoon?.book?.title) {
      items.push({
        key: `due-${dueSoon._id}`,
        icon: "⚠️",
        title: `\"${dueSoon.book.title}\" due in ${daysLeft(dueSoon.dueDate)} day${daysLeft(dueSoon.dueDate) === 1 ? "" : "s"}`,
        action: canRequestRenewal(dueSoon)
          ? { label: "Request Renewal", onClick: () => renewLoan(dueSoon._id) }
          : undefined,
      });
    }

    const returned = [...loans]
      .filter((loan) => loan.returnedAt)
      .sort((a, b) => new Date(b.returnedAt) - new Date(a.returnedAt))[0];
    if (returned?.book?.title) {
      items.push({
        key: `returned-${returned._id}`,
        icon: "✅",
        title: `Returned \"${returned.book.title}\"`,
        meta: timeAgo(returned.returnedAt),
      });
    }

    return items.slice(0, 3);
  }, [activeLoans, loans, timeMarker]);

  const latestAiRuntime = useMemo(
    () => [...aiMessages].reverse().find((entry) => entry.role === "ai" && (entry.model || entry.provider || entry.warning)) || null,
    [aiMessages]
  );
  const aiQuickPrompts = useMemo(() => {
    const dynamic = latestAiRuntime?.suggestedPrompts?.length
      ? latestAiRuntime.suggestedPrompts
      : [
        query ? `Help me search for "${query}" using better keywords.` : "",
        research[0]?.topic ? `Turn "${research[0].topic}" into a research question and search plan.` : "",
        "Show me how to compare the top 3 relevant books for my topic.",
        "Suggest a simple literature review workflow using the library catalog.",
      ];

    return uniqueList(dynamic).slice(0, 4);
  }, [latestAiRuntime, query, research]);

  const arFloors = {
    1: ["CH-05", "BI-08", "BI-02"],
    2: ["CS-12", "CS-14", "MA-03"],
    3: ["EC-01", "HI-11"],
  };

  if (!user) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>LibConnect Pro</h1>
          <p>University Library Intelligent Management Platform</p>
          <form onSubmit={login} className="auth-form">
            <input
              value={authForm.email}
              onChange={(e) => setAuthForm((prev) => ({ ...prev, email: e.target.value }))}
              placeholder="Email"
              type="email"
              required
            />
            <input
              value={authForm.password}
              onChange={(e) => setAuthForm((prev) => ({ ...prev, password: e.target.value }))}
              placeholder="Password"
              type="password"
              required
            />
            <button type="submit">Sign In</button>
          </form>
          <small>Use admin@uni.edu or aisha@uni.edu with password123</small>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>LibConnect Pro</h1>
          <p>{isAdmin ? "Librarian Portal" : "Student and Faculty Portal"}</p>
        </div>
        <div className="topbar-actions">
          <span className="user-pill">{user.name}</span>
          <button onClick={() => setToken("")}>Logout</button>
        </div>
      </header>

      <nav className="tabs">
        {tabs.map((tab) => (
          <button key={tab.key} className={activeTab === tab.key ? "active" : ""} onClick={() => setActiveTab(tab.key)}>
            {tab.label}
            {tab.key === "alerts" && alerts.filter((a) => !a.read).length ? (
              <span className="badge-dot">{alerts.filter((a) => !a.read).length}</span>
            ) : null}
          </button>
        ))}
      </nav>

      <main className="content">
        {message ? <div className="notice">{message}</div> : null}

        {isAdmin && activeTab === "dashboard" ? (
          <>
            <section className="panel admin-hero-panel">
              <div className="admin-hero-copy">
                <p className="home-eyebrow">Library Operations</p>
                <h2>Operations at a glance</h2>
                <p>{fmtLongDate(new Date())}</p>
              </div>
              <div className="admin-hero-metrics">
                <div
                  className="admin-hero-chip clickable-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => openInventoryWithStockFilter("all")}
                  onKeyDown={(e) => {
                    if (!keyActivatesCard(e)) return;
                    e.preventDefault();
                    openInventoryWithStockFilter("all");
                  }}
                >
                  <span>📚 Collection</span>
                  <strong>{books.length}</strong>
                </div>
                <div
                  className="admin-hero-chip clickable-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => openBorrowersWithFilter("dueSoon")}
                  onKeyDown={(e) => {
                    if (!keyActivatesCard(e)) return;
                    e.preventDefault();
                    openBorrowersWithFilter("dueSoon");
                  }}
                >
                  <span>⏰ Due soon</span>
                  <strong>{dueSoonLoans.length}</strong>
                </div>
                <div
                  className="admin-hero-chip clickable-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => openAlertsWithFilter("unread")}
                  onKeyDown={(e) => {
                    if (!keyActivatesCard(e)) return;
                    e.preventDefault();
                    openAlertsWithFilter("unread");
                  }}
                >
                  <span>🔔 Unread alerts</span>
                  <strong>{unreadAlertsCount}</strong>
                </div>
              </div>
            </section>

            <section className="grid-4">
              <article
                className="card admin-stat-card tone-blue clickable-card"
                role="button"
                tabIndex={0}
                onClick={() => openInventoryWithStockFilter("all")}
                onKeyDown={(e) => {
                  if (!keyActivatesCard(e)) return;
                  e.preventDefault();
                  openInventoryWithStockFilter("all");
                }}
              >
                <div className="student-stat-head"><span className="student-stat-icon">📚</span><h3>Total Books</h3></div>
                <strong>{books.length}</strong>
                <p>{outOfStockCount} out of stock</p>
                <small>{lowStockCount} titles need replenishment review</small>
              </article>
              <article
                className="card admin-stat-card tone-cyan clickable-card"
                role="button"
                tabIndex={0}
                onClick={() => openBorrowersWithFilter("all")}
                onKeyDown={(e) => {
                  if (!keyActivatesCard(e)) return;
                  e.preventDefault();
                  openBorrowersWithFilter("all");
                }}
              >
                <div className="student-stat-head"><span className="student-stat-icon">📖</span><h3>Active Loans</h3></div>
                <strong>{activeLoans.length}</strong>
                <p>{dueSoonLoans.length} due soon</p>
                <small>{overdues} overdue across current borrowers</small>
              </article>
              <article
                className="card admin-stat-card tone-amber clickable-card"
                role="button"
                tabIndex={0}
                onClick={() => openFinesWithFilter("pending")}
                onKeyDown={(e) => {
                  if (!keyActivatesCard(e)) return;
                  e.preventDefault();
                  openFinesWithFilter("pending");
                }}
              >
                <div className="student-stat-head"><span className="student-stat-icon">💰</span><h3>Pending Fines</h3></div>
                <strong>${outstandingFine.toFixed(2)}</strong>
                <p>{pendingFineCount} unpaid record(s)</p>
                <small>{pendingFineCount ? "Payment verification required" : "No fine blockers right now"}</small>
              </article>
              <article
                className="card admin-stat-card tone-rose clickable-card"
                role="button"
                tabIndex={0}
                onClick={() => openAlertsWithFilter("unread")}
                onKeyDown={(e) => {
                  if (!keyActivatesCard(e)) return;
                  e.preventDefault();
                  openAlertsWithFilter("unread");
                }}
              >
                <div className="student-stat-head"><span className="student-stat-icon">🔔</span><h3>Unread Alerts</h3></div>
                <strong>{unreadAlertsCount}</strong>
                <p>{highDemandCount} high-demand title(s)</p>
                <small>{unreadAlertsCount ? "Review notifications queue" : "Alert queue is clear"}</small>
              </article>
            </section>

            <section className="grid-4">
              <article
                className="card mini-stat clickable-card"
                role="button"
                tabIndex={0}
                onClick={() => setActiveTab("demand")}
                onKeyDown={(e) => {
                  if (!keyActivatesCard(e)) return;
                  e.preventDefault();
                  setActiveTab("demand");
                }}
              >
                <h4>🔥 High Demand Titles</h4>
                <strong>{highDemandCount}</strong>
              </article>
              <article
                className="card mini-stat clickable-card"
                role="button"
                tabIndex={0}
                onClick={() => openInventoryWithStockFilter("low")}
                onKeyDown={(e) => {
                  if (!keyActivatesCard(e)) return;
                  e.preventDefault();
                  openInventoryWithStockFilter("low");
                }}
              >
                <h4>📦 Low Stock Books</h4>
                <strong>{lowStockCount}</strong>
              </article>
              <article
                className="card mini-stat clickable-card"
                role="button"
                tabIndex={0}
                onClick={() => openInventoryWithStockFilter("out")}
                onKeyDown={(e) => {
                  if (!keyActivatesCard(e)) return;
                  e.preventDefault();
                  openInventoryWithStockFilter("out");
                }}
              >
                <h4>🚫 Out of Stock</h4>
                <strong>{outOfStockCount}</strong>
              </article>
              <article
                className="card mini-stat clickable-card"
                role="button"
                tabIndex={0}
                onClick={() => openBorrowersWithFilter("overdue")}
                onKeyDown={(e) => {
                  if (!keyActivatesCard(e)) return;
                  e.preventDefault();
                  openBorrowersWithFilter("overdue");
                }}
              >
                <h4>⏳ Overdue Loans</h4>
                <strong>{overdues}</strong>
              </article>
            </section>

            <section className="panel health-panel">
              <div className="section-head">
                <h2>Collection Health</h2>
                <span className="head-note">Live Operational Snapshot</span>
              </div>
              <div className="health-summary-grid">
                <article className="health-summary-card">
                  <span>Availability</span>
                  <strong>{availabilityRate}%</strong>
                  <small>{books.length - outOfStockCount} titles ready to circulate</small>
                </article>
                <article className="health-summary-card">
                  <span>Demand Pressure</span>
                  <strong>{demandPressureRate}%</strong>
                  <small>{highDemandCount} titles need closer monitoring</small>
                </article>
                <article className="health-summary-card">
                  <span>On-time Returns</span>
                  <strong>{onTimeReturnRate}%</strong>
                  <small>{Math.max(activeLoans.length - overdues, 0)} loans still on schedule</small>
                </article>
              </div>
              <div className="health-bars">
                <div className="health-row">
                  <span>Availability</span>
                  <div className="health-track"><span style={{ width: `${availabilityRate}%` }} className="fill-availability" /></div>
                  <strong>{availabilityRate}%</strong>
                </div>
                <div className="health-row">
                  <span>Demand Pressure</span>
                  <div className="health-track"><span style={{ width: `${demandPressureRate}%` }} className="fill-demand" /></div>
                  <strong>{demandPressureRate}%</strong>
                </div>
                <div className="health-row">
                  <span>On-time Returns</span>
                  <div className="health-track"><span style={{ width: `${onTimeReturnRate}%` }} className="fill-returns" /></div>
                  <strong>{onTimeReturnRate}%</strong>
                </div>
              </div>
            </section>

            <section className="grid-2">
              <article className="panel alerts-panel">
                <div className="section-head">
                  <div>
                    <h2>Critical Alerts</h2>
                    <p className="muted">Unread: {unreadAlertsCount} • Due-soon reminders and stock warnings in one queue</p>
                  </div>
                  <button onClick={runReminderSimulation}>Run Due-Reminder Cycle</button>
                </div>
                <div className="stack">
                  {alerts.slice(0, 6).map((alert) => (
                    <div key={alert._id} className="alert-row alert-item">
                      <div>
                        <strong>{alert.type.toUpperCase()}</strong>
                        <p>{alert.message}</p>
                      </div>
                      {!alert.read ? <button onClick={() => markAlertRead(alert._id)}>Mark Read</button> : <span className="muted">Read</span>}
                    </div>
                  ))}
                  {!alerts.length ? (
                    <div className="alert-row alert-item empty-admin-row">
                      <div>
                        <strong>No active alerts</strong>
                        <p>The queue is clear right now.</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </article>

              <article className="panel fine-panel">
                <div className="section-head">
                  <h2>Fine Blocker Rules</h2>
                  <span className="policy-chip">Auto-Enforced</span>
                </div>
                <p className="muted">Reservations and approvals are blocked whenever a user has unpaid fines. Payment verification clears access automatically.</p>
                <div className="fine-metrics-grid">
                  <article className="fine-metric-card">
                    <span>Pending fine records</span>
                    <strong>{analytics?.fines?.pendingRecords ?? pendingFineCount}</strong>
                  </article>
                  <article className="fine-metric-card">
                    <span>Blocked users</span>
                    <strong>{analytics?.fines?.blockedUsers ?? 0}</strong>
                  </article>
                  <article className="fine-metric-card">
                    <span>Outstanding fine balance</span>
                    <strong>${Number(analytics?.fines?.totalOutstanding ?? outstandingFine).toFixed(2)}</strong>
                  </article>
                </div>
                <p className="muted">Any borrower fine or manual fine-resolution step now shows up in the shared alert feed for admins, librarians, and staff.</p>
                <div className="stack compact admin-rule-list">
                  <div className="line-item"><span>1. Payment submitted</span><strong>Await verification</strong></div>
                  <div className="line-item"><span>2. Librarian verifies</span><strong>Clear blocker</strong></div>
                  <div className="line-item"><span>3. Reservation approval restored</span><strong>Immediate</strong></div>
                </div>
              </article>
            </section>
          </>
        ) : null}

        {isAdmin && activeTab === "inventory" ? (
          <section className="panel">
            <div className="row between">
              <h2>Inventory Manager</h2>
              <div className="row">
                <input
                  value={inventorySearch}
                  onChange={(e) => setInventorySearch(e.target.value)}
                  placeholder="Search by title, author, category"
                />
                <select value={inventoryFilter} onChange={(e) => setInventoryFilter(e.target.value)}>
                  {categories.map((cat) => <option key={cat}>{cat}</option>)}
                </select>
                <select value={inventoryStockFilter} onChange={(e) => setInventoryStockFilter(e.target.value)}>
                  <option value="all">All Stock Levels</option>
                  <option value="low">Low Stock (0-2)</option>
                  <option value="out">Out of Stock (0)</option>
                </select>
              </div>
            </div>

            <form className="form-grid" onSubmit={createBook}>
              <input placeholder="Code" value={bookForm.code} onChange={(e) => setBookForm((f) => ({ ...f, code: e.target.value }))} required />
              <input placeholder="Title" value={bookForm.title} onChange={(e) => setBookForm((f) => ({ ...f, title: e.target.value }))} required />
              <input placeholder="Author" value={bookForm.author} onChange={(e) => setBookForm((f) => ({ ...f, author: e.target.value }))} required />
              <input placeholder="Category" value={bookForm.category} onChange={(e) => setBookForm((f) => ({ ...f, category: e.target.value }))} required />
              <input placeholder="ISBN" value={bookForm.isbn} onChange={(e) => setBookForm((f) => ({ ...f, isbn: e.target.value }))} required />
              <input placeholder="Cover image URL (optional)" value={bookForm.coverImageUrl} onChange={(e) => setBookForm((f) => ({ ...f, coverImageUrl: e.target.value }))} />
              <input type="number" min="0" placeholder="Stock" value={bookForm.stock} onChange={(e) => setBookForm((f) => ({ ...f, stock: Number(e.target.value) }))} required />
              <input type="number" min="0" placeholder="Total Copies" value={bookForm.totalCopies} onChange={(e) => setBookForm((f) => ({ ...f, totalCopies: Number(e.target.value) }))} required />
              <button type="submit">Add Book</button>
            </form>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Cover</th><th>Title</th><th>Author</th><th>Category</th><th>Stock</th><th>Borrow Pressure</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {inventoryRows.map((book) => (
                    <tr key={book._id}>
                      <td><BookCover book={book} compact /></td>
                      <td>{book.title}</td>
                      <td>{book.author}</td>
                      <td>{book.category}</td>
                      <td>{book.stock}/{book.totalCopies}</td>
                      <td>
                        <div className="stack compact">
                          <div className="demand-cell">
                            <div className="demand-track">
                              <span
                                className={`demand-fill ${toneByBorrowPressure(getBorrowPressurePercent(book))}`}
                                style={{ width: `${getBorrowPressurePercent(book)}%` }}
                              />
                            </div>
                            <span className={`pill ${toneByBorrowPressure(getBorrowPressurePercent(book))}`}>{getBorrowPressurePercent(book)}%</span>
                          </div>
                          <span className="muted">{formatBorrowPressure(book)} • score {book.demandScore}</span>
                        </div>
                      </td>
                      <td><button onClick={() => deleteBook(book._id)}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {isAdmin && activeTab === "borrowers" ? (
          <section className="panel table-wrap">
            <div className="row between">
              <h2>Reservation Queue and Active Loans</h2>
              <select value={borrowersFilter} onChange={(e) => setBorrowersFilter(e.target.value)}>
                <option value="all">All Active Loans ({activeLoans.length})</option>
                <option value="dueSoon">Due Soon (0-3 days) ({dueSoonLoans.length})</option>
                <option value="overdue">Overdue Only ({overdues})</option>
              </select>
            </div>
            <p className="muted">Students place reservations first. Renewals and returns are also processed only after admin review.</p>

            <h3>Pending Reservations</h3>
            {!isApprovalAdmin ? <p className="muted">Only library staff with loan-management access can approve or reject reservations.</p> : null}
            <table>
              <thead>
                <tr><th>User</th><th>Book</th><th>Requested</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {reservationRows.map((loan) => (
                  <tr key={loan._id}>
                    <td>{loan.user?.name}</td>
                    <td>{loan.book?.title}</td>
                    <td>{fmtDate(loan.requestDate || loan.createdAt)}</td>
                    <td><span className="pill warn">Pending</span></td>
                    <td className="row">
                      {isApprovalAdmin ? (
                        <>
                          <button onClick={() => approveReservation(loan._id)}>Approve</button>
                          <button className="subtle" onClick={() => rejectReservation(loan._id)}>Reject</button>
                        </>
                      ) : (
                        <span className="muted">Admin only</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!reservationRows.length ? (
                  <tr>
                    <td colSpan="5" className="muted">No pending reservations.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>

            <h3>Approved Active Loans</h3>
            <table>
              <thead>
                <tr><th>User</th><th>Book</th><th>Borrowed</th><th>Due</th><th>Status</th><th>Policy</th><th>Requests</th><th>Renewals</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {borrowerRows.map((loan) => (
                  <tr key={loan._id}>
                    <td>{loan.user?.name}</td>
                    <td>{loan.book?.title}</td>
                    <td>{fmtDate(loan.borrowDate)}</td>
                    <td>{fmtDate(loan.dueDate)}</td>
                    <td>
                      {daysLeft(loan.dueDate) < 0 ? <span className="pill danger">Overdue</span> : <span className="pill ok">Active</span>}
                    </td>
                    <td>
                      <div className="stack compact">
                        <span>{getLoanPolicyView(loan).label}</span>
                        {getLoanPolicyView(loan).tier ? <span className="muted">{formatWorkflowLabel(getLoanPolicyView(loan).tier)} policy</span> : null}
                      </div>
                    </td>
                    <td>
                      {hasPendingRenewal(loan) ? <span className="pill warn">Renewal Request</span> : null}
                      {!hasPendingRenewal(loan) && hasPendingReturn(loan) ? <span className="pill warn">Return Request</span> : null}
                      {!hasPendingRenewal(loan) && !hasPendingReturn(loan) && hasRejectedReturn(loan) ? <span className="pill danger">Return Rejected</span> : null}
                      {!hasPendingRenewal(loan) && !hasPendingReturn(loan) && !hasRejectedReturn(loan) ? <span className="muted">None</span> : null}
                      {hasRejectedReturn(loan) && loan.returnRejectionReason ? <div className="muted">Reason: {loan.returnRejectionReason}</div> : null}
                    </td>
                    <td>{loan.renewalCount}/{loan.maxRenewals}</td>
                    <td className="row">
                      {isApprovalAdmin && hasPendingRenewal(loan) ? (
                        <>
                          <button onClick={() => approveRenewal(loan._id)}>Approve Renewal</button>
                          <button className="subtle" onClick={() => rejectRenewal(loan._id)}>Reject Renewal</button>
                        </>
                      ) : null}
                      {isApprovalAdmin && hasPendingReturn(loan) ? (
                        <>
                          <button onClick={() => processReturn(loan._id)}>Process Return</button>
                          <button className="subtle" onClick={() => rejectReturn(loan._id)}>Reject Return</button>
                        </>
                      ) : null}
                      {(!isApprovalAdmin || (!hasPendingRenewal(loan) && !hasPendingReturn(loan))) ? <span className="muted">No action</span> : null}
                    </td>
                  </tr>
                ))}
                {!borrowerRows.length ? (
                  <tr>
                    <td colSpan="9" className="muted">No active approved loans for this filter.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>
        ) : null}

        {isAdmin && activeTab === "fines" ? (
          <section className="panel table-wrap">
            <div className="row between">
              <h2>Fine Clearance</h2>
              <select value={finesFilter} onChange={(e) => setFinesFilter(e.target.value)}>
                <option value="all">All Fines ({fines.length})</option>
                <option value="pending">Pending Only ({pendingFineCount})</option>
                <option value="paid">Paid Only ({paidFineCount})</option>
              </select>
            </div>
            <table>
              <thead>
                <tr><th>User</th><th>Reason</th><th>Amount</th><th>Status</th><th>Resolution</th><th>Action</th></tr>
              </thead>
              <tbody>
                {fineRows.map((fine) => (
                  <tr key={fine._id}>
                    <td>{fine.user?.name}</td>
                    <td>{fine.reason}</td>
                    <td>${fine.amount.toFixed(2)}</td>
                    <td><span className={`pill ${fine.status === "pending" ? "warn" : "ok"}`}>{fine.status}</span></td>
                    <td>{fine.resolutionNote || <span className="muted">-</span>}</td>
                    <td>
                      {fine.status === "pending" ? (
                        <div className="row">
                          <button onClick={() => verifyFine(fine._id)}>Verify Payment</button>
                          {isApprovalAdmin ? <button className="subtle" onClick={() => waiveFine(fine._id)}>Waive</button> : null}
                        </div>
                      ) : <span className="muted">Closed</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {isAdmin && activeTab === "demand" ? (
          <section className="panel table-wrap">
            <h2>Demand Predictor</h2>
            <table>
              <thead>
                <tr><th>Book</th><th>Borrow Pressure</th><th>Exam Impact</th><th>Stock</th><th>Recommendation</th><th>Signals</th></tr>
              </thead>
              <tbody>
                {demand.map((item) => (
                  <tr key={item.bookId}>
                    <td>{item.title}</td>
                    <td>
                      <div className="stack compact">
                        <div className="demand-cell">
                          <div className="demand-track">
                            <span
                              className={`demand-fill ${toneByBorrowPressure(getBorrowPressurePercent(item))}`}
                              style={{ width: `${getBorrowPressurePercent(item)}%` }}
                            />
                          </div>
                          <span className={`pill ${toneByBorrowPressure(getBorrowPressurePercent(item))}`}>{getBorrowPressurePercent(item)}%</span>
                        </div>
                        <span className="muted">{formatBorrowPressure(item)} • score {item.demandScore}</span>
                      </div>
                    </td>
                    <td>{item.examSeasonImpact}</td>
                    <td>{item.stock}/{item.totalCopies}</td>
                    <td>{item.recommendation}</td>
                    <td>{Array.isArray(item.signalSummary) && item.signalSummary.length ? item.signalSummary.join(", ") : "Baseline catalog demand"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {isAdmin && activeTab === "analytics" ? (
          <>
            <section className="panel">
              <div className="section-head">
                <h2>Analytics Overview</h2>
                <button className="subtle" onClick={loadAnalytics} disabled={analyticsLoading}>
                  {analyticsLoading ? "Refreshing..." : "Refresh"}
                </button>
              </div>
              {analyticsError ? <p className="muted">{analyticsError}</p> : <p className="muted">Library usage, engagement, and demand trends.</p>}
            </section>
            {analyticsLoading ? (
              <section className="grid-3 analytics-skeleton-grid">
                <article className="card stat-card analytics-skeleton-card"><span className="analytics-skeleton-line" /><span className="analytics-skeleton-value" /></article>
                <article className="card stat-card analytics-skeleton-card"><span className="analytics-skeleton-line" /><span className="analytics-skeleton-value" /></article>
                <article className="card stat-card analytics-skeleton-card"><span className="analytics-skeleton-line" /><span className="analytics-skeleton-value" /></article>
              </section>
            ) : (
              <section className="grid-3">
                <article className="card stat-card"><h3>Total Users</h3><strong>{analytics?.totals?.totalUsers ?? 0}</strong></article>
                <article className="card stat-card"><h3>Students</h3><strong>{analytics?.userSegments?.student ?? 0}</strong></article>
                <article className="card stat-card"><h3>Faculty</h3><strong>{analytics?.userSegments?.faculty ?? 0}</strong></article>
              </section>
            )}
            <section className="grid-2">
              <article className="panel">
                <h2>Top Research Topics</h2>
                <div className="stack compact">
                  {topTopics.map((topic) => (
                    <div key={topic.bookId} className="line-item">
                      <span>{topic.title}</span>
                      <strong>{topic.demandScore}</strong>
                    </div>
                  ))}
                  {!topTopics.length ? <p className="muted">No demand analytics yet. Borrow activity will populate this list.</p> : null}
                </div>
              </article>
              <article className="panel">
                <h2>Engagement Snapshot</h2>
                <div className="stack compact">
                  <div className="line-item"><span>Search to borrow trend</span><strong>68%</strong></div>
                  <div className="line-item"><span>On-time return trend</span><strong>82%</strong></div>
                  <div className="line-item"><span>AI helper weekly chats</span><strong>{aiMessages.length}</strong></div>
                </div>
              </article>
            </section>
          </>
        ) : null}

        {isAdmin && activeTab === "alerts" ? (
          <section className="panel">
            <div className="row between">
              <h2>Notification Center</h2>
              <select value={alertsFilter} onChange={(e) => setAlertsFilter(e.target.value)}>
                <option value="all">All Alerts ({alerts.length})</option>
                <option value="unread">Unread Only ({unreadAlertsCount})</option>
                <option value="read">Read Only ({readAlertsCount})</option>
              </select>
            </div>
            <div className="stack">
              {alertRows.map((alertItem) => (
                <article key={alertItem._id} className="alert-row">
                  <div>
                    <strong>{alertItem.type.toUpperCase()}</strong>
                    <p>{alertItem.message}</p>
                  </div>
                  {!alertItem.read ? <button onClick={() => markAlertRead(alertItem._id)}>Mark Read</button> : <span className="muted">Read</span>}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {!isAdmin && activeTab === "home" ? (
          <>
            <section className="panel home-welcome-panel">
              <div className="home-welcome-copy">
                <p className="home-eyebrow">Student Dashboard</p>
                <h2>Welcome back, {user.name} 👋</h2>
                <p>{studentDateLabel}</p>
              </div>
              <form className="home-search" onSubmit={runHomeSearch}>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search for a book, topic, or author..."
                />
                <button type="submit">Search</button>
              </form>
            </section>

            <section className="grid-4">
              <article className="card student-stat-card tone-blue" onClick={() => setActiveTab("loans")} role="button" tabIndex={0}>
                <div className="student-stat-head"><span className="student-stat-icon">📚</span><h3>Active Loans</h3></div>
                <strong>{activeLoans.length}</strong>
                <p>{activeLoans.length ? `${dueSoonLoans.length} due soon` : "No active loans"}</p>
                <small>{activeLoans.length ? "Tap to manage loans" : "Browse books to get started →"}</small>
              </article>
              <article className="card student-stat-card tone-amber" onClick={() => setActiveTab("account")} role="button" tabIndex={0}>
                <div className="student-stat-head"><span className="student-stat-icon">💰</span><h3>Outstanding Fines</h3></div>
                <strong>${outstandingFine.toFixed(2)}</strong>
                <p>{outstandingFine > 0 ? `${pendingFineCount} pending item(s)` : "You're clear ✅"}</p>
                <small>{outstandingFine > 0 ? "Review account status" : "No payment action needed"}</small>
              </article>
              <article className="card student-stat-card tone-rose" onClick={() => setActiveTab("loans")} role="button" tabIndex={0}>
                <div className="student-stat-head"><span className="student-stat-icon">🔔</span><h3>Stock Alerts</h3></div>
                <strong>{subscriptions.length}</strong>
                <p>{subscriptions.length ? "Tap to view" : "No active alerts"}</p>
                <small>{subscriptions.length ? "Monitor restocks from My Loans" : "Subscribe from search results"}</small>
              </article>
              <article className="card student-stat-card tone-cyan" onClick={() => setActiveTab("research")} role="button" tabIndex={0}>
                <div className="student-stat-head"><span className="student-stat-icon">📁</span><h3>Research Projects</h3></div>
                <strong>{research.length}</strong>
                <p>{researchDueSoonCount ? `${researchDueSoonCount} due soon` : research.length ? "Stay on track" : "No projects yet"}</p>
                <small>{research.length ? "Open tracker to manage sources and writing tasks" : "Create your first project →"}</small>
              </article>
            </section>

            {dueSoonLoans.length ? (
              <section className="panel">
                <h2>Due Soon Reminders</h2>
                <div className="stack">
                  {dueSoonLoans.map((loan) => (
                    <article className="alert-row" key={loan._id}>
                      <div>
                        <strong>{loan.book?.title}</strong>
                        <p>Due in {daysLeft(loan.dueDate)} day(s)</p>
                      </div>
                      <span className="pill warn">Reminder</span>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="grid-3">
              <article className="tile home-tile">
                <div className="home-tile-icon">🔍</div>
                <h3>Search</h3>
                <p>Find books by topic, not just keywords.</p>
                <button onClick={() => setActiveTab("search")}>Search Now →</button>
              </article>
              <article className="tile home-tile">
                <div className="home-tile-icon">🤖</div>
                <h3>AI Research Helper</h3>
                <p>Get instant research guidance 24/7.</p>
                <button onClick={() => setAiOpen(true)}>Ask Now →</button>
              </article>
              <article className="tile home-tile">
                <div className="home-tile-icon">📍</div>
                <h3>AR Navigator</h3>
                <p>Locate any book on the shelf instantly.</p>
                <button onClick={() => setActiveTab("ar")}>Find a Book →</button>
              </article>
            </section>

            <section className="panel">
              <div className="section-head">
                <h2>Recent Activity</h2>
              </div>
              <div className="stack">
                {recentActivity.length ? recentActivity.map((item) => (
                  <article key={item.key} className="activity-row">
                    <div className="activity-copy">
                      <strong><span className="activity-icon">{item.icon}</span> {item.title}</strong>
                      {item.meta ? <p>{item.meta}</p> : null}
                    </div>
                    {item.action ? <button onClick={item.action.onClick}>{item.action.label}</button> : null}
                  </article>
                )) : (
                  <article className="activity-row empty-activity-row">
                    <div className="activity-copy">
                      <strong>📘 No recent activity yet</strong>
                      <p>Borrow a book or track a project to see updates here.</p>
                    </div>
                  </article>
                )}
              </div>
            </section>
          </>
        ) : null}

        {!isAdmin && activeTab === "search" ? (
          <section className="panel">
            <h2>Search</h2>
            <p className="muted">Find books by title, topic, author, and related themes.</p>
            <div className="row">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g., machine learning, microeconomics"
              />
              <button onClick={() => semanticSearch(query)}>Search</button>
            </div>
            {semantic ? (
              <div className="stack">
                <p className="muted">
                  {(semantic.meta?.returned ?? semantic.books?.length ?? 0)} results • {(semantic.meta?.strategy || "search")}
                </p>
                {(semantic.books || []).length ? (semantic.books || []).map((book) => (
                  <article key={book._id} className="result-row search-book-row">
                    <div className="row search-book-main">
                      <BookCover book={book} compact />
                      <div>
                        <strong>{book.title}</strong>
                        <p>{book.author} • {book.category}</p>
                        <p className="muted">Shelf {book.location?.shelf} • Floor {book.location?.floor} • Stock {book.stock}/{book.totalCopies}</p>
                        <details className="book-insight-view">
                          <summary>View what this book offers</summary>
                          {(() => {
                            const insight = buildBookInsight({ topic: query || book.title, keywords: semantic?.relatedThemes || [] }, book, books);
                            return (
                              <div className="book-insight-copy">
                                {book.relevance?.summary ? <p><strong>Why it matches your query:</strong> {asDisplayText(book.relevance.summary)}</p> : null}
                                {Array.isArray(book.relevance?.matchedTerms) && book.relevance.matchedTerms.length ? (
                                  <div className="row wrap">
                                    {book.relevance.matchedTerms.map((term) => (
                                      <span key={`${book._id}-match-${asDisplayText(term, "match")}`} className="pill warn">{asDisplayText(term)}</span>
                                    ))}
                                  </div>
                                ) : null}
                                <p>{insight.offerSummary}</p>
                                <p>{insight.differenceSummary}</p>
                                <div className="stack compact">
                                  <strong>Likely useful sections</strong>
                                  {insight.relevantSections.map((section) => (
                                    <p key={`${book._id}-${section}`} className="muted">{section}</p>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                        </details>
                      </div>
                    </div>
                    <div className="row">
                      <button disabled={user.isBlocked} onClick={() => reserveBook(book._id)}>Reserve</button>
                      <button onClick={() => subscribe(book._id)}>Stock Alert</button>
                    </div>
                  </article>
                )) : <p className="muted">No matches found. Try a broader topic or related theme.</p>}
                <div className="row wrap">
                  {(semantic.relatedThemes || []).map((theme) => (
                    <button key={theme} className="subtle" onClick={() => {
                      setQuery(theme);
                      semanticSearch(theme);
                    }}>{theme}</button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {!isAdmin && activeTab === "loans" ? (
          <section className="panel table-wrap">
            <h2>My Loans and Reservations</h2>

            <h3>Reservation Requests</h3>
            {pendingReservations.length ? (
              <table>
                <thead>
                  <tr><th>Book</th><th>Requested</th><th>Status</th><th>Notes</th></tr>
                </thead>
                <tbody>
                  {pendingReservations.map((loan) => (
                    <tr key={loan._id}>
                      <td>{loan.book?.title}</td>
                      <td>{fmtDate(loan.requestDate || loan.createdAt)}</td>
                      <td><span className="pill warn">Pending Admin Review</span></td>
                      <td>{loan.rejectionReason || "Waiting for admin approval"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted">No pending reservations right now.</p>}

            <h3>Rejected Reservations</h3>
            {rejectedReservations.length ? (
              <table>
                <thead>
                  <tr><th>Book</th><th>Requested</th><th>Decision</th><th>Reason</th></tr>
                </thead>
                <tbody>
                  {rejectedReservations.map((loan) => (
                    <tr key={loan._id}>
                      <td>{loan.book?.title}</td>
                      <td>{fmtDate(loan.requestDate || loan.createdAt)}</td>
                      <td><span className="pill danger">Rejected</span></td>
                      <td>{loan.rejectionReason || "Reservation was not approved."}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted">No rejected reservations.</p>}

            <h3>Approved Loans</h3>
            <table>
              <thead>
                <tr><th>Book</th><th>Due Date</th><th>Days Left</th><th>Policy</th><th>Requests</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {activeLoans.map((loan) => (
                  <tr key={loan._id}>
                    <td>{loan.book?.title}</td>
                    <td>{fmtDate(loan.dueDate)}</td>
                    <td><span className={`pill ${daysLeft(loan.dueDate) < 0 ? "danger" : "ok"}`}>{daysLeft(loan.dueDate)}</span></td>
                    <td>
                      <div className="stack compact">
                        <span>{getLoanPolicyView(loan).label}</span>
                        {getLoanPolicyView(loan).tier ? <span className="muted">{formatWorkflowLabel(getLoanPolicyView(loan).tier)} policy</span> : null}
                      </div>
                    </td>
                    <td>
                      {hasPendingRenewal(loan) ? <span className="pill warn">Renewal Pending</span> : null}
                      {!hasPendingRenewal(loan) && hasRejectedRenewal(loan) ? <span className="pill danger">Renewal Rejected</span> : null}
                      {!hasPendingRenewal(loan) && !hasRejectedRenewal(loan) && hasPendingReturn(loan) ? <span className="pill warn">Return Pending</span> : null}
                      {!hasPendingRenewal(loan) && !hasRejectedRenewal(loan) && !hasPendingReturn(loan) && hasRejectedReturn(loan) ? <span className="pill danger">Return Rejected</span> : null}
                      {!hasPendingRenewal(loan) && !hasRejectedRenewal(loan) && !hasPendingReturn(loan) && !hasRejectedReturn(loan) ? <span className="muted">No open requests</span> : null}
                      {hasRejectedRenewal(loan) && loan.renewalRejectionReason ? <div className="muted">Reason: {loan.renewalRejectionReason}</div> : null}
                      {hasRejectedReturn(loan) && loan.returnRejectionReason ? <div className="muted">Reason: {loan.returnRejectionReason}</div> : null}
                    </td>
                    <td className="row">
                      <button
                        disabled={!canRequestRenewal(loan) || hasPendingRenewal(loan) || hasPendingReturn(loan)}
                        onClick={() => renewLoan(loan._id)}
                      >
                        Request Renewal
                      </button>
                      <button disabled={hasPendingRenewal(loan) || hasPendingReturn(loan)} onClick={() => returnLoan(loan._id)}>Request Return</button>
                    </td>
                  </tr>
                ))}
                {!activeLoans.length ? (
                  <tr>
                    <td colSpan="6" className="muted">No approved loans yet. Your reservations will appear here after admin approval.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>

            <h3>Stock Subscriptions</h3>
            <div className="stack">
              {subscriptions.map((sub) => (
                <article key={sub._id} className="result-row search-book-row">
                  <div className="row search-book-main">
                    <BookCover book={sub.book} compact />
                    <div><strong>{sub.book?.title}</strong></div>
                  </div>
                  <button onClick={() => unsubscribe(sub.book?._id)}>Unsubscribe</button>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {!isAdmin && activeTab === "research" ? (
          <section className="panel">
            <div className="row between">
              <div>
                <h2>Research Tracker</h2>
                <p className="muted">Use your project title to surface the best books in the library, see what each one contributes, and focus on the sections most likely to help your research.</p>
              </div>
              <button onClick={() => setShowResearchForm((current) => !current)}>
                {showResearchForm ? "Close Form" : "New Project"}
              </button>
            </div>

            {showResearchForm ? (
              <article className="card research-form-card">
                <div className="grid-2 research-form-grid">
                  <input
                    value={researchForm.topic}
                    onChange={(e) => setResearchForm((current) => ({ ...current, topic: e.target.value }))}
                    placeholder="Project topic"
                  />
                  <select
                    value={researchForm.status}
                    onChange={(e) => setResearchForm((current) => ({ ...current, status: e.target.value }))}
                  >
                    {researchStatusOptions.map((status) => (
                      <option key={status} value={status}>{formatWorkflowLabel(status)}</option>
                    ))}
                  </select>
                  <input
                    value={researchForm.researchQuestion}
                    onChange={(e) => setResearchForm((current) => ({ ...current, researchQuestion: e.target.value }))}
                    placeholder="Research question"
                  />
                  <input
                    value={researchForm.methodology}
                    onChange={(e) => setResearchForm((current) => ({ ...current, methodology: e.target.value }))}
                    placeholder="Methodology or approach"
                  />
                  <input
                    value={researchForm.keywords}
                    onChange={(e) => setResearchForm((current) => ({ ...current, keywords: e.target.value }))}
                    placeholder="Keywords, separated by commas"
                  />
                  <input
                    type="date"
                    value={researchForm.targetCompletionDate}
                    onChange={(e) => setResearchForm((current) => ({ ...current, targetCompletionDate: e.target.value }))}
                  />
                </div>
                <textarea
                  value={researchForm.notes}
                  onChange={(e) => setResearchForm((current) => ({ ...current, notes: e.target.value }))}
                  placeholder="What are you trying to prove, compare, or analyze?"
                  rows={4}
                />
                <div className="row">
                  <button onClick={addResearch}>Create Project</button>
                  <button className="subtle" onClick={() => setResearchForm(initialResearchForm)}>Reset</button>
                </div>
              </article>
            ) : null}

            <div className="stack">
              {research.map((project) => {
                const taskStats = getResearchTaskStats(project);
                const progress = getResearchProgress(project);
                const recommendedBooks = getRecommendedBooksForProject(project);
                return (
                  <article key={project._id} className="card research-project-card">
                    <div className="row between research-project-head">
                      <div>
                        <h3>{project.topic}</h3>
                        {project.researchQuestion ? <p className="muted">{project.researchQuestion}</p> : null}
                      </div>
                      <div className="stack compact research-project-meta">
                        <select value={project.status || "planning"} onChange={(e) => updateResearchStatus(project._id, e.target.value)}>
                          {researchStatusOptions.map((status) => (
                            <option key={status} value={status}>{formatWorkflowLabel(status)}</option>
                          ))}
                        </select>
                        {project.targetCompletionDate ? (
                          <span className="muted">Due {fmtDate(project.targetCompletionDate)}</span>
                        ) : (
                          <span className="muted">No due date</span>
                        )}
                      </div>
                    </div>

                    <div className="research-summary-grid">
                      <div className="research-summary-card">
                        <span>Completion</span>
                        <strong>{progress}%</strong>
                        <small>{taskStats.done}/{taskStats.total || 0} tasks finished</small>
                      </div>
                      <div className="research-summary-card">
                        <span>Recommended Reads</span>
                        <strong>{recommendedBooks.length}</strong>
                        <small>{recommendedBooks[0] ? `Top match: ${recommendedBooks[0].book.title}` : "No strong match yet"}</small>
                      </div>
                      <div className="research-summary-card">
                        <span>Current Focus</span>
                        <strong>{formatWorkflowLabel(project.status || "planning")}</strong>
                        <small>{taskStats.active ? `${taskStats.active} task in progress` : "Ready for the next step"}</small>
                      </div>
                    </div>

                    {project.methodology || project.notes || (project.keywords || []).length ? (
                      <div className="stack compact">
                        {project.methodology ? <p className="muted"><strong>Method:</strong> {project.methodology}</p> : null}
                        {project.notes ? <p className="muted"><strong>Notes:</strong> {project.notes}</p> : null}
                        {(project.keywords || []).length ? (
                          <div className="row wrap">
                            {project.keywords.map((keyword) => (
                              <span key={`${project._id}-${keyword}`} className="pill ok">{keyword}</span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <section className="research-subsection">
                      <div className="section-head">
                        <div>
                          <h4>Recommended From Your Library</h4>
                          <p className="muted">These are the books most aligned to the project title and keywords. Section guidance is inferred from catalog metadata, not exact page numbers.</p>
                        </div>
                        <span className="muted">{recommendedBooks.length} strong matches</span>
                      </div>
                      {recommendedBooks.length ? (
                        <div className="research-book-grid">
                          {recommendedBooks.map(({ book, score, insight }) => (
                            <article key={`${project._id}-book-${book._id}`} className="recommended-book-card">
                              <BookCover book={book} />
                              <div className="stack compact">
                                <div className="row between wrap">
                                  <strong>{book.title}</strong>
                                  <span className="pill ok">Match {score}</span>
                                </div>
                                <p>{book.author} • {book.category}</p>
                                <p className="muted">Shelf {book.location?.shelf} • Floor {book.location?.floor} • Demand {book.demandScore}</p>
                                {insight.matchedThemes.length ? (
                                  <div className="row wrap">
                                    {insight.matchedThemes.map((theme) => (
                                      <span key={`${book._id}-${theme}`} className="pill warn">{theme}</span>
                                    ))}
                                  </div>
                                ) : null}
                                <p>{insight.offerSummary}</p>
                                <p>{insight.differenceSummary}</p>
                                <div className="stack compact">
                                  <strong>Best sections to scan first</strong>
                                  {insight.relevantSections.map((section) => (
                                    <p key={`${book._id}-${section}`} className="muted">{section}</p>
                                  ))}
                                </div>
                                <details className="book-insight-view">
                                  <summary>Open full book brief</summary>
                                  <div className="book-insight-copy">
                                    <p><strong>What it offers:</strong> {insight.offerSummary}</p>
                                    <p><strong>How it differs:</strong> {insight.differenceSummary}</p>
                                    <div className="stack compact">
                                      <strong>Use these sections for "{project.topic}"</strong>
                                      {insight.relevantSections.map((section) => (
                                        <p key={`${project._id}-${book._id}-${section}`} className="muted">{section}</p>
                                      ))}
                                    </div>
                                  </div>
                                </details>
                                <div className="row wrap">
                                  <button className="subtle" onClick={() => {
                                    setQuery(book.title);
                                    setActiveTab("search");
                                    semanticSearch(book.title);
                                  }}>Use in Search</button>
                                  <button className="subtle" onClick={() => openAiWithPrompt(`Help me use "${book.title}" for my research project "${project.topic}".`)}>
                                    Ask AI About This Book
                                  </button>
                                </div>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : <p className="muted">No strong catalog matches yet. Tighten the project title or add clearer keywords to improve the recommendation set.</p>}
                    </section>

                    <div className="research-section-grid">
                      <section className="research-subsection">
                        <div className="section-head">
                          <h4>Workflow</h4>
                          <span className="muted">{taskStats.remaining} remaining</span>
                        </div>
                        <div className="stack">
                          {getResearchTasks(project).map((task, taskIndex) => (
                            <article key={`${project._id}-task-${taskIndex}`} className="task-card">
                              <div>
                                <strong>{task.title}</strong>
                                {task.notes ? <p>{task.notes}</p> : null}
                              </div>
                              <div className="row wrap">
                                <span className={`pill ${task.status === "done" ? "ok" : task.status === "in_progress" ? "warn" : "danger"}`}>
                                  {formatWorkflowLabel(task.status)}
                                </span>
                                <button className="subtle" onClick={() => toggleResearchTask(project._id, taskIndex)}>
                                  Advance
                                </button>
                                <button className="subtle" onClick={() => removeTaskFromProject(project._id, taskIndex)}>
                                  Remove
                                </button>
                              </div>
                            </article>
                          ))}
                          <div className="row">
                            <input
                              value={taskDrafts[project._id] || ""}
                              onChange={(e) => setTaskDrafts((current) => ({ ...current, [project._id]: e.target.value }))}
                              placeholder="Add a concrete next task"
                            />
                            <button onClick={() => addTaskToProject(project._id)}>Add Task</button>
                          </div>
                        </div>
                      </section>
                    </div>
                  </article>
                );
              })}
              {!research.length ? <p className="muted">No projects yet. Create one to start collecting sources and planning your writing workflow.</p> : null}
            </div>
          </section>
        ) : null}

        {!isAdmin && activeTab === "ar" ? (
          <section className="panel">
            <h2>AR Navigator</h2>
            <div className="row">
              <select value={arBookId} onChange={(e) => setArBookId(e.target.value)}>
                <option value="">Select a book</option>
                {books.map((book) => (
                  <option value={book._id} key={book._id}>{book.title}</option>
                ))}
              </select>
              <button onClick={fetchAR}>Locate</button>
            </div>
            {arResult ? (
              <>
                <article className="card">
                  <h3>{arResult.title}</h3>
                  <p>Floor {arResult.location.floor} • Shelf {arResult.location.shelf} • Row {arResult.location.row}</p>
                  {(arResult.guidance || []).map((step) => <p key={step}>{step}</p>)}
                </article>
                <section className="grid-3">
                  {[1, 2, 3].map((floor) => (
                    <article className="card" key={floor}>
                      <h3>Floor {floor}</h3>
                      <div className="shelf-grid">
                        {(arFloors[floor] || []).map((shelf) => (
                          <div
                            className={`shelf ${shelf === arResult.location.shelf ? "active" : ""}`}
                            key={shelf}
                          >
                            {shelf}
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </section>
              </>
            ) : null}
          </section>
        ) : null}

        {!isAdmin && activeTab === "account" ? (
          <section className="panel">
            <h2>My Account</h2>
            <div className="stack compact">
              <div className="line-item"><span>Name</span><strong>{user.name}</strong></div>
              <div className="line-item"><span>Email</span><strong>{user.email}</strong></div>
              <div className="line-item"><span>Role</span><strong>{user.role}</strong></div>
              <div className="line-item"><span>Department</span><strong>{user.department}</strong></div>
              <div className="line-item"><span>Total amount due</span><strong>${outstandingFine.toFixed(2)}</strong></div>
              <div className="line-item"><span>Pending fine items</span><strong>{pendingFineCount}</strong></div>
              <div className="line-item"><span>Account status</span><strong>{outstandingFine > 0 ? "Payment required" : "Clear"}</strong></div>
            </div>
            {pendingFines.length ? (
              <div className="stack" style={{ marginTop: 12 }}>
                <h3>Pending Charges</h3>
                {pendingFines.map((fine) => (
                  <article key={fine._id} className="result-row">
                    <div>
                      <strong>{fine.reason}</strong>
                      <p>{fmtDate(fine.createdAt)}</p>
                    </div>
                    <strong>${Number(fine.amount || 0).toFixed(2)}</strong>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted" style={{ marginTop: 12 }}>No amount is currently due on your account.</p>
            )}
          </section>
        ) : null}
      </main>

      <div className="ai-float-wrap">
          {aiOpen ? (
            <section className="ai-window" aria-label="AI Research Helper">
              <div className="ai-window-head">
                <div className="ai-window-title">
                  <span className="ai-window-badge">LIBRARY</span>
                  <div className="ai-window-heading">
                    <strong>Library Assistant</strong>
                    <small>
                      {latestAiRuntime?.model
                        ? `Running on ${latestAiRuntime.model}`
                        : "Local Ollama answers with ranked library search context"}
                    </small>
                  </div>
                </div>
                <button className="ai-close-btn" onClick={() => setAiOpen(false)}>Close</button>
              </div>
              <div className="chat-box">
                {aiMessages.map((m, idx) => (
                    <div key={`${m.role}-${idx}`} className={`bubble ${m.role === "user" ? "mine" : "theirs"}`}>
                      {!shouldHideAiReplyText(m) ? <div className="bubble-text">{asDisplayText(m.text)}</div> : null}
                    {m.role === "ai" && (m.provider || m.model) ? (
                      <div className="ai-context-meta">
                        {formatAiProvider(m.provider) || "Assistant"}
                        {m.model ? ` | ${m.model}` : ""}
                      </div>
                    ) : null}
                    {m.role === "ai" && m.context ? (
                      <div className="ai-context-meta">
                        Context used: {m.context.projectsUsed} project(s), {m.context.loansUsed} loan(s), {m.context.booksUsed} book match(es)
                      </div>
                    ) : null}
                    {m.role === "ai" && m.warning ? <div className="ai-warning">{m.warning}</div> : null}
                    {m.role === "ai" && Array.isArray(m.sources) && m.sources.length ? (
                      <div className="ai-source-list">
                        {m.sources.map((source) => (
                          <div className="ai-source-chip" key={`${source.bookId}-${source.title}`}>
                            <strong>{asDisplayText(source.title, "Untitled source")}</strong>
                            <span>
                              Floor {source.location?.floor ?? "?"} • Shelf {source.location?.shelf ?? "?"} • Stock {source.stock}/{source.totalCopies}
                            </span>
                            {source.whyRelevant ? <p>{asDisplayText(source.whyRelevant)}</p> : null}
                            {Array.isArray(source.matchedTerms) && source.matchedTerms.length ? (
                              <div className="row wrap">
                                {source.matchedTerms.map((term) => (
                                  <span key={`${source.bookId}-${asDisplayText(term, "match")}`} className="pill warn">{asDisplayText(term)}</span>
                                ))}
                              </div>
                            ) : null}
                            <div className="ai-source-actions">
                              <button className="subtle" onClick={() => jumpToARFromSource(source)}>Locate in AR</button>
                              <button className="subtle" onClick={() => searchFromSource(source)}>Find Similar</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
              {aiQuickPrompts.length ? (
                <div className="ai-prompt-strip">
                  {aiQuickPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      className="subtle ai-prompt-chip"
                      onClick={() => sendAI(prompt)}
                      disabled={aiLoading}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="row">
                <input
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendAI();
                  }}
                  placeholder="Ask about your research"
                  disabled={aiLoading}
                />
                <button onClick={sendAI} disabled={aiLoading}>{aiLoading ? "Thinking..." : "Send"}</button>
              </div>
            </section>
          ) : null}
          <button className="ai-float-btn" onClick={() => setAiOpen((v) => !v)}>
            <span className="ai-float-icon">✦</span>
            <span className="ai-float-copy">
              <strong>Library Assistant</strong>
              <small>Catalog-aware local research help</small>
            </span>
          </button>
        </div>
    </div>
  );
}
