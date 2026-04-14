export function getLoanDaysByDemand(demandScore) {
  if (demandScore >= 85) return 7;
  if (demandScore >= 65) return 10;
  return 14;
}

export function computeFineFromDates(dueDate, now = new Date()) {
  if (now <= dueDate) return 0;
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysLate = Math.ceil((now - dueDate) / msPerDay);
  return Number((daysLate * 2.5).toFixed(2));
}
