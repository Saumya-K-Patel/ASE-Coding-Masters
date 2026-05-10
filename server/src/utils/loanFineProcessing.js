import { computeFineFromDates } from "./loanPolicy.js";

export function calculateReturnFineOutcome({ dueDate, returnedAt = new Date(), currentOutstanding = 0 }) {
  const fineAmount = dueDate ? computeFineFromDates(new Date(dueDate), returnedAt) : 0;
  const nextOutstanding = Number((Number(currentOutstanding || 0) + fineAmount).toFixed(2));

  return {
    fineAmount,
    shouldCreateFine: fineAmount > 0,
    nextOutstanding,
    isBlocked: nextOutstanding > 0,
  };
}
