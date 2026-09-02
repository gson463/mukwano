import { startOfToday, isBefore, parse, parseISO, format } from 'date-fns';
import { format as formatTZ } from 'date-fns-tz';

const EAT_TIMEZONE = 'Africa/Nairobi';

/**
 * Format a repayment business date (YYYY-MM-DD from DB) for display.
 * Parses as calendar date — avoids UTC shift from parseISO on date-only strings.
 */
export function formatRepaymentBusinessDate(ymd, pattern = 'MMM dd, yyyy') {
  if (ymd == null || ymd === '') return '—';
  const s = String(ymd).slice(0, 10);
  const d = parse(s, 'yyyy-MM-dd', new Date());
  if (Number.isNaN(d.getTime())) return s;
  return format(d, pattern);
}

/**
 * Returns today's date as a string in YYYY-MM-DD format based on EAT timezone.
 * Used for min/max attributes on input[type="date"].
 */
export const getTodayDateString = () => {
  return formatTZ(new Date(), 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE });
};

/**
 * Compare YYYY-MM-DD strings to today in EAT. True if ymd is strictly before today.
 * @param {string} ymd
 */
export const isYMDBeforeTodayEAT = (ymd) => {
  if (!ymd) return true;
  return ymd < getTodayDateString();
};

/**
 * True if ymd is strictly after today in EAT (e.g. future-dated entry attempt).
 * @param {string} ymd
 */
export const isYMDAfterTodayEAT = (ymd) => {
  if (!ymd) return false;
  return ymd > getTodayDateString();
};

/**
 * Checks if a given date is in the past (strictly before today).
 * @param {Date|string} dateInput - Date object or ISO string (YYYY-MM-DD)
 * @returns {boolean}
 */
export const isDatePast = (dateInput) => {
  if (!dateInput) return false;
  const today = startOfToday();
  const dateToCheck = typeof dateInput === 'string' ? parseISO(dateInput) : dateInput;
  // We compare times by setting both to start of day to avoid time issues
  const checkDateStart = new Date(dateToCheck);
  checkDateStart.setHours(0, 0, 0, 0);
  return isBefore(checkDateStart, today);
};

/**
 * Predicate function for Calendar component to disable past dates.
 * @param {Date} date 
 * @returns {boolean}
 */
export const disablePastDates = (date) => {
  return isBefore(date, startOfToday());
};

/**
 * Helper to validate a date and show toast if invalid.
 * @param {Date|string} date - Date to check
 * @param {string} errorMessage - Message to show
 * @param {Function} toast - Toast function
 * @returns {boolean} - True if valid (not past), False if invalid (past)
 */
export const validateDateSelection = (date, errorMessage, toast) => {
    if (isDatePast(date)) {
        toast({
            title: "Invalid Date Selection",
            description: errorMessage,
            variant: "destructive"
        });
        return false;
    }
    return true;
};