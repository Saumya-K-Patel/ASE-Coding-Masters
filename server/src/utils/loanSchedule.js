import { getLoanPolicyByDemand } from "./loanPolicy.js";
import { getBookDemandScore } from "./bookRecord.js";

function parseDate(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function resolveBorrowPolicyDays(loan, book = loan?.book) {
  const stored = Number(loan?.borrowPolicyDays);
  if (Number.isFinite(stored) && stored > 0) return stored;
  return getLoanPolicyByDemand(getBookDemandScore(book)).loanDays;
}

export function resolveLoanPolicy(loan, book = loan?.book) {
  const derivedPolicy = getLoanPolicyByDemand(getBookDemandScore(book));
  const storedMaxRenewals = Number(loan?.maxRenewals);
  const storedOverdueDailyRate = Number(loan?.overdueDailyRate);

  return {
    ...derivedPolicy,
    loanDays: resolveBorrowPolicyDays(loan, book),
    maxRenewals: Number.isFinite(storedMaxRenewals) && storedMaxRenewals >= 0
      ? storedMaxRenewals
      : derivedPolicy.maxRenewals,
    overdueDailyRate: Number.isFinite(storedOverdueDailyRate) && storedOverdueDailyRate > 0
      ? storedOverdueDailyRate
      : derivedPolicy.overdueDailyRate,
    tier: String(loan?.policyTier || derivedPolicy.tier),
  };
}

export function resolveBorrowDate(loan) {
  return (
    parseDate(loan?.borrowDate)
    || parseDate(loan?.approvedAt)
    || parseDate(loan?.requestDate)
    || parseDate(loan?.createdAt)
    || null
  );
}

export function resolveDueDate(loan, book = loan?.book) {
  const existingDueDate = parseDate(loan?.dueDate);
  if (existingDueDate) return existingDueDate;

  const borrowDate = resolveBorrowDate(loan);
  if (!borrowDate) return null;

  const loanDays = resolveBorrowPolicyDays(loan, book);
  return new Date(borrowDate.getTime() + loanDays * 24 * 60 * 60 * 1000);
}

export function synchronizeApprovedLoanSchedule(loan, book = loan?.book) {
  const nextBorrowDate = resolveBorrowDate(loan);
  const nextPolicy = resolveLoanPolicy(loan, book);
  const nextBorrowPolicyDays = nextPolicy.loanDays;
  const nextDueDate = resolveDueDate(
    {
      ...loan,
      borrowDate: loan?.borrowDate || nextBorrowDate,
      borrowPolicyDays: loan?.borrowPolicyDays || nextBorrowPolicyDays,
    },
    book
  );

  let changed = false;

  if (!loan?.borrowDate && nextBorrowDate) {
    loan.borrowDate = nextBorrowDate;
    changed = true;
  }

  if (!(Number.isFinite(Number(loan?.borrowPolicyDays)) && Number(loan.borrowPolicyDays) > 0)) {
    loan.borrowPolicyDays = nextBorrowPolicyDays;
    changed = true;
  }

  if (!(Number.isFinite(Number(loan?.maxRenewals)) && Number(loan.maxRenewals) >= 0)) {
    loan.maxRenewals = nextPolicy.maxRenewals;
    changed = true;
  }

  if (!(Number.isFinite(Number(loan?.overdueDailyRate)) && Number(loan.overdueDailyRate) > 0)) {
    loan.overdueDailyRate = nextPolicy.overdueDailyRate;
    changed = true;
  }

  if (!loan?.policyTier) {
    loan.policyTier = nextPolicy.tier;
    changed = true;
  }

  if (!loan?.dueDate && nextDueDate) {
    loan.dueDate = nextDueDate;
    changed = true;
  }

  if (!loan?.status && nextDueDate) {
    loan.status = "approved";
    changed = true;
  }

  return {
    changed,
    borrowDate: nextBorrowDate,
    dueDate: nextDueDate,
    borrowPolicyDays: nextBorrowPolicyDays,
    policy: nextPolicy,
  };
}
