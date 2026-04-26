import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getTotalPages } from '@/lib/tablePagination';

/**
 * Client-side table footer: "Showing a–b of n" and prev/next. Same pattern as manager LoanManagement.
 */
export function TablePaginationBar({
  className,
  currentPage,
  /** Same contract as the setter from `useState` for the page number (supports functional updates). */
  setCurrentPage,
  totalCount,
  pageSize,
  disabled = false,
}) {
  const totalPages = getTotalPages(totalCount, pageSize);
  const from = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const to = totalCount === 0 ? 0 : Math.min(currentPage * pageSize, totalCount);

  return (
    <div
      className={cn(
        'mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <p className="text-sm text-muted-foreground">
        {totalCount === 0
          ? 'Showing 0 of 0'
          : `Showing ${from}–${to} of ${totalCount}`}
      </p>
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          disabled={disabled || currentPage <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[6rem] text-center text-sm tabular-nums text-muted-foreground">
          Page {currentPage} / {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          disabled={disabled || currentPage >= totalPages}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
