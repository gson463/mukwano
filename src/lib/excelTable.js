/**
 * Excel-like data grid: visible cell borders and grey header row
 * (same pattern as officer LoanManagement / RepaymentManagement).
 */

export const excelTableWrapperClassName =
    'overflow-x-auto rounded-md border border-slate-300 bg-white shadow-sm dark:border-slate-600 dark:bg-card';

export const excelTableClassName = 'border-collapse border-0 text-sm';

const EXCEL_TH =
    'border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100';

const EXCEL_TD = 'border border-slate-300 dark:border-slate-600';

export function excelThClassName(extra = '') {
    return [EXCEL_TH, extra].filter(Boolean).join(' ');
}

export function excelTdClassName(extra = '') {
    return [EXCEL_TD, extra].filter(Boolean).join(' ');
}

export const excelTableRowClassName = 'border-slate-200 dark:border-slate-700';

export const excelEmptyStateCellClassName =
    'border border-slate-300 py-8 text-center text-muted-foreground dark:border-slate-600';
