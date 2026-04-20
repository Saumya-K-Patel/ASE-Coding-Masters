function clampDemandScore(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export function getLoanPolicyByDemand(demandScore) {
  const normalizedDemand = clampDemandScore(demandScore);

  if (normalizedDemand >= 85) {
    return {
      tier: "critical",
      label: "Critical demand",
      demandScore: normalizedDemand,
      loanDays: 5,
      maxRenewals: 0,
      overdueDailyRate: 6,
    };
  }

  if (normalizedDemand >= 65) {
    return {
      tier: "high",
      label: "High demand",
      demandScore: normalizedDemand,
      loanDays: 7,
      maxRenewals: 1,
      overdueDailyRate: 4.5,
    };
  }

  if (normalizedDemand >= 45) {
    return {
      tier: "elevated",
      label: "Elevated demand",
      demandScore: normalizedDemand,
      loanDays: 10,
      maxRenewals: 1,
      overdueDailyRate: 3.5,
    };
  }

  return {
    tier: "standard",
    label: "Standard demand",
    demandScore: normalizedDemand,
    loanDays: 14,
    maxRenewals: 2,
    overdueDailyRate: 2.5,
  };
}

export function getLoanDaysByDemand(demandScore) {
  return getLoanPolicyByDemand(demandScore).loanDays;
}

export function getMaxRenewalsByDemand(demandScore) {
  return getLoanPolicyByDemand(demandScore).maxRenewals;
}

export function getOverdueDailyRateByDemand(demandScore) {
  return getLoanPolicyByDemand(demandScore).overdueDailyRate;
}

export function computeFineFromDates(dueDate, now = new Date(), options = {}) {
  if (now <= dueDate) return 0;

  const msPerDay = 1000 * 60 * 60 * 24;
  const daysLate = Math.ceil((now - dueDate) / msPerDay);
  const configuredDailyRate = Number(options.dailyRate);
  const dailyRate = Number.isFinite(configuredDailyRate) && configuredDailyRate > 0
    ? configuredDailyRate
    : 2.5;

  return Number((daysLate * dailyRate).toFixed(2));
}
