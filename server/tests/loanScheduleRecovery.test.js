import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveBorrowDate,
  resolveBorrowPolicyDays,
  resolveDueDate,
  synchronizeApprovedLoanSchedule,
} from "../src/utils/loanSchedule.js";

test("legacy approved loans recover borrow and due dates from approvedAt plus policy days", () => {
  const loan = {
    status: "approved",
    approvedAt: new Date("2026-04-01T00:00:00.000Z"),
    borrowDate: null,
    dueDate: null,
    borrowPolicyDays: 14,
  };

  const borrowDate = resolveBorrowDate(loan);
  const dueDate = resolveDueDate(loan);

  assert.equal(borrowDate?.toISOString(), "2026-04-01T00:00:00.000Z");
  assert.equal(dueDate?.toISOString(), "2026-04-15T00:00:00.000Z");
});

test("schedule synchronization fills missing due date so overdue fine logic can run later", () => {
  const loan = {
    status: "approved",
    approvedAt: new Date("2026-04-01T00:00:00.000Z"),
    borrowDate: null,
    dueDate: null,
    borrowPolicyDays: 10,
    book: { demandScore: 20, demandVersion: 2 },
  };

  const result = synchronizeApprovedLoanSchedule(loan, loan.book);

  assert.equal(result.changed, true);
  assert.equal(loan.borrowDate?.toISOString(), "2026-04-01T00:00:00.000Z");
  assert.equal(loan.dueDate?.toISOString(), "2026-04-11T00:00:00.000Z");
  assert.equal(resolveBorrowPolicyDays(loan, loan.book), 10);
});
