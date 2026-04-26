/** Default page size for client-side table pagination (loans, repayments, borrowers, etc.). */
export const DEFAULT_TABLE_PAGE_SIZE = 10;

export function getTotalPages(totalCount, pageSize) {
  if (pageSize < 1) return 1;
  return Math.max(1, Math.ceil(totalCount / pageSize) || 1);
}

export function slicePage(items, currentPage, pageSize) {
  const start = (currentPage - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
