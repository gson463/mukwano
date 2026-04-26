import { addDays, format, parseISO } from 'date-fns';

export const SYSTEM_HOLIDAYS = [
  "2024-12-25", "2024-01-01", 
  "2025-12-25", "2025-01-01", 
  "2026-12-25", "2026-01-01"
];

const toYmd = (dateInput) => {
  if (!dateInput) return null;
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(String(dateInput).trim())) {
    return String(dateInput).trim();
  }
  const d = typeof dateInput === 'string' ? parseISO(dateInput) : dateInput;
  if (!d || Number.isNaN(d.getTime?.())) return null;
  return format(d, 'yyyy-MM-dd');
};

/**
 * Sunday, fixed system holidays, or a date in `holidays` (admin table) — not a working day.
 * @param {Date|string} dateInput
 * @param {{ date: string }[]} [dbHolidayRows] rows from `holidays` with `date` YYYY-MM-DD
 * @returns {boolean}
 */
export const isNonWorkingDay = (dateInput, dbHolidayRows = []) => {
  const dateStr = toYmd(dateInput);
  if (!dateStr) return false;
  const [Y, M, D] = dateStr.split('-').map(Number);
  const local = new Date(Y, M - 1, D);
  if (local.getDay() === 0) return true;
  if (SYSTEM_HOLIDAYS.includes(dateStr)) return true;
  if (Array.isArray(dbHolidayRows) && dbHolidayRows.some((h) => h && h.date === dateStr)) return true;
  return false;
};

export const isHolidayOrSunday = (date) => isNonWorkingDay(date, []);

/**
 * First calendar day on or after `fromYmd` that is a working day (not Sun/holiday).
 * @param {string} fromYmd - YYYY-MM-DD
 * @param {{ date: string }[]} [dbHolidayRows]
 * @returns {string}
 */
export const getNextWorkingDateString = (fromYmd, dbHolidayRows = []) => {
  if (!fromYmd || !/^\d{4}-\d{2}-\d{2}$/.test(fromYmd)) return fromYmd;
  let cur = fromYmd;
  for (let i = 0; i < 400; i += 1) {
    if (!isNonWorkingDay(cur, dbHolidayRows)) return cur;
    const [y, m, d] = cur.split('-').map(Number);
    cur = format(addDays(new Date(y, m - 1, d), 1), 'yyyy-MM-dd');
  }
  return fromYmd;
};

/**
 * Returns configuration for disabled dates in Calendar component.
 * Disables Sundays and System Holidays.
 * @returns {Array} Matcher array for react-day-picker
 */
export const getDisabledDates = () => {
    const holidayDates = SYSTEM_HOLIDAYS.map(d => new Date(d));
    return [
        { dayOfWeek: [0] }, // Sunday
        ...holidayDates
    ];
};

/**
 * Validates a date selection against holidays and Sundays.
 * @param {Date|string} date - The date to check
 * @param {Function} toast - Toast function from useToast
 * @param {string} actionDescription - Description for error message (e.g. "select", "process")
 * @param {{ date: string }[]} [dbHolidayRows] optional holidays from database
 * @returns {boolean} - True if valid, False if invalid
 */
export const validateHolidaySelection = (date, toast, actionDescription = "select", dbHolidayRows) => {
    if (date == null || date === '') return true;
    if (isNonWorkingDay(date, dbHolidayRows ?? [])) {
        toast({
            title: "Invalid Date Selection",
            description: `Cannot ${actionDescription} on Sundays, public holidays, or system holidays. Please choose a working day.`,
            variant: "destructive"
        });
        return false;
    }
    return true;
};