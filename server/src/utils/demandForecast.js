function toId(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value.toString === "function") return value.toString();
  return String(value);
}

function daysSince(value, now) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now - parsed) / (1000 * 60 * 60 * 24));
}

function getExamPressure(level) {
  if (level === "Very High") return 5;
  if (level === "High") return 3;
  if (level === "Medium") return 2;
  return 1;
}

function getStockPressure(stock, totalCopies) {
  if (totalCopies <= 0) return 8;
  const ratio = stock / totalCopies;
  if (stock <= 0) return 8;
  if (stock === 1) return 5;
  if (ratio <= 0.25) return 3;
  if (ratio <= 0.5) return 1;
  return 0;
}

function getRecommendation(score, stock, totalCopies, signals) {
  if (stock <= 0 && signals.pendingReservations > 0) return "Acquire more copies immediately";
  if (stock <= 0) return "Restock urgently";
  if (stock === 1 && (signals.activeLoans > 0 || score >= 18)) return "Increase copies soon";
  if (score >= 40 && stock <= Math.max(1, Math.ceil(totalCopies * 0.25))) return "Restock urgently";
  if (score >= 30 && stock <= Math.max(2, Math.ceil(totalCopies * 0.5))) return "Increase copies soon";
  if (signals.pendingReservations > 0 || signals.stockAlerts > 0) return "Monitor reservations closely";
  if (score >= 22) return "Watch demand";
  return "Adequate";
}

function getBorrowedCopies(stock, totalCopies) {
  return Math.max(0, totalCopies - stock);
}

function getBorrowPressurePercent(stock, totalCopies) {
  if (totalCopies <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((getBorrowedCopies(stock, totalCopies) / totalCopies) * 100)));
}

function getSignalSummary(signals) {
  const summary = [];
  if (signals.pendingReservations) summary.push(`${signals.pendingReservations} pending reservation(s)`);
  if (signals.activeLoans) summary.push(`${signals.activeLoans} active loan(s)`);
  if (signals.recentLoans) summary.push(`${signals.recentLoans} recent checkout(s)`);
  if (signals.renewalRequests) summary.push(`${signals.renewalRequests} renewal request(s)`);
  if (signals.stockAlerts) summary.push(`${signals.stockAlerts} stock alert subscription(s)`);
  if (signals.stockLevelLabel) summary.push(signals.stockLevelLabel);
  else if (signals.stockPressure) summary.push("low-stock pressure");
  return summary;
}

export function calculateDemandForecastForBook(book, bookLoans, bookSubscriptions = [], now = new Date()) {
  const totalCopies = Math.max(Number(book?.totalCopies) || 0, Number(book?.stock) || 0, 1);
  const stock = Math.max(0, Number(book?.stock) || 0);
  const borrowedCopies = getBorrowedCopies(stock, totalCopies);
  const borrowPressurePercent = getBorrowPressurePercent(stock, totalCopies);

  const signals = {
    pendingReservations: 0,
    activeLoans: 0,
    recentLoans: 0,
    renewalRequests: 0,
    returnRequests: 0,
    stockAlerts: bookSubscriptions.length,
    stockPressure: 0,
    stockLevelLabel: "",
  };

  for (const loan of bookLoans) {
    const status = loan?.status || (loan?.returnedAt ? "returned" : loan?.dueDate || loan?.borrowDate ? "approved" : "pending");
    const requestAge = daysSince(loan?.requestDate || loan?.createdAt || loan?.borrowDate, now);
    const borrowAge = daysSince(loan?.borrowDate || loan?.approvedAt || loan?.createdAt, now);

    if (status === "pending") {
      signals.pendingReservations += 1;
      if (requestAge <= 14) signals.recentLoans += 1;
    }

    if (status === "approved" && !loan?.returnedAt) {
      signals.activeLoans += 1;
      if (borrowAge <= 30) signals.recentLoans += 1;
    }

    if (loan?.renewalRequestStatus === "pending") {
      signals.renewalRequests += 1;
    }

    if (loan?.returnRequestStatus === "pending") {
      signals.returnRequests += 1;
    }
  }

  signals.stockPressure = getStockPressure(stock, totalCopies);
  if (stock <= 0) {
    signals.stockLevelLabel = "out of stock";
  } else if (stock === 1) {
    signals.stockLevelLabel = "1 copy left";
  } else if (stock / totalCopies <= 0.25) {
    signals.stockLevelLabel = `${stock} copies left`;
  }

  const examPressure = getExamPressure(book?.examSeasonImpact);
  const baselinePressure = Number(book?.demandScore) || 0;
  const circulationPressure = (signals.activeLoans * 2)
    + (signals.pendingReservations * 3)
    + (signals.recentLoans * 1)
    + (signals.renewalRequests * 1)
    + (signals.returnRequests * 1)
    + (signals.stockAlerts * 2);
  const utilizationPressure = Math.round(((totalCopies - stock) / totalCopies) * 4);

  const demandScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        baselinePressure
        + examPressure
        + circulationPressure
        + utilizationPressure
        + signals.stockPressure
      )
    )
  );

  return {
    bookId: book._id,
    title: book.title,
    category: book.category,
    demandScore,
    demandBarPercent: borrowPressurePercent,
    examSeasonImpact: book.examSeasonImpact,
    stock,
    totalCopies,
    borrowedCopies,
    borrowedRatio: totalCopies > 0 ? Number((borrowedCopies / totalCopies).toFixed(2)) : 0,
    recommendation: getRecommendation(demandScore, stock, totalCopies, signals),
    signals,
    signalSummary: getSignalSummary(signals),
  };
}

export function buildDemandForecast(books, loans, subscriptions, now = new Date()) {
  const loansByBook = new Map();
  for (const loan of loans) {
    const bookId = toId(loan?.book?._id || loan?.book);
    if (!bookId) continue;
    const bucket = loansByBook.get(bookId) || [];
    bucket.push(loan);
    loansByBook.set(bookId, bucket);
  }

  const subscriptionsByBook = new Map();
  for (const subscription of subscriptions) {
    const bookId = toId(subscription?.book?._id || subscription?.book);
    if (!bookId) continue;
    const bucket = subscriptionsByBook.get(bookId) || [];
    bucket.push(subscription);
    subscriptionsByBook.set(bookId, bucket);
  }

  return books
    .map((book) => calculateDemandForecastForBook(
      book,
      loansByBook.get(toId(book._id)) || [],
      subscriptionsByBook.get(toId(book._id)) || [],
      now
    ))
    .sort((left, right) => right.demandScore - left.demandScore);
}
