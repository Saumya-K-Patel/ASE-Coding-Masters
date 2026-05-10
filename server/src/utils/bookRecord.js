function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const CURRENT_DEMAND_VERSION = 2;

function clampDemandScore(value) {
  return Math.max(0, Math.min(100, Math.round(toFiniteNumber(value, 0))));
}

export function getBookStock(book) {
  if (!book) return 0;
  if (Number.isFinite(Number(book.stock))) return Math.max(0, Number(book.stock));
  if (Number.isFinite(Number(book.availableCopies))) return Math.max(0, Number(book.availableCopies));
  if (Number.isFinite(Number(book.totalCopies))) return Math.max(0, Number(book.totalCopies));
  return 0;
}

export function getBookTotalCopies(book) {
  if (!book) return 0;
  if (Number.isFinite(Number(book.totalCopies))) return Math.max(0, Number(book.totalCopies));
  return getBookStock(book);
}

export function getBookLocation(book) {
  if (!book) {
    return { floor: 1, shelf: "GEN-01", row: 1 };
  }

  return {
    floor: toFiniteNumber(book.location?.floor ?? book.floor, 1),
    shelf: String(book.location?.shelf ?? book.shelfCode ?? "GEN-01"),
    row: toFiniteNumber(book.location?.row ?? book.row, 1),
  };
}

export function getLowStockDemandBump(stock, totalCopies) {
  if (totalCopies <= 0) return 2;
  const ratio = stock / totalCopies;
  if (stock <= 0) return 3;
  if (stock === 1) return 2;
  if (ratio <= 0.25) return 1;
  return 0;
}

export function getDefaultDemandScore(book) {
  const examImpact = String(book?.examSeasonImpact || "Low");
  const baseByExamImpact = {
    Low: 8,
    Medium: 10,
    High: 12,
    "Very High": 14,
  };

  let baseline = baseByExamImpact[examImpact] ?? 8;
  if (getBookTotalCopies(book) <= 2) baseline += 1;
  if (getBookStock(book) <= 0) baseline += 1;
  return clampDemandScore(Math.min(baseline, 18));
}

export function getBookDemandScore(book) {
  if (!book) return 0;
  const rawScore = Number(book.demandScore ?? book.demandPrediction?.score);
  const isCurrentDemandProfile = Number(book.demandVersion) >= CURRENT_DEMAND_VERSION;

  if (Number.isFinite(rawScore) && rawScore > 0 && isCurrentDemandProfile) {
    return clampDemandScore(rawScore);
  }

  if (Number.isFinite(rawScore) && rawScore > 0) {
    return clampDemandScore(Math.max(getDefaultDemandScore(book), Math.min(28, rawScore * 0.3)));
  }

  return getDefaultDemandScore(book);
}

export function getBookDemandCalibration(book) {
  const nextDemandScore = getBookDemandScore(book);
  const rawScore = Number(book?.demandScore ?? book?.demandPrediction?.score);
  const isCurrentDemandProfile = Number(book?.demandVersion) >= CURRENT_DEMAND_VERSION;

  if (isCurrentDemandProfile && Number.isFinite(rawScore) && clampDemandScore(rawScore) === nextDemandScore) {
    return null;
  }

  return {
    demandScore: nextDemandScore,
    demandVersion: CURRENT_DEMAND_VERSION,
  };
}

export function setBookDemandScore(book, nextDemandScore) {
  const normalized = clampDemandScore(nextDemandScore);
  book.demandScore = normalized;
  book.demandVersion = CURRENT_DEMAND_VERSION;

  if (typeof book.set === "function") {
    book.set("demandScore", normalized, { strict: false });
    book.set("demandVersion", CURRENT_DEMAND_VERSION, { strict: false });
  }

  return normalized;
}

export function increaseBookDemandScore(book, delta = 2) {
  return setBookDemandScore(book, getBookDemandScore(book) + delta);
}

export function getBorrowDemandDelta(book, nextStock = getBookStock(book) - 1) {
  const totalCopies = getBookTotalCopies(book);
  return 2 + getLowStockDemandBump(Math.max(0, nextStock), totalCopies);
}

export function buildDemandCalibrationOperations(books) {
  const operations = [];

  for (const book of books) {
    const calibration = getBookDemandCalibration(book);
    if (!calibration) continue;

    setBookDemandScore(book, calibration.demandScore);
    operations.push({
      updateOne: {
        filter: { _id: book._id },
        update: { $set: calibration },
      },
    });
  }

  return operations;
}

export function setBookStock(book, nextStock) {
  const normalized = Math.max(0, toFiniteNumber(nextStock, 0));
  const totalCopies = getBookTotalCopies(book);
  const clamped = totalCopies > 0 ? Math.min(normalized, totalCopies) : normalized;

  book.stock = clamped;
  book.totalCopies = Math.max(totalCopies, clamped);
  book.location = getBookLocation(book);
  book.set("availableCopies", clamped, { strict: false });
  book.set("floor", String(getBookLocation(book).floor), { strict: false });
  book.set("shelfCode", getBookLocation(book).shelf, { strict: false });
  book.set("row", String(getBookLocation(book).row), { strict: false });

  return clamped;
}

export function serializeBook(book) {
  if (!book) return null;
  const plain = typeof book.toObject === "function" ? book.toObject({ virtuals: true }) : { ...book };
  return {
    ...plain,
    coverImageUrl: String(plain.coverImageUrl || ""),
    stock: getBookStock(book),
    totalCopies: getBookTotalCopies(book),
    location: getBookLocation(book),
    demandScore: getBookDemandScore(book),
    demandVersion: Number(plain.demandVersion) || CURRENT_DEMAND_VERSION,
  };
}
