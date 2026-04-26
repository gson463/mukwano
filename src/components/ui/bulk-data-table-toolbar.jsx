import React from 'react';
import { Button } from '@/components/ui/button';
import { Download, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Shown when rows are selected; bulk CSV export + clear + optional actions.
 */
export function BulkDataTableToolbar({
  className,
  selectedCount,
  onExportCsv,
  onClear,
  disabled,
  children,
}) {
  if (!selectedCount) return null;
  return (
    <div
      className={cn(
        'mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-green-700/25 bg-green-50 px-3 py-2 text-sm',
        className,
      )}
    >
      <span className="font-semibold text-gray-800">
        {selectedCount} selected
      </span>
      {onExportCsv && (
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onExportCsv} className="gap-1.5">
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      )}
      {onClear && (
        <Button type="button" size="sm" variant="ghost" onClick={onClear} className="gap-1.5">
          <X className="h-3.5 w-3.5" />
          Clear
        </Button>
      )}
      {children}
    </div>
  );
}
