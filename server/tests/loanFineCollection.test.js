import test from "node:test";
import assert from "node:assert/strict";
import { calculateReturnFineOutcome } from "../src/utils/loanFineProcessing.js";

test("overdue returns create a fine, accumulate outstanding balance, and block the account", () => {
  const result = calculateReturnFineOutcome({
    dueDate: new Date("2026-04-01T00:00:00.000Z"),
    returnedAt: new Date("2026-04-04T08:00:00.000Z"),
    currentOutstanding: 5,
  });

  assert.equal(result.fineAmount, 10);
  assert.equal(result.shouldCreateFine, true);
  assert.equal(result.nextOutstanding, 15);
  assert.equal(result.isBlocked, true);
});

test("same-day or on-time returns do not add a fine", () => {
  const result = calculateReturnFineOutcome({
    dueDate: new Date("2026-04-04T23:59:59.000Z"),
    returnedAt: new Date("2026-04-04T12:00:00.000Z"),
    currentOutstanding: 0,
  });

  assert.equal(result.fineAmount, 0);
  assert.equal(result.shouldCreateFine, false);
  assert.equal(result.nextOutstanding, 0);
  assert.equal(result.isBlocked, false);
});

test("existing outstanding fines remain even when a later return is on time", () => {
  const result = calculateReturnFineOutcome({
    dueDate: new Date("2026-04-10T00:00:00.000Z"),
    returnedAt: new Date("2026-04-09T20:00:00.000Z"),
    currentOutstanding: 7.5,
  });

  assert.equal(result.fineAmount, 0);
  assert.equal(result.shouldCreateFine, false);
  assert.equal(result.nextOutstanding, 7.5);
  assert.equal(result.isBlocked, true);
});
