import {
  addDays,
  endOfDay,
  isWithinInterval,
  parseISO,
  startOfDay,
} from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const EAT = 'Africa/Nairobi';
const LIVE_STATUSES = new Set(['active', 'delinquent']);

export function getLastInstallment(schedule) {
  if (!Array.isArray(schedule) || !schedule.length) return null;
  return [...schedule].sort(
    (a, b) => (a.installmentNumber || 0) - (b.installmentNumber || 0),
  ).at(-1);
}

export function installmentFullyPaid(inst) {
  if (!inst) return true;
  if (inst.status === 'paid') return true;
  const amt = Number(inst.amount || 0);
  const paid = Number(inst.paidAmount || 0);
  return paid >= amt - 0.01;
}

export function isFinalDueInWindow(lastInst, windowDays) {
  if (!lastInst?.dueDate) return false;
  if (installmentFullyPaid(lastInst)) return false;
  const dueStr = String(lastInst.dueDate);
  const due = parseISO(
    dueStr.length <= 10 ? `${dueStr}T12:00:00` : dueStr,
  );
  const dueEAT = toZonedTime(due, EAT);
  const now = toZonedTime(new Date(), EAT);
  const from = startOfDay(now);
  const to = endOfDay(addDays(from, windowDays));
  return isWithinInterval(dueEAT, { start: from, end: to });
}

export function isDisbursementInDateRange(loan, fromYmd, toYmd) {
  const d = loan?.disbursement_date;
  if (d == null || d === '') return false;
  const dStr = String(d).slice(0, 10);
  return dStr >= fromYmd && dStr <= toYmd;
}

/**
 * Nearing report: if disbursal date is missing, include the row; otherwise it must fall in the range.
 */
export function isDisbursalFilterForNearingReport(loan, fromYmd, toYmd) {
  if (!loan?.disbursement_date) return true;
  return isDisbursementInDateRange(loan, fromYmd, toYmd);
}

/**
 * Sum of scheduled installment amounts (principal+interest) with due date in [fromYmd, toYmd].
 */
export function sumScheduledDueInDateRange(loans, fromYmd, toYmd) {
  let total = 0;
  for (const loan of loans || []) {
    if (!LIVE_STATUSES.has(loan?.status)) continue;
    const sch = loan.schedule;
    if (!Array.isArray(sch)) continue;
    for (const inst of sch) {
      if (!inst?.dueDate) continue;
      const dStr = String(inst.dueDate).slice(0, 10);
      if (dStr >= fromYmd && dStr <= toYmd) {
        total += Number(inst.amount || 0);
      }
    }
  }
  return total;
}

function hasInstallmentDueInRange(loan, fromYmd, toYmd) {
  const sch = loan?.schedule;
  if (!Array.isArray(sch)) return false;
  for (const inst of sch) {
    if (!inst?.dueDate) continue;
    const dStr = String(inst.dueDate).slice(0, 10);
    if (dStr >= fromYmd && dStr <= toYmd) return true;
  }
  return false;
}

/**
 * Among live loans that have at least one installment due in the range, % that are still active (not delinquent).
 */
export function healthyBookShareInPeriod(loans, fromYmd, toYmd) {
  const touched = (loans || []).filter(
    (l) => LIVE_STATUSES.has(l?.status) && hasInstallmentDueInRange(l, fromYmd, toYmd),
  );
  if (touched.length === 0) return 100;
  const active = touched.filter((l) => l.status === 'active').length;
  return (active / touched.length) * 100;
}

/**
 * Active loans, disbursement in range, final installment due within windowDays from today (EAT), last inst unpaid.
 * Matches the officer "Nearing completion" / View all report (default 14 days).
 */
export function countNearingInDisbursalAndWindow(
  activeLoans,
  { fromYmd, toYmd, windowDays = 14 },
) {
  let n = 0;
  for (const loan of activeLoans || []) {
    if (loan?.status !== 'active') continue;
    if (!isDisbursalFilterForNearingReport(loan, fromYmd, toYmd)) continue;
    const last = getLastInstallment(loan.schedule);
    if (isFinalDueInWindow(last, windowDays)) n += 1;
  }
  return n;
}
