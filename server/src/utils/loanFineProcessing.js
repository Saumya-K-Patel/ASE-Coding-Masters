import { computeFineFromDates, getOverdueDailyRateByDemand } from "./loanPolicy.js";

export function calculateReturnFineOutcome({
  dueDate,
  returnedAt = new Date(),
  currentOutstanding = 0,
  demandScore = 0,
  dailyRate,
}) {
  const configuredRate = Number(dailyRate);
  const effectiveDailyRate = Number.isFinite(configuredRate) && configuredRate > 0
    ? configuredRate
    : getOverdueDailyRateByDemand(demandScore);
  const fineAmount = dueDate
    ? computeFineFromDates(new Date(dueDate), returnedAt, { dailyRate: effectiveDailyRate })
    : 0;
  const nextOutstanding = Number((Number(currentOutstanding || 0) + fineAmount).toFixed(2));

  return {
    fineAmount,
    dailyRate: effectiveDailyRate,
    shouldCreateFine: fineAmount > 0,
    nextOutstanding,
    isBlocked: nextOutstanding > 0,
  };
}
