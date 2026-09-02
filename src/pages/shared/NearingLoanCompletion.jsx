import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format, parseISO, startOfMonth } from 'date-fns';
import { Calendar as CalendarIcon, ChevronLeft, Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { getManagerBranchId } from '@/lib/managerBranch';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  excelEmptyStateCellClassName,
  excelTableClassName,
  excelTableRowClassName,
  excelTableWrapperClassName,
  excelTdClassName,
  excelThClassName,
} from '@/lib/excelTable';
import {
  getLastInstallment,
  isDisbursalFilterForNearingReport,
  isFinalDueInWindow,
} from '@/lib/officerProgressMetrics';

const DAY_OPTIONS = [3, 7, 10, 14, 21, 30, 45, 60, 90];

function resolveBorrowerCenterId(b, groups) {
  if (!b) return null;
  if (b.center_id) return b.center_id;
  if (b.group_id) {
    return groups.find((g) => g.id === b.group_id)?.center_id ?? null;
  }
  return null;
}

const NearingLoanCompletion = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const role = user?.user_metadata?.role;
  const basePath = role ? getDashboardBasePath(role) : '/officer/dashboard';

  const fromStr =
    searchParams.get('from') || format(startOfMonth(new Date()), 'yyyy-MM-dd');
  const toStr = searchParams.get('to') || format(new Date(), 'yyyy-MM-dd');
  const daysRaw = searchParams.get('days');
  const windowDays = DAY_OPTIONS.includes(Number(daysRaw)) ? Number(daysRaw) : 14;
  const centerId = searchParams.get('center') || 'all';
  const groupId = searchParams.get('group') || 'all';
  const officerId = searchParams.get('officer') || 'all';

  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState('TZS');
  const [rows, setRows] = useState([]);
  const [centers, setCenters] = useState([]);
  const [groups, setGroups] = useState([]);
  const [branchOfficers, setBranchOfficers] = useState([]);
  const [daysOpen, setDaysOpen] = useState(false);

  const isManager = role === 'manager';
  const showOfficerFilter = isManager;

  const dateRange = useMemo(
    () => ({
      from: parseISO(fromStr),
      to: parseISO(toStr),
    }),
    [fromStr, toStr],
  );

  const setParam = (key, value) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value == null || value === 'all' || value === '') next.delete(key);
        else next.set(key, String(value));
        return next;
      },
      { replace: true },
    );
  };

  const setRange = (from, to) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (from) next.set('from', format(from, 'yyyy-MM-dd'));
        if (to) next.set('to', format(to, 'yyyy-MM-dd'));
        return next;
      },
      { replace: true },
    );
  };

  const centersForOfficer = useMemo(() => {
    if (!showOfficerFilter || officerId === 'all') return [];
    return centers.filter((c) => c.loan_officer_id === officerId);
  }, [centers, officerId, showOfficerFilter]);

  const groupsForCenter = useMemo(() => {
    if (showOfficerFilter) {
      if (officerId === 'all' || centerId === 'all') return [];
      return groups.filter(
        (g) => g.center_id === centerId && g.loan_officer_id === officerId,
      );
    }
    if (centerId === 'all') return groups;
    return groups.filter((g) => g.center_id === centerId);
  }, [showOfficerFilter, groups, centerId, officerId]);

  const fetchContext = useCallback(async () => {
    if (!user) return;
    const branchId = user.user_metadata?.branch_id ?? null;
    if (isManager && branchId) {
      const { data: off } = await supabase
        .from('users')
        .select('id, full_name')
        .eq('branch_id', branchId)
        .eq('role', 'officer')
        .order('full_name');
      const oids = (off || []).map((o) => o.id);
      const { data: c } = await supabase
        .from('centers')
        .select('id, name, loan_officer_id')
        .eq('branch_id', branchId)
        .order('name');
      let g = [];
      if (oids.length) {
        const { data: gr } = await supabase
          .from('groups')
          .select('id, name, center_id, loan_officer_id')
          .in('loan_officer_id', oids);
        g = gr || [];
      }
      setBranchOfficers(off || []);
      setCenters(c || []);
      setGroups(g);
      return;
    }
    const { data: c } = await supabase
      .from('centers')
      .select('id, name')
      .eq('loan_officer_id', user.id)
      .order('name');
    if (branchId) {
      // optional branch scoping
    }
    const { data: g } = await supabase
      .from('groups')
      .select('id, name, center_id')
      .eq('loan_officer_id', user.id);
    setBranchOfficers([]);
    setCenters(c || []);
    setGroups(g || []);
  }, [user, isManager]);

  const loadLoans = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: config } = await supabase
        .from('system_config')
        .select('value')
        .eq('key', 'currency')
        .single();
      if (config) setCurrency(config.value);

      let q = supabase
        .from('loans')
        .select(
          'id, loan_id, status, balance, schedule, disbursement_date, officer_id, borrowers!inner ( id, first_name, surname, group_id, center_id, groups ( name, center_id ) )',
        )
        .eq('status', 'active');

      if (role === 'officer') {
        q = q.eq('officer_id', user.id);
      } else if (isManager) {
        const branchId = await getManagerBranchId(user);
        if (!branchId) {
          setRows([]);
          return;
        }
        if (officerId !== 'all') {
          q = q.eq('officer_id', officerId);
        } else {
          const { data: offRows } = await supabase
            .from('users')
            .select('id')
            .eq('branch_id', branchId)
            .eq('role', 'officer');
          const oids = (offRows || []).map((o) => o.id);
          if (!oids.length) {
            setRows([]);
            return;
          }
          q = q.in('officer_id', oids);
        }
      }

      const { data: loans, error } = await q;
      if (error) throw error;

      const list = (loans || []).filter((loan) => {
        if (!isDisbursalFilterForNearingReport(loan, fromStr, toStr)) {
          return false;
        }
        const b = loan.borrowers;
        if (groupId !== 'all' && b?.group_id !== groupId) return false;
        if (isManager && officerId !== 'all' && loan.officer_id !== officerId) return false;
        const cId = resolveBorrowerCenterId(b, groups);
        if (centerId !== 'all' && cId !== centerId) return false;
        const last = getLastInstallment(loan.schedule);
        if (!last) return false;
        if (!isFinalDueInWindow(last, windowDays)) return false;
        return true;
      });

      const mapped = list
        .map((loan) => {
          const last = getLastInstallment(loan.schedule);
          const b = loan.borrowers;
          const dueStr = last?.dueDate ? String(last.dueDate) : '—';
          const cLookup =
            b?.center_id ||
            b?.groups?.center_id ||
            resolveBorrowerCenterId(b, groups);
          return {
            id: loan.id,
            loan_id: loan.loan_id,
            borrower: [b?.first_name, b?.surname].filter(Boolean).join(' ') || '—',
            final_due: dueStr.length <= 10 ? dueStr : format(parseISO(dueStr), 'yyyy-MM-dd'),
            final_amount: Number(last?.amount || 0),
            center: centers.find((c) => c.id === cLookup)?.name || '—',
            group: b?.groups?.name || '—',
            balance: Number(loan.balance || 0),
          };
        })
        .sort((a, b) => a.final_due.localeCompare(b.final_due));

      setRows(mapped);
    } catch (e) {
      console.error(e);
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [user, role, isManager, officerId, centerId, groupId, windowDays, fromStr, toStr, groups, centers, toast]);

  useEffect(() => {
    fetchContext();
  }, [fetchContext]);

  useEffect(() => {
    if (!user) return;
    loadLoans();
  }, [user, loadLoans]);

  useEffect(() => {
    if (role === 'manager' && officerId === 'all' && (centerId !== 'all' || groupId !== 'all')) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('center');
          next.delete('group');
          return next;
        },
        { replace: true },
      );
    }
  }, [role, officerId, centerId, groupId, setSearchParams]);

  const setOfficer = (v) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v && v !== 'all') next.set('officer', v);
        else next.delete('officer');
        next.delete('center');
        next.delete('group');
        return next;
      },
      { replace: true },
    );
  };

  const formatMoney = (n) =>
    `${currency} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (!user || (role !== 'officer' && role !== 'manager')) {
    return null;
  }

  return (
    <DashboardLayout
      title="Nearing loan completion (final payment within days)"
      description="Microfinance Management System"
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
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
                  type="button"
                  variant="outline"
                  className="w-full min-w-[240px] justify-start text-left font-normal md:w-[300px]"
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
                      setRange(r.from, r.to || r.from);
                    }
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Final payment within</p>
            <Popover open={daysOpen} onOpenChange={setDaysOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full min-w-[200px] justify-between border-amber-200/80 font-normal"
                  aria-expanded={daysOpen}
                >
                  {windowDays} days
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[240px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search days..." />
                  <CommandList>
                    <CommandEmpty>No days found.</CommandEmpty>
                    <CommandGroup>
                      {DAY_OPTIONS.map((d) => (
                        <CommandItem
                          key={d}
                          value={`${d}-days`}
                          onSelect={() => {
                            setParam('days', String(d));
                            setDaysOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              'mr-2 h-4 w-4',
                              windowDays === d ? 'opacity-100' : 'opacity-0',
                            )}
                          />
                          {d} days
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {showOfficerFilter && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Loan officer</p>
              <Select value={officerId} onValueChange={setOfficer}>
                <SelectTrigger className="w-full min-w-[200px] md:w-[220px]">
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

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Center</p>
            <Select
              value={centerId}
              onValueChange={(v) => {
                setSearchParams(
                  (prev) => {
                    const next = new URLSearchParams(prev);
                    if (v && v !== 'all') next.set('center', v);
                    else next.delete('center');
                    next.delete('group');
                    return next;
                  },
                  { replace: true },
                );
              }}
              disabled={showOfficerFilter && officerId === 'all'}
            >
              <SelectTrigger className="w-full min-w-[200px] disabled:opacity-60">
                <SelectValue
                  placeholder={
                    showOfficerFilter && officerId === 'all'
                      ? 'Select loan officer first'
                      : 'All centers'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All centers</SelectItem>
                {(showOfficerFilter ? centersForOfficer : centers).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Group</p>
            <Select
              value={groupId}
              onValueChange={(v) => setParam('group', v === 'all' ? null : v)}
              disabled={showOfficerFilter && (officerId === 'all' || centerId === 'all')}
            >
              <SelectTrigger className="w-full min-w-[200px] disabled:opacity-60">
                <SelectValue
                  placeholder={
                    showOfficerFilter && centerId === 'all' ? 'Select centre first' : 'All groups'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All groups</SelectItem>
                {groupsForCenter.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-xl border border-amber-100/80 bg-amber-50/40 shadow-sm">
          <div className="border-b border-amber-100/90 bg-white/60 px-4 py-3 sm:px-5">
            <h2 className="text-lg font-semibold text-foreground">
              Nearing loan completion (final payment within days)
            </h2>
            <p className="text-sm text-muted-foreground">
              {fromStr} → {toStr}
            </p>
            <p className="mt-2 text-sm text-foreground">
              Active loans whose <strong>last scheduled installment</strong> is due between today and
              the next <strong>{windowDays} days</strong>.
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="p-2 sm:p-3">
              <div className={excelTableWrapperClassName}>
                <Table className={excelTableClassName}>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className={excelThClassName('font-mono')}>Loan ID</TableHead>
                      <TableHead className={excelThClassName()}>Borrower</TableHead>
                      <TableHead className={excelThClassName()}>Final due</TableHead>
                      <TableHead className={excelThClassName('text-right')}>Final installment</TableHead>
                      <TableHead className={excelThClassName()}>Centre</TableHead>
                      <TableHead className={excelThClassName()}>Group</TableHead>
                      <TableHead className={excelThClassName('text-right')}>Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.length ? (
                      rows.map((r) => (
                        <TableRow key={r.id} className={excelTableRowClassName}>
                          <TableCell className={excelTdClassName('font-mono text-xs')}>
                            {r.loan_id}
                          </TableCell>
                          <TableCell className={excelTdClassName()}>{r.borrower}</TableCell>
                          <TableCell className={excelTdClassName('tabular-nums')}>
                            {r.final_due}
                          </TableCell>
                          <TableCell className={excelTdClassName('text-right tabular-nums')}>
                            {formatMoney(r.final_amount)}
                          </TableCell>
                          <TableCell className={excelTdClassName()}>{r.center}</TableCell>
                          <TableCell className={excelTdClassName()}>{r.group}</TableCell>
                          <TableCell className={excelTdClassName('text-right tabular-nums')}>
                            {formatMoney(r.balance)}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className={excelEmptyStateCellClassName}
                        >
                          No rows for this metric.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default NearingLoanCompletion;
