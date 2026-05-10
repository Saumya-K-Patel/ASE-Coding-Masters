import test from "node:test";
import assert from "node:assert/strict";
import {
  getBorrowDemandDelta,
  getBookDemandScore,
  increaseBookDemandScore,
} from "../src/utils/bookRecord.js";
import { calculateDemandForecastForBook } from "../src/utils/demandForecast.js";

test("legacy or missing demand scores are calibrated to a small default range", () => {
  const lowDemandBook = {
    title: "Quiet Catalog Title",
    examSeasonImpact: "Low",
    totalCopies: 4,
    stock: 4,
  };

  const legacyDemandBook = {
    title: "Previously Overweighted Title",
    examSeasonImpact: "Very High",
    totalCopies: 5,
    stock: 5,
    demandScore: 92,
    demandVersion: 1,
  };

  assert.equal(getBookDemandScore(lowDemandBook), 8);
  assert.equal(getBookDemandScore(legacyDemandBook), 28);
});

test("approved borrowing nudges demand upward instead of jumping sharply", () => {
  const book = {
    title: "Borrowed Title",
    examSeasonImpact: "Medium",
    totalCopies: 5,
    stock: 5,
    demandScore: 10,
    demandVersion: 2,
  };

  assert.equal(increaseBookDemandScore(book, 2), 12);
  assert.equal(book.demandScore, 12);
  assert.equal(book.demandVersion, 2);
});

test("borrowing applies a stronger bump when the checkout pushes a book into low stock", () => {
  const healthyStockBook = {
    title: "Healthy Inventory",
    totalCopies: 5,
    stock: 5,
  };

  const lowStockBook = {
    title: "Low Inventory",
    totalCopies: 3,
    stock: 2,
  };

  assert.equal(getBorrowDemandDelta(healthyStockBook, 4), 2);
  assert.equal(getBorrowDemandDelta(lowStockBook, 1), 4);
});

test("forecast adds a modest circulation boost for an active borrowed copy", () => {
  const book = {
    _id: "book-1",
    title: "Circulation Signals",
    category: "Information Science",
    examSeasonImpact: "Medium",
    totalCopies: 5,
    stock: 4,
    demandScore: 12,
    demandVersion: 2,
  };

  const forecast = calculateDemandForecastForBook(
    book,
    [
      {
        book: "book-1",
        status: "approved",
        borrowDate: "2026-04-10T00:00:00.000Z",
      },
    ],
    [],
    new Date("2026-04-14T00:00:00.000Z")
  );

  assert.equal(forecast.demandScore, 18);
  assert.equal(forecast.signals.activeLoans, 1);
  assert.equal(forecast.signals.recentLoans, 1);
});

test("forecast highlights low stock directly in the predictor output", () => {
  const book = {
    _id: "book-2",
    title: "Low Stock Focus",
    category: "Computer Science",
    examSeasonImpact: "Low",
    totalCopies: 4,
    stock: 1,
    demandScore: 11,
    demandVersion: 2,
  };

  const forecast = calculateDemandForecastForBook(book, [], [], new Date("2026-04-14T00:00:00.000Z"));

  assert.equal(forecast.recommendation, "Increase copies soon");
  assert.equal(forecast.signals.stockLevelLabel, "1 copy left");
  assert.ok(forecast.signalSummary.includes("1 copy left"));
});
