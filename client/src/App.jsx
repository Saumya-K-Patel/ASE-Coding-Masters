import { useEffect, useMemo, useState } from "react";
import { api, setAuthToken } from "./api";

const adminRoles = ["librarian", "staff", "admin"];

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

function daysLeft(value) {
  const due = new Date(value);
  const now = new Date();
  return Math.ceil((due - now) / (1000 * 60 * 60 * 24));
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

function toneByDemand(score) {
  if (score > 80) return "danger";
  if (score > 55) return "warn";
  return "ok";
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

function formatSearchLabel(value) {
  return String(value || "")
    .split(" ")
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
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

function hasPendingReturn(loan) {
  return loan?.returnRequestStatus === "pending";
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

  const [bookForm, setBookForm] = useState({
    code: "",
    title: "",
    author: "",
    category: "",
    isbn: "",
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
    await withAction(async () => {
      await api.post(`/loans/${id}/reject`);
      await refreshAll();
    }, "Reservation rejected");
  }

  async function renewLoan(id) {
    await withAction(async () => {
      await api.post(`/loans/${id}/renew`);
      await loadSession();
      await loadLoans();
    }, "Renewal request submitted");
  }

  async function approveRenewal(id) {
    await withAction(async () => {
      await api.post(`/loans/${id}/renew/approve`);
      await refreshAll();
    }, "Renewal approved");
  }

  async function rejectRenewal(id) {
    await withAction(async () => {
      await api.post(`/loans/${id}/renew/reject`);
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

  async function verifyFine(id) {
    await withAction(async () => {
      await api.post(`/fines/${id}/verify-payment`);
      await loadSession();
      await refreshAll();
    }, "Fine cleared");
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

  async function runGuidedSearch(nextQuery) {
    const trimmed = String(nextQuery || "").trim();
    if (!trimmed) return;
    setQuery(trimmed);
    await semanticSearch(trimmed);
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

  async function sendAI() {
    if (!aiInput.trim() || aiLoading) return;
    const mine = { role: "user", text: aiInput.trim() };
    setAiMessages((prev) => [...prev, mine]);
    setAiInput("");
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

  async function addResearch() {
    const topic = prompt("Research topic");
    if (!topic) return;
    await withAction(async () => {
      await api.post("/research", {
        topic,
        milestones: [
          { phase: "Topic Selection", progress: 0, milestone: "Define research scope", notes: "" },
          { phase: "Literature Review", progress: 0, milestone: "Collect 20 papers", notes: "" },
          { phase: "Methodology", progress: 0, milestone: "Draft methods", notes: "" },
        ],
      });
      await loadResearch();
    }, "Research project created");
  }

  async function updateMilestoneProgress(projectId, milestoneIndex, nextProgress) {
    const project = research.find((item) => item._id === projectId);
    if (!project) return;

    const clamped = Math.max(0, Math.min(100, Number(nextProgress) || 0));
    const milestones = (project.milestones || []).map((milestone, index) => (
      index === milestoneIndex ? { ...milestone, progress: clamped } : milestone
    ));

    await withAction(async () => {
      await api.put(`/research/${projectId}`, { milestones });
      await loadResearch();
    }, "Milestone progress updated");
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

  const isAdmin = adminRoles.includes(user?.role);
  const isApprovalAdmin = user?.role === "admin";
  const tabs = isAdmin ? adminTabs : studentTabs;

  const activeLoans = useMemo(() => loans.filter(isActiveLoan), [loans]);
  const pendingReservations = useMemo(() => loans.filter(isPendingLoan), [loans]);
  const dueSoonLoans = useMemo(
    () => activeLoans.filter((loan) => daysLeft(loan.dueDate) >= 0 && daysLeft(loan.dueDate) <= 3),
    [activeLoans]
  );
  const outstandingFine = useMemo(
    () => fines.filter((fine) => fine.status === "pending").reduce((sum, fine) => sum + fine.amount, 0),
    [fines]
  );
  const pendingFineCount = useMemo(() => fines.filter((fine) => fine.status === "pending").length, [fines]);
  const paidFineCount = useMemo(() => fines.filter((fine) => fine.status === "paid").length, [fines]);
  const lowStockCount = useMemo(() => books.filter((book) => book.stock <= 2).length, [books]);
  const outOfStockCount = useMemo(() => books.filter((book) => book.stock === 0).length, [books]);
  const highDemandCount = useMemo(() => demand.filter((item) => item.demandScore >= 80).length, [demand]);
  const overdues = useMemo(() => activeLoans.filter((loan) => daysLeft(loan.dueDate) < 0).length, [activeLoans]);
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
    [activeLoans, borrowersFilter]
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
  const studentDateLabel = useMemo(() => fmtLongDate(new Date()), []);
  const researchDueSoonCount = useMemo(
    () => research.filter((project) => (project.milestones || []).some((item) => item.progress >= 70 && item.progress < 100)).length,
    [research]
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
        action: { label: "Request Renewal", onClick: () => renewLoan(dueSoon._id) },
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
  }, [activeLoans, loans]);

  const latestAiRuntime = useMemo(
    () => [...aiMessages].reverse().find((entry) => entry.role === "ai" && (entry.model || entry.provider || entry.warning)) || null,
    [aiMessages]
  );

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
                    <strong>{pendingFineCount}</strong>
                  </article>
                  <article className="fine-metric-card">
                    <span>Blocked users</span>
                    <strong>{user.isBlocked ? 1 : 0}</strong>
                  </article>
                  <article className="fine-metric-card">
                    <span>Total tracked users</span>
                    <strong>{analytics?.totals?.totalUsers ?? 0}</strong>
                  </article>
                </div>
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
              <input type="number" min="0" placeholder="Stock" value={bookForm.stock} onChange={(e) => setBookForm((f) => ({ ...f, stock: Number(e.target.value) }))} required />
              <input type="number" min="0" placeholder="Total Copies" value={bookForm.totalCopies} onChange={(e) => setBookForm((f) => ({ ...f, totalCopies: Number(e.target.value) }))} required />
              <button type="submit">Add Book</button>
            </form>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Title</th><th>Author</th><th>Category</th><th>Stock</th><th>Demand</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {inventoryRows.map((book) => (
                    <tr key={book._id}>
                      <td>{book.title}</td>
                      <td>{book.author}</td>
                      <td>{book.category}</td>
                      <td>{book.stock}/{book.totalCopies}</td>
                      <td>
                        <div className="demand-cell">
                          <div className="demand-track">
                            <span className={`demand-fill ${toneByDemand(book.demandScore)}`} style={{ width: `${book.demandScore}%` }} />
                          </div>
                          <span className={`pill ${toneByDemand(book.demandScore)}`}>{book.demandScore}</span>
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
            {!isApprovalAdmin ? <p className="muted">Only users with the `admin` role can approve or reject reservations.</p> : null}
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
                <tr><th>User</th><th>Book</th><th>Borrowed</th><th>Due</th><th>Status</th><th>Requests</th><th>Renewals</th><th>Actions</th></tr>
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
                      {hasPendingRenewal(loan) ? <span className="pill warn">Renewal Request</span> : null}
                      {!hasPendingRenewal(loan) && hasPendingReturn(loan) ? <span className="pill warn">Return Request</span> : null}
                      {!hasPendingRenewal(loan) && !hasPendingReturn(loan) ? <span className="muted">None</span> : null}
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
                        <button onClick={() => processReturn(loan._id)}>Process Return</button>
                      ) : null}
                      {(!isApprovalAdmin || (!hasPendingRenewal(loan) && !hasPendingReturn(loan))) ? <span className="muted">No action</span> : null}
                    </td>
                  </tr>
                ))}
                {!borrowerRows.length ? (
                  <tr>
                    <td colSpan="8" className="muted">No active approved loans for this filter.</td>
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
                <tr><th>User</th><th>Reason</th><th>Amount</th><th>Status</th><th>Action</th></tr>
              </thead>
              <tbody>
                {fineRows.map((fine) => (
                  <tr key={fine._id}>
                    <td>{fine.user?.name}</td>
                    <td>{fine.reason}</td>
                    <td>${fine.amount.toFixed(2)}</td>
                    <td><span className={`pill ${fine.status === "pending" ? "warn" : "ok"}`}>{fine.status}</span></td>
                    <td>
                      {fine.status === "pending"
                        ? <button onClick={() => verifyFine(fine._id)}>Verify Payment</button>
                        : <span className="muted">Closed</span>}
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
                <tr><th>Book</th><th>Demand Score</th><th>Exam Impact</th><th>Stock</th><th>Recommendation</th></tr>
              </thead>
              <tbody>
                {demand.map((item) => (
                  <tr key={item.bookId}>
                    <td>{item.title}</td>
                    <td>
                      <div className="demand-cell">
                        <div className="demand-track">
                          <span className={`demand-fill ${toneByDemand(item.demandScore)}`} style={{ width: `${item.demandScore}%` }} />
                        </div>
                        <span className={`pill ${toneByDemand(item.demandScore)}`}>{item.demandScore}</span>
                      </div>
                    </td>
                    <td>{item.examSeasonImpact}</td>
                    <td>{item.stock}/{item.totalCopies}</td>
                    <td>{item.recommendation}</td>
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
                <strong>${Number(user.finesOutstanding || 0).toFixed(2)}</strong>
                <p>{Number(user.finesOutstanding || 0) > 0 ? `${fines.filter((fine) => fine.status === "pending").length} pending item(s)` : "You're clear ✅"}</p>
                <small>{Number(user.finesOutstanding || 0) > 0 ? "Review account status" : "No payment action needed"}</small>
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
                <small>{research.length ? "Open tracker to review milestones" : "Create your first project →"}</small>
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
                {semantic.meta?.plan?.length ? (
                  <section className="search-guidance-card">
                    <div className="section-head">
                      <h3>Search Guide</h3>
                    </div>
                    {(semantic.meta.intentLabels || []).length ? (
                      <div className="row wrap">
                        {(semantic.meta.intentLabels || []).map((label) => (
                          <span key={label} className="pill ok">{formatSearchLabel(label)}</span>
                        ))}
                      </div>
                    ) : null}
                    <div className="stack compact">
                      {(semantic.meta.plan || []).map((step) => (
                        <p key={step} className="muted">{step}</p>
                      ))}
                    </div>
                    {(semantic.meta.expandedTerms || []).length ? (
                      <div className="row wrap">
                        {(semantic.meta.expandedTerms || []).map((term) => (
                          <span key={term} className="term-chip">{term}</span>
                        ))}
                      </div>
                    ) : null}
                  </section>
                ) : null}
                {(semantic.books || []).length ? (semantic.books || []).map((book) => (
                  <article key={book._id} className="result-row">
                    <div>
                      <strong>{book.title}</strong>
                      <p>{book.author} • {book.category}</p>
                    </div>
                    <div className="row">
                      <button disabled={user.isBlocked} onClick={() => reserveBook(book._id)}>Reserve</button>
                      <button onClick={() => subscribe(book._id)}>Stock Alert</button>
                    </div>
                  </article>
                )) : <p className="muted">No matches found. Try a broader topic or related theme.</p>}
                {(semantic.meta?.suggestedQueries || []).length ? (
                  <div className="stack compact">
                    <p className="muted">Try these refined searches next:</p>
                    <div className="row wrap">
                      {(semantic.meta.suggestedQueries || []).map((suggestion) => (
                        <button key={suggestion} className="subtle" onClick={() => runGuidedSearch(suggestion)}>
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="row wrap">
                  {(semantic.relatedThemes || []).map((theme) => (
                    <button key={theme} className="subtle" onClick={() => {
                      runGuidedSearch(theme);
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

            <h3>Pending Reservations</h3>
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

            <h3>Approved Loans</h3>
            <table>
              <thead>
                <tr><th>Book</th><th>Due Date</th><th>Days Left</th><th>Requests</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {activeLoans.map((loan) => (
                  <tr key={loan._id}>
                    <td>{loan.book?.title}</td>
                    <td>{fmtDate(loan.dueDate)}</td>
                    <td><span className={`pill ${daysLeft(loan.dueDate) < 0 ? "danger" : "ok"}`}>{daysLeft(loan.dueDate)}</span></td>
                    <td>
                      {hasPendingRenewal(loan) ? <span className="pill warn">Renewal Pending</span> : null}
                      {!hasPendingRenewal(loan) && hasPendingReturn(loan) ? <span className="pill warn">Return Pending</span> : null}
                      {!hasPendingRenewal(loan) && !hasPendingReturn(loan) ? <span className="muted">No open requests</span> : null}
                    </td>
                    <td className="row">
                      <button disabled={hasPendingRenewal(loan) || hasPendingReturn(loan)} onClick={() => renewLoan(loan._id)}>Request Renewal</button>
                      <button disabled={hasPendingRenewal(loan) || hasPendingReturn(loan)} onClick={() => returnLoan(loan._id)}>Request Return</button>
                    </td>
                  </tr>
                ))}
                {!activeLoans.length ? (
                  <tr>
                    <td colSpan="5" className="muted">No approved loans yet. Your reservations will appear here after admin approval.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>

            <h3>Stock Subscriptions</h3>
            <div className="stack">
              {subscriptions.map((sub) => (
                <article key={sub._id} className="result-row">
                  <div><strong>{sub.book?.title}</strong></div>
                  <button onClick={() => unsubscribe(sub.book?._id)}>Unsubscribe</button>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {!isAdmin && activeTab === "research" ? (
          <section className="panel">
            <div className="row between"><h2>Research Tracker</h2><button onClick={addResearch}>New Project</button></div>
            <div className="stack">
              {research.map((project) => (
                <article key={project._id} className="card">
                  <h3>{project.topic}</h3>
                  {(project.milestones || []).map((m, milestoneIndex) => (
                    <div key={`${project._id}-${m.phase}`} className="milestone-row">
                      <p>{m.phase}</p>
                      <div className="row milestone-edit-row">
                        <input
                          className="milestone-range"
                          type="range"
                          min="0"
                          max="100"
                          step="5"
                          value={m.progress}
                          onChange={(e) => updateMilestoneProgress(project._id, milestoneIndex, e.target.value)}
                        />
                        <span className="milestone-value">{m.progress}%</span>
                      </div>
                      <small>{m.milestone}</small>
                    </div>
                  ))}
                </article>
              ))}
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
              <div className="line-item"><span>Outstanding fines</span><strong>${Number(user.finesOutstanding || 0).toFixed(2)}</strong></div>
            </div>
          </section>
        ) : null}
      </main>

      <div className="ai-float-wrap">
          {aiOpen ? (
            <section className="ai-window" aria-label="AI Research Helper">
              <div className="ai-window-head">
                <div className="ai-window-title">
                  <span className="ai-window-badge">OLLAMA</span>
                  <div className="ai-window-heading">
                    <strong>Local Research Helper</strong>
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
                    {!shouldHideAiReplyText(m) ? <div className="bubble-text">{m.text}</div> : null}
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
                            <strong>{source.title}</strong>
                            <span>
                              Floor {source.location?.floor ?? "?"} • Shelf {source.location?.shelf ?? "?"} • Stock {source.stock}/{source.totalCopies}
                            </span>
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
              <strong>Ollama Helper</strong>
              <small>Local chat with search context</small>
            </span>
          </button>
        </div>
    </div>
  );
}
