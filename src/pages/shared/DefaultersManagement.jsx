import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, TrendingDown, Scale, Trash2, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { toZonedTime, format as formatTZ } from 'date-fns-tz';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useDate } from '@/contexts/DateContext';

const EAT_TIMEZONE = 'Africa/Nairobi';
const DEFAULTERS_PAGE_SIZE = 10;

const BORROWER_ARRANGEMENT_SELECT =
    'id, first_name, surname, borrower_id, group_id, center_id, branch_id, phone_number, borrower_type';

const StatCard = ({ title, value, icon: Icon }) => (
    <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            <Icon className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
            <div className="text-2xl font-bold">{value}</div>
        </CardContent>
    </Card>
);

const DefaultersManagement = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [defaultedLoans, setDefaultedLoans] = useState([]);
    const [centers, setCenters] = useState([]);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [centerFilter, setCenterFilter] = useState('all');
    const [groupFilter, setGroupFilter] = useState('all');
    const [currentPage, setCurrentPage] = useState(1);
    const [selectedLoans, setSelectedLoans] = useState([]);
    const [currency, setCurrency] = useState('TZS');
    const { currentDate } = useDate();
    const [holidays, setHolidays] = useState([]);

    useEffect(() => {
        const fetchHolidays = async () => {
            const { data } = await supabase.from('holidays').select('date');
            if (data) {
                setHolidays(data.map(h => h.date));
            }
        };
        fetchHolidays();
    }, []);

    const isHoliday = (dateObj) => {
        const dateStr = formatTZ(toZonedTime(dateObj, EAT_TIMEZONE), 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE });
        return holidays.includes(dateStr);
    };

    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        setSelectedLoans([]);
        try {
            await supabase.rpc('update_all_loan_statuses');

            const { data: config } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
            if (config) setCurrency(config.value);

            const role = user.user_metadata.role;
            const { data: profileRow } = await supabase.from('users').select('branch_id').eq('id', user.id).maybeSingle();
            const branchId = profileRow?.branch_id ?? null;

            let centersQuery = supabase
                .from('centers')
                .select('id, name, branch_id, loan_officer_id')
                .order('name');
            if (role === 'officer') {
                centersQuery = centersQuery.eq('loan_officer_id', user.id);
                if (branchId) {
                    centersQuery = centersQuery.eq('branch_id', branchId);
                }
            } else if (role === 'manager') {
                centersQuery = centersQuery.eq('branch_id', user.user_metadata.branch_id);
            }

            const { data: centersData, error: centersError } = await centersQuery;
            if (centersError) throw centersError;
            setCenters(centersData || []);

            let groupsData = [];
            if (role === 'officer') {
                const { data, error: gErr } = await supabase
                    .from('groups')
                    .select('*')
                    .eq('loan_officer_id', user.id);
                if (gErr) throw gErr;
                groupsData = data || [];
            } else if (role === 'manager') {
                const cids = (centersData || []).map((c) => c.id);
                if (cids.length) {
                    const { data, error: gErr } = await supabase
                        .from('groups')
                        .select('*')
                        .in('center_id', cids);
                    if (gErr) throw gErr;
                    groupsData = data || [];
                }
            } else {
                const { data, error: gErr } = await supabase.from('groups').select('*');
                if (gErr) throw gErr;
                groupsData = data || [];
            }
            setGroups(groupsData);

            let query = supabase
                .from('loans')
                .select(
                    `id, loan_id, principal, balance, schedule, borrowers!inner(${BORROWER_ARRANGEMENT_SELECT})`,
                )
                .eq('status', 'defaulted');

            if (user.user_metadata.role === 'officer') {
                query = query.eq('officer_id', user.id);
            } else if (user.user_metadata.role === 'manager') {
                const { data: officers, error: officersError } = await supabase
                    .from('users')
                    .select('id')
                    .eq('branch_id', user.user_metadata.branch_id);
                if (officersError) throw officersError;
                query = query.in('officer_id', officers.map((o) => o.id));
            }

            const { data: loansData, error } = await query;
            if (error) throw error;
            
            const today = toZonedTime(new Date(), EAT_TIMEZONE);
            const loansWithDetails = loansData.map(loan => {
                const lastDueDate = loan.schedule ? toZonedTime(new Date(loan.schedule[loan.schedule.length - 1].dueDate), EAT_TIMEZONE) : null;
                const daysOverdue = lastDueDate ? differenceInDays(today, lastDueDate) : 0;
                return { ...loan, daysOverdue: Math.max(0, daysOverdue) };
            });

            setDefaultedLoans(loansWithDetails);
        } catch (error) {
            toast({ title: 'Error fetching defaulters', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [user, toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleWriteOff = async (loanIds) => {
        if (isHoliday(currentDate)) {
            toast({ title: 'Action Restricted', description: 'Cannot write off loans on a public holiday.', variant: 'destructive' });
            return;
        }

        setProcessing(true);
        try {
            const updates = loanIds.map(id => supabase.rpc('update_loan_status', { p_loan_id: id, p_new_status: 'written_off' }));
            const results = await Promise.all(updates);

            results.forEach((result, index) => {
                if (result.error) {
                    throw new Error(`Failed to write off loan ${loanIds[index]}: ${result.error.message}`);
                }
            });

            toast({ title: 'Success', description: `${loanIds.length} loan(s) have been written off.` });
            fetchData();
        } catch (error) {
            toast({ title: 'Write-off Failed', description: error.message, variant: 'destructive' });
        } finally {
            setProcessing(false);
        }
    };
    
    const handleSelectLoan = (loanId) => {
        setSelectedLoans(prev => prev.includes(loanId) ? prev.filter(id => id !== loanId) : [...prev, loanId]);
    };

    const resolveBorrowerCenterId = useCallback(
        (b) => {
            if (!b) return null;
            if (b.center_id) return b.center_id;
            if (b.group_id) {
                return groups.find((g) => g.id === b.group_id)?.center_id ?? null;
            }
            return null;
        },
        [groups],
    );

    const groupsForTableFilter = useMemo(() => {
        if (centerFilter === 'all') return groups;
        return groups.filter((g) => g.center_id === centerFilter);
    }, [groups, centerFilter]);

    const groupsInSelectedCenterFilter = useMemo(() => {
        if (centerFilter === 'all') return [];
        return groups.filter((g) => g.center_id === centerFilter);
    }, [groups, centerFilter]);

    useEffect(() => {
        if (centerFilter === 'all') {
            setGroupFilter('all');
        }
    }, [centerFilter]);

    useEffect(() => {
        if (groupFilter !== 'all' && !groupsForTableFilter.some((g) => g.id === groupFilter)) {
            setGroupFilter('all');
        }
    }, [centerFilter, groupFilter, groupsForTableFilter]);

    const filteredLoans = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return defaultedLoans
            .filter((loan) => {
                const b = loan.borrowers;
                const centerId = b ? resolveBorrowerCenterId(b) : null;
                const matchesCenter = centerFilter === 'all' || centerId === centerFilter;
                const matchesGroup = groupFilter === 'all' || b?.group_id === groupFilter;
                if (!matchesCenter || !matchesGroup) {
                    return false;
                }
                if (!q) {
                    return true;
                }
                return (
                    (loan.loan_id && loan.loan_id.toLowerCase().includes(q)) ||
                    `${b?.first_name || ''} ${b?.surname || ''}`.toLowerCase().includes(q) ||
                    (b?.first_name && b.first_name.toLowerCase().includes(q)) ||
                    (b?.surname && b.surname.toLowerCase().includes(q)) ||
                    (b?.borrower_id && String(b.borrower_id).toLowerCase().includes(q)) ||
                    (b?.phone_number && String(b.phone_number).toLowerCase().includes(q)) ||
                    (loan.balance != null && String(loan.balance).includes(q)) ||
                    (loan.principal != null && String(loan.principal).includes(q))
                );
            })
            .sort((a, b) => b.daysOverdue - a.daysOverdue);
    }, [defaultedLoans, searchQuery, centerFilter, groupFilter, resolveBorrowerCenterId]);

    const totalPages = Math.max(1, Math.ceil(filteredLoans.length / DEFAULTERS_PAGE_SIZE) || 1);

    const paginatedLoans = useMemo(() => {
        const start = (currentPage - 1) * DEFAULTERS_PAGE_SIZE;
        return filteredLoans.slice(start, start + DEFAULTERS_PAGE_SIZE);
    }, [filteredLoans, currentPage]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, centerFilter, groupFilter]);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const allOnPageSelected =
        paginatedLoans.length > 0 &&
        paginatedLoans.every((l) => selectedLoans.includes(l.id));

    const handleSelectAllPage = (checked) => {
        const pageIds = paginatedLoans.map((l) => l.id);
        if (checked) {
            setSelectedLoans((prev) => [...new Set([...prev, ...pageIds])]);
        } else {
            setSelectedLoans((prev) => prev.filter((id) => !pageIds.includes(id)));
        }
    };

    const stats = useMemo(() => {
        const totalDefaultedAmount = filteredLoans.reduce((sum, loan) => sum + (loan.balance || 0), 0);
        return {
            count: filteredLoans.length,
            totalDefaultedAmount,
        };
    }, [filteredLoans]);

    const selectedOutstandingTotal = useMemo(
        () =>
            defaultedLoans
                .filter((l) => selectedLoans.includes(l.id))
                .reduce((sum, l) => sum + (l.balance || 0), 0),
        [defaultedLoans, selectedLoans],
    );

    if (loading) return <DashboardLayout><div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div></DashboardLayout>;

    return (
        <DashboardLayout title="Defaulted Loans Management">
            <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
                    <StatCard title="Total Defaulted Loans" value={stats.count} icon={TrendingDown} />
                    <StatCard title="Total Outstanding Balance" value={`${currency} ${stats.totalDefaultedAmount.toLocaleString()}`} icon={Scale} />
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-4">
                            <div>
                                <CardTitle>Defaulted Loans</CardTitle>
                                <CardDescription>List of all loans with a &apos;defaulted&apos; status.</CardDescription>
                            </div>
                            <div className="flex w-full flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-end">
                                <div className="min-w-0 flex-1 lg:min-w-[12rem]">
                                    <div className="relative">
                                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            placeholder="Search loan ID, name, phone, amount…"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="w-full pl-8"
                                        />
                                    </div>
                                </div>
                                <Select value={centerFilter} onValueChange={setCenterFilter}>
                                    <SelectTrigger className="w-full min-w-0 sm:min-w-[10rem] lg:w-[12rem]">
                                        <SelectValue placeholder="Centre" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All centres</SelectItem>
                                        {centers.map((c) => (
                                            <SelectItem key={c.id} value={c.id}>
                                                {c.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Select
                                    value={groupFilter}
                                    onValueChange={setGroupFilter}
                                    disabled={centerFilter === 'all'}
                                >
                                    <SelectTrigger
                                        className="w-full min-w-0 sm:min-w-[10rem] lg:w-[12rem] disabled:cursor-not-allowed disabled:opacity-60"
                                        title={
                                            centerFilter === 'all'
                                                ? 'Select a centre first to filter by group'
                                                : undefined
                                        }
                                    >
                                        <SelectValue
                                            placeholder={
                                                centerFilter === 'all' ? 'Select centre first' : 'Group'
                                            }
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All groups</SelectItem>
                                        {groupsInSelectedCenterFilter.map((g) => (
                                            <SelectItem key={g.id} value={g.id}>
                                                {g.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {selectedLoans.length > 0 && (
                            <div className="mb-4 flex flex-col justify-between gap-3 rounded-lg border border-slate-200 bg-secondary/60 p-4 sm:flex-row sm:items-center dark:border-slate-700">
                                <div>
                                    <p className="font-bold">{selectedLoans.length} loan(s) selected</p>
                                    <p className="text-sm text-muted-foreground">
                                        Total selected outstanding: {currency}{' '}
                                        {selectedOutstandingTotal.toLocaleString(undefined, {
                                            minimumFractionDigits: 0,
                                            maximumFractionDigits: 0,
                                        })}
                                    </p>
                                </div>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="destructive" disabled={processing}>
                                            {processing ? (
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            ) : (
                                                <Trash2 className="mr-2 h-4 w-4" />
                                            )}
                                            Write off selected
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Confirm bulk write-off</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This will permanently write off {selectedLoans.length} selected
                                                loans (total outstanding {currency}{' '}
                                                {selectedOutstandingTotal.toLocaleString()}). This action cannot
                                                be undone. Are you sure?
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction
                                                className="bg-destructive hover:bg-destructive/90"
                                                onClick={() => handleWriteOff(selectedLoans)}
                                            >
                                                Yes, write off
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        )}
                        <div className="overflow-x-auto rounded-md border border-slate-300 bg-white shadow-sm dark:border-slate-600 dark:bg-card">
                            <Table className="border-collapse border-0 text-sm">
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="w-10 min-w-8 border border-slate-300 bg-slate-100 px-1 py-2 dark:border-slate-600 dark:bg-slate-800/90">
                                            <Checkbox
                                                checked={allOnPageSelected}
                                                onCheckedChange={handleSelectAllPage}
                                                disabled={paginatedLoans.length === 0}
                                                aria-label="Select all on this page"
                                            />
                                        </TableHead>
                                        <TableHead className="min-w-[7rem] border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Borrower
                                        </TableHead>
                                        <TableHead className="font-mono border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Loan ID
                                        </TableHead>
                                        <TableHead className="border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Outstanding
                                        </TableHead>
                                        <TableHead className="border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Days overdue
                                        </TableHead>
                                        <TableHead className="min-w-[8rem] border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Action
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {paginatedLoans.length > 0 ? (
                                        paginatedLoans.map((loan) => (
                                            <TableRow
                                                key={loan.id}
                                                className="border-slate-200 data-[state=selected]:bg-slate-50 dark:border-slate-700 dark:data-[state=selected]:bg-slate-800/50"
                                                data-state={selectedLoans.includes(loan.id) && 'selected'}
                                            >
                                                <TableCell className="border border-slate-300 px-1 py-1.5 dark:border-slate-600">
                                                    <Checkbox
                                                        checked={selectedLoans.includes(loan.id)}
                                                        onCheckedChange={() => handleSelectLoan(loan.id)}
                                                        aria-label={`Select loan ${loan.loan_id}`}
                                                    />
                                                </TableCell>
                                                <TableCell className="border border-slate-300 dark:border-slate-600">
                                                    {loan.borrowers?.first_name} {loan.borrowers?.surname}
                                                </TableCell>
                                                <TableCell className="border border-slate-300 font-mono text-xs dark:border-slate-600">
                                                    {loan.loan_id}
                                                </TableCell>
                                                <TableCell className="border border-slate-300 font-semibold tabular-nums text-red-600 dark:border-slate-600">
                                                    {currency} {(loan.balance ?? 0).toLocaleString()}
                                                </TableCell>
                                                <TableCell className="border border-slate-300 dark:border-slate-600">
                                                    <Badge variant="destructive">{loan.daysOverdue} days</Badge>
                                                </TableCell>
                                                <TableCell className="border border-slate-300 p-1.5 dark:border-slate-600">
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                className="h-8 rounded-md"
                                                                disabled={processing || selectedLoans.length > 0}
                                                            >
                                                                <Trash2 className="mr-2 h-4 w-4" />
                                                                Write off
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>Confirm write-off</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    Are you sure you want to write off loan {loan.loan_id}?
                                                                    This cannot be undone.
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                <AlertDialogAction
                                                                    className="bg-destructive hover:bg-destructive/90"
                                                                    onClick={() => handleWriteOff([loan.id])}
                                                                >
                                                                    Yes, write off
                                                                </AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell
                                                colSpan={6}
                                                className="border border-slate-300 py-10 text-center text-muted-foreground dark:border-slate-600"
                                            >
                                                {defaultedLoans.length === 0
                                                    ? 'No defaulted loans.'
                                                    : 'No loans match the current filters.'}
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                        <div className="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-sm text-muted-foreground">
                                {filteredLoans.length === 0
                                    ? 'Showing 0 of 0'
                                    : (() => {
                                          const from = (currentPage - 1) * DEFAULTERS_PAGE_SIZE + 1;
                                          const to = Math.min(
                                              currentPage * DEFAULTERS_PAGE_SIZE,
                                              filteredLoans.length,
                                          );
                                          return `Showing ${from}–${to} of ${filteredLoans.length}`;
                                      })()}
                            </p>
                            <div className="flex items-center justify-end gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                    disabled={currentPage <= 1}
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
                                    disabled={currentPage >= totalPages}
                                    aria-label="Next page"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </DashboardLayout>
    );
};

export default DefaultersManagement;