import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { format, parse, startOfMonth, endOfDay } from 'date-fns';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  getDashboardBasePath,
  loadMetricData,
} from '@/lib/dashboardMetricLoaders';

const PER_PAGE_OPTIONS = [10, 25, 50, 100];

const excelHead =
  'border border-slate-300 bg-green-100 px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-green-900';
const excelCell =
  'border border-slate-300 px-2 py-1.5 text-sm text-foreground';
const excelRowEven = 'bg-white';
const excelRowOdd = 'bg-slate-50';

const VALID = {
  officer: [
    'borrowers',
    'active-loans',
    'portfolio',
    'principal-disbursed',
    'principal-collected',
    'interest-collected',
    'outstanding-principal',
    'outstanding-interest',
    'defaulted-principal',
    'defaulted-interest',
    'expected-today',
    'disbursed-this-month',
  ],
  manager: [
    'borrowers',
    'active-loans',
    'portfolio',
    'principal-disbursed',
    'principal-collected',
    'interest-collected',
    'outstanding-principal',
    'outstanding-interest',
    'defaulted-principal',
    'defaulted-interest',
    'expected-today',
    'disbursed-this-month',
    'loan-officers',
  ],
  admin: [
    'borrowers',
    'active-loans',
    'portfolio',
    'principal-disbursed',
    'principal-collected',
    'interest-collected',
    'outstanding-principal',
    'outstanding-interest',
    'defaulted-principal',
    'defaulted-interest',
    'expected-today',
    'disbursed-this-month',
  ],
};

async function loadCenterGroupFilters(supabaseClient, role, user, branchId) {
  if (role === 'officer') {
    const { data: c } = await supabaseClient
      .from('centers')
      .select('id, name')
      .eq('loan_officer_id', user.id)
      .order('name');
    const { data: g } = await supabaseClient
      .from('groups')
      .select('id, name, center_id')
      .eq('loan_officer_id', user.id);
    return { centers: c || [], groups: g || [], branchOfficers: [] };
  }
  if (role === 'manager' && branchId) {
    const { data: off } = await supabaseClient
      .from('users')
      .select('id, full_name')
      .eq('branch_id', branchId)
      .eq('role', 'officer')
      .order('full_name');
    const { data: c } = await supabaseClient
      .from('centers')
      .select('id, name, loan_officer_id')
      .eq('branch_id', branchId)
      .order('name');
    const oids = (off || []).map((x) => x.id);
    let groups = [];
    if (oids.length) {
      const { data: gr } = await supabaseClient
        .from('groups')
        .select('id, name, center_id, loan_officer_id')
        .in('loan_officer_id', oids);
      groups = gr || [];
    }
    return { centers: c || [], groups, branchOfficers: off || [] };
  }
  const { data: c } = await supabaseClient
    .from('centers')
    .select('id, name')
    .order('name')
    .limit(500);
  const { data: g } = await supabaseClient
    .from('groups')
    .select('id, name, center_id')
    .limit(2000);
  return { centers: c || [], groups: g || [], branchOfficers: [] };
}

const DashboardMetricDrillDown = () => {
  const { metric: metricParam } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const role = user?.user_metadata?.role;
  const basePath = role ? getDashboardBasePath(role) : '/';

  const metric = (metricParam || '').toLowerCase();
  const [loading, setLoading] = useState(true);
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [pageTitle, setPageTitle] = useState('');
  const [centers, setCenters] = useState([]);
  const [groups, setGroups] = useState([]);
  const [branchOfficers, setBranchOfficers] = useState([]);

  const fromStr = searchParams.get('from') || format(startOfMonth(new Date()), 'yyyy-MM-dd');
  const toStr = searchParams.get('to') || format(endOfDay(new Date()), 'yyyy-MM-dd');
  const officerId = searchParams.get('officer') || 'all';
  const centerId = searchParams.get('center') || 'all';
  const groupId = searchParams.get('group') || 'all';

  const showManagerOfficerFilter =
    role === 'manager' && metric !== 'loan-officers';

  const perPage = useMemo(() => {
    const n = parseInt(searchParams.get('perPage') || '25', 10);
    return PER_PAGE_OPTIONS.includes(n) ? n : 25;
  }, [searchParams]);

  const page = useMemo(() => {
    const p = parseInt(searchParams.get('page') || '1', 10);
    return Number.isFinite(p) && p > 0 ? p : 1;
  }, [searchParams]);

  const setPageInUrl = (p) => {
    const next = new URLSearchParams(searchParams);
    if (p <= 1) next.delete('page');
    else next.set('page', String(p));
    setSearchParams(next, { replace: true });
  };

  const setPerPageInUrl = (n) => {
    const next = new URLSearchParams(searchParams);
    next.set('perPage', String(n));
    next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const isFirstFilterMount = useRef(true);
  useEffect(() => {
    if (isFirstFilterMount.current) {
      isFirstFilterMount.current = false;
      return;
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('page');
        return next;
      },
      { replace: true },
    );
  }, [fromStr, toStr, officerId, centerId, groupId, metric, setSearchParams]);

  const dateRange = useMemo(
    () => ({
      from: parse(fromStr, 'yyyy-MM-dd', new Date()),
      to: parse(toStr, 'yyyy-MM-dd', new Date()),
    }),
    [fromStr, toStr],
  );

  const setRangeInUrl = (from, to) => {
    const next = new URLSearchParams(searchParams);
    if (from) next.set('from', format(from, 'yyyy-MM-dd'));
    if (to) next.set('to', format(to, 'yyyy-MM-dd'));
    next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const setCenter = (v) => {
    const next = new URLSearchParams(searchParams);
    if (v && v !== 'all') next.set('center', v);
    else next.delete('center');
    next.delete('group');
    next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const setGroup = (v) => {
    const next = new URLSearchParams(searchParams);
    if (v && v !== 'all') next.set('group', v);
    else next.delete('group');
    next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const setOfficer = (v) => {
    const next = new URLSearchParams(searchParams);
    if (v && v !== 'all') next.set('officer', v);
    else next.delete('officer');
    next.delete('center');
    next.delete('group');
    next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const centersForSelectedOfficer = useMemo(() => {
    if (!showManagerOfficerFilter || officerId === 'all') return [];
    return centers.filter((c) => c.loan_officer_id === officerId);
  }, [centers, officerId, showManagerOfficerFilter]);

  const groupsForGroupDropdown = useMemo(() => {
    if (showManagerOfficerFilter) {
      if (officerId === 'all') return [];
      if (centerId === 'all') {
        return groups.filter((g) => g.loan_officer_id === officerId);
      }
      return groups.filter(
        (g) => g.center_id === centerId && g.loan_officer_id === officerId,
      );
    }
    if (centerId === 'all') return groups;
    return groups.filter((g) => g.center_id === centerId);
  }, [showManagerOfficerFilter, groups, centerId, officerId]);

  useEffect(() => {
    if (role !== 'manager') return;
    if (officerId === 'all' && (centerId !== 'all' || groupId !== 'all')) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('center');
          next.delete('group');
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    }
  }, [role, officerId, centerId, groupId, setSearchParams]);

  useEffect(() => {
    if (!user || !role) return;
    if (!VALID[role]?.includes(metric)) {
      navigate(basePath, { replace: true });
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const branchId = user.user_metadata?.branch_id ?? null;
      const { centers: c, groups: g, branchOfficers: bo } = await loadCenterGroupFilters(
        supabase,
        role,
        user,
        branchId,
      );
      if (cancelled) return;
      setCenters(c);
      setGroups(g);
      setBranchOfficers(bo);
      const res = await loadMetricData({
        role,
        metric,
        fromStr,
        toStr,
        centerId,
        groupId,
        officerId: showManagerOfficerFilter ? officerId : 'all',
        user,
        supabase,
        toast,
      });
      if (cancelled) return;
      setPageTitle(res.pageTitle);
      setColumns(res.columns);
      setRows(res.rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    user,
    role,
    metric,
    fromStr,
    toStr,
    officerId,
    centerId,
    groupId,
    showManagerOfficerFilter,
    navigate,
    basePath,
    toast,
  ]);

  const totalPages = Math.max(1, Math.ceil(rows.length / perPage) || 1);
  const slice = rows.slice((page - 1) * perPage, page * perPage);

  useEffect(() => {
    if (loading) return;
    const tp = Math.max(1, Math.ceil(rows.length / perPage) || 1);
    if (rows.length > 0 && page > tp) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tp <= 1) next.delete('page');
          else next.set('page', String(tp));
          return next;
        },
        { replace: true },
      );
    }
  }, [loading, rows.length, perPage, page, setSearchParams]);

  if (!user) {
    return null;
  }
  if (role && !VALID[role]?.includes(metric)) {
    return null;
  }

  return (
    <DashboardLayout
      title={pageTitle || 'Details'}
      description="Microfinance Management System"
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button
            variant="ghost"
            className="w-fit gap-1 pl-0 text-green-800 hover:text-green-900"
            onClick={() => navigate(basePath)}
          >
            <ChevronLeft className="h-4 w-4" />
            My dashboard
          </Button>
        </div>

        <div className="flex flex-col gap-4 rounded-xl border bg-white p-4 shadow-sm md:flex-row md:flex-wrap md:items-end">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Date range</p>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-full min-w-[260px] justify-start text-left font-normal md:w-[300px]',
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {fromStr} – {toStr}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  initialFocus
                  mode="range"
                  numberOfMonths={2}
                  selected={dateRange}
                  onSelect={(r) => {
                    if (r?.from) {
                      setRangeInUrl(r.from, r.to || r.from);
                    }
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>

          {showManagerOfficerFilter && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Loan officer</p>
              <Select value={officerId} onValueChange={setOfficer}>
                <SelectTrigger className="w-full min-w-[180px] md:w-[220px]">
                  <SelectValue placeholder="All officers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All loan officers (branch)</SelectItem>
                  {branchOfficers.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!(role === 'manager' && metric === 'loan-officers') && (
            <>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Center</p>
            <Select
              value={centerId}
              onValueChange={setCenter}
              disabled={showManagerOfficerFilter && officerId === 'all'}
            >
              <SelectTrigger
                className="w-full min-w-[180px] md:w-[200px] disabled:opacity-60"
                title={
                  showManagerOfficerFilter && officerId === 'all'
                    ? 'Select a loan officer first to filter by centre'
                    : undefined
                }
              >
                <SelectValue
                  placeholder={
                    showManagerOfficerFilter && officerId === 'all'
                      ? 'Select loan officer first'
                      : 'All centers'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All centers</SelectItem>
                {(showManagerOfficerFilter ? centersForSelectedOfficer : centers).map(
                  (c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Group</p>
            <Select
              value={groupId}
              onValueChange={setGroup}
              disabled={
                showManagerOfficerFilter
                  ? officerId === 'all' || centerId === 'all'
                  : centerId !== 'all' && !groupsForGroupDropdown.length
              }
            >
              <SelectTrigger
                className="w-full min-w-[180px] md:w-[200px] disabled:opacity-60"
                title={
                  showManagerOfficerFilter && officerId === 'all'
                    ? 'Select a loan officer first'
                    : showManagerOfficerFilter && centerId === 'all'
                      ? 'Select a centre first'
                      : undefined
                }
              >
                <SelectValue placeholder="All groups" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All groups</SelectItem>
                {groupsForGroupDropdown.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
            </>
          )}
        </div>

        <div className="rounded-xl border bg-white shadow-sm">
          <div className="border-b p-4">
            <h2 className="text-lg font-semibold">{pageTitle}</h2>
            <p className="text-sm text-muted-foreground">
              {fromStr} → {toStr}
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-green-600" />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto p-2 sm:p-3">
                <div className="inline-block min-w-full border border-slate-300 bg-slate-100/40 shadow-inner">
                  <Table className="w-full min-w-[640px] border-collapse text-sm">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        {columns.map((c) => (
                          <TableHead
                            key={c.key}
                            className={cn(
                              excelHead,
                              'whitespace-nowrap align-bottom',
                            )}
                          >
                            {c.label}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {slice.length === 0 ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell
                            colSpan={Math.max(1, columns.length)}
                            className={cn(
                              excelCell,
                              'text-center text-muted-foreground',
                            )}
                          >
                            No rows for the selected filters
                          </TableCell>
                        </TableRow>
                      ) : (
                        slice.map((row, i) => {
                          const globalI = (page - 1) * perPage + i;
                          const isOdd = globalI % 2 === 1;
                          return (
                            <TableRow
                              key={`r-${globalI}`}
                              className={cn(
                                isOdd ? excelRowOdd : excelRowEven,
                                'hover:bg-green-50/50',
                              )}
                            >
                              {columns.map((c) => (
                                <TableCell
                                  key={c.key}
                                  className={cn(
                                    excelCell,
                                    'whitespace-nowrap text-sm',
                                  )}
                                >
                                  {row[c.key] != null
                                    ? String(row[c.key])
                                    : '—'}
                                </TableCell>
                              ))}
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/80 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                  <span>
                    {rows.length === 0
                      ? '0 rows'
                      : `Row ${(page - 1) * perPage + 1}–${Math.min(
                          page * perPage,
                          rows.length,
                        )} of ${rows.length.toLocaleString()}`}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-wide">Rows / page</span>
                    <Select
                      value={String(perPage)}
                      onValueChange={(v) => setPerPageInUrl(parseInt(v, 10))}
                    >
                      <SelectTrigger className="h-8 w-[4.5rem]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PER_PAGE_OPTIONS.map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2"
                    disabled={page <= 1 || rows.length === 0}
                    onClick={() => setPageInUrl(1)}
                    title="First page"
                    aria-label="First page"
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2"
                    disabled={page <= 1 || rows.length === 0}
                    onClick={() => setPageInUrl(page - 1)}
                    title="Previous page"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="min-w-[7rem] px-2 text-center text-sm tabular-nums">
                    {rows.length === 0
                      ? '—'
                      : `Page ${page} / ${totalPages}`}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2"
                    disabled={page >= totalPages || rows.length === 0}
                    onClick={() => setPageInUrl(page + 1)}
                    title="Next page"
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2"
                    disabled={page >= totalPages || rows.length === 0}
                    onClick={() => setPageInUrl(totalPages)}
                    title="Last page"
                    aria-label="Last page"
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default DashboardMetricDrillDown;
