function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

export function getBookDemandScore(book) {
  if (!book) return 0;
  if (Number.isFinite(Number(book.demandScore))) return Number(book.demandScore);
  if (Number.isFinite(Number(book.demandPrediction?.score))) return Number(book.demandPrediction.score);
  return 0;
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
    stock: getBookStock(book),
    totalCopies: getBookTotalCopies(book),
    location: getBookLocation(book),
    demandScore: getBookDemandScore(book),
  };
}
