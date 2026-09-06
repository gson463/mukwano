import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { format, isAfter, endOfToday } from 'date-fns';
import { format as formatTZ, toZonedTime } from 'date-fns-tz';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar as CalendarIcon, Loader2, FileDown, Eye, ArrowRightLeft, TrendingUp, TrendingDown, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { getDisabledDates } from '@/utils/holidayUtils';
import {
  excelEmptyStateCellClassName,
  excelTableClassName,
  excelTableRowClassName,
  excelTableWrapperClassName,
  excelTdClassName,
  excelThClassName,
} from '@/lib/excelTable';
import { DEFAULT_TABLE_PAGE_SIZE, getTotalPages, slicePage } from '@/lib/tablePagination';
import { TablePaginationBar } from '@/components/table/TablePaginationBar';
import { adminCentersForSelect, adminGroupsForSelect, resolveBorrowerCenterId } from '@/lib/adminHierarchyFilters';
import { getEatTodayDate, isEatTodayRange, formatDateFilterYmd } from '@/utils/dateValidation';

const EAT_TIMEZONE = 'Africa/Nairobi';

/** List view only — no `schedule` JSON (was bloating the query and causing statement timeouts). */
const REPAYMENT_ADMIN_SELECT = [
  'id',
  'amount',
  'interest_paid',
  'principal_paid',
  'actual_payment_date',
  'officer_id',
  'loan_id',
  'loans (id, borrower_id, loan_id, borrowers (id, first_name, surname, group_id, branch_id, center_id, borrower_id, groups (id, name, center_id)))',
].join(',');

const FETCH_HARD_LIMIT = 25000;

const StatCard = ({ title, value, icon: Icon, color }) => (
    <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            <Icon className={`h-4 w-4 text-muted-foreground ${color}`} />
        </CardHeader>
        <CardContent>
            <div className="text-2xl font-bold">{value}</div>
        </CardContent>
    </Card>
);

const AdminRepaymentManagement = () => {
    const { toast } = useToast();
    const [repayments, setRepayments] = useState([]);
    const [branches, setBranches] = useState([]);
    const [centers, setCenters] = useState([]);
    const [users, setUsers] = useState([]);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currency, setCurrency] = useState('TZS');

    // Filters
    const [branchFilter, setBranchFilter] = useState('all');
    const [officerFilter, setOfficerFilter] = useState('all');
    const [centerFilter, setCenterFilter] = useState('all');
    const [groupFilter, setGroupFilter] = useState('all');
    const [dateRangeFilter, setDateRangeFilter] = useState(() => {
        const today = getEatTodayDate();
        return { from: today, to: today };
    });
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);

    const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
    const [selectedLoanForSchedule, setSelectedLoanForSchedule] = useState(null);

    const resetFilters = () => {
        setBranchFilter('all');
        setOfficerFilter('all');
        setCenterFilter('all');
        setGroupFilter('all');
        setDateRangeFilter({ from: getEatTodayDate(), to: getEatTodayDate() });
        setSearchQuery('');
        setCurrentPage(1);
    };

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const { data: config } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
            if (config) setCurrency(config.value);

            const { data: branchesData, error: branchesError } = await supabase.from('branches').select('id, name');
            if (branchesError) throw branchesError;
            setBranches(branchesData || []);

            const { data: usersData, error: usersError } = await supabase.from('users').select('id, full_name, branch_id, role');
            if (usersError) throw usersError;
            setUsers(usersData || []);

            const { data: groupsData, error: groupsError } = await supabase.from('groups').select('id, name, center_id, loan_officer_id');
            if (groupsError) throw groupsError;
            setGroups(groupsData || []);

            const { data: centersData, error: centersError } = await supabase
                .from('centers')
                .select('id, name, branch_id');
            if (centersError) throw centersError;
            setCenters(centersData || []);

            let rq = supabase
                .from('repayments')
                .select(REPAYMENT_ADMIN_SELECT)
                .order('actual_payment_date', { ascending: false })
                .limit(FETCH_HARD_LIMIT);

            if (dateRangeFilter?.from) {
                const fromYmd = formatDateFilterYmd(dateRangeFilter.from);
                rq = rq.gte('actual_payment_date', fromYmd);
                if (dateRangeFilter.to) {
                    rq = rq.lte('actual_payment_date', formatDateFilterYmd(dateRangeFilter.to));
                } else {
                    rq = rq.lte('actual_payment_date', fromYmd);
                }
            } else {
                const todayYmd = formatDateFilterYmd(getEatTodayDate());
                rq = rq.gte('actual_payment_date', todayYmd).lte('actual_payment_date', todayYmd);
            }

            const { data: repaymentsData, error: repaymentsError } = await rq;
            if (repaymentsError) throw repaymentsError;
            const rows = repaymentsData || [];
            setRepayments(rows);
            if (rows.length >= FETCH_HARD_LIMIT) {
                toast({
                    title: 'Large result set',
                    description: `Showing the ${FETCH_HARD_LIMIT.toLocaleString()} most recent repayments in this date range. Narrow the dates to load fewer rows.`,
                });
            }
        } catch (error) {
            toast({ title: 'Error fetching data', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [toast, dateRangeFilter]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const filteredOfficers = useMemo(() => {
        if (branchFilter === 'all') return users.filter(u => u.role !== 'admin');
        return users.filter(u => u.branch_id === branchFilter && u.role !== 'admin');
    }, [users, branchFilter]);

    const centersInSelect = useMemo(
        () => adminCentersForSelect(centers, branchFilter),
        [centers, branchFilter],
    );

    const groupsInSelect = useMemo(
        () => adminGroupsForSelect(groups, centers, branchFilter, centerFilter),
        [groups, centers, branchFilter, centerFilter],
    );

    useEffect(() => {
        setCenterFilter('all');
        setGroupFilter('all');
    }, [branchFilter]);

    useEffect(() => {
        if (centerFilter === 'all') {
            setGroupFilter('all');
        }
    }, [centerFilter]);

    useEffect(() => {
        if (groupFilter !== 'all' && !groupsInSelect.some((g) => g.id === groupFilter)) {
            setGroupFilter('all');
        }
    }, [centerFilter, groupFilter, groupsInSelect]);

    const filteredRepayments = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return repayments.filter((r) => {
            const officer = users.find((u) => u.id === r.officer_id);
            const branch = branches.find((b) => b.id === officer?.branch_id);
            const b = r.loans?.borrowers;
            const centerId = b ? resolveBorrowerCenterId(b, groups) : null;
            const branchMatch = branchFilter === 'all' || officer?.branch_id === branchFilter;
            const officerMatch = officerFilter === 'all' || r.officer_id === officerFilter;
            const centerMatch = centerFilter === 'all' || centerId === centerFilter;
            const groupMatch = groupFilter === 'all' || b?.group_id === groupFilter;

            let textMatch = true;
            if (q) {
                const borrower = r.loans?.borrowers
                    ? `${r.loans.borrowers.first_name} ${r.loans.borrowers.surname}`.toLowerCase()
                    : '';
                const loanId = (r.loans?.loan_id || '').toString().toLowerCase();
                const groupName = (r.loans?.borrowers?.groups?.name || '').toLowerCase();
                const branchName = (branch?.name || '').toLowerCase();
                const offName = (officer?.full_name || '').toLowerCase();
                textMatch =
                    borrower.includes(q) ||
                    loanId.includes(q) ||
                    groupName.includes(q) ||
                    branchName.includes(q) ||
                    offName.includes(q) ||
                    String(r.amount).includes(q);
            }

            return branchMatch && officerMatch && centerMatch && groupMatch && textMatch;
        });
    }, [repayments, users, groups, branches, branchFilter, officerFilter, centerFilter, groupFilter, searchQuery]);

    const stats = useMemo(() => {
        const totalPaid = filteredRepayments.reduce((sum, r) => sum + r.amount, 0);
        const totalInterest = filteredRepayments.reduce((sum, r) => sum + (r.interest_paid || 0), 0);
        const totalPrincipalPaid = filteredRepayments.reduce((sum, r) => sum + (r.principal_paid || 0), 0);
        return { totalPaid, totalInterest, totalPrincipalPaid };
    }, [filteredRepayments]);

    const totalPages = useMemo(
        () => getTotalPages(filteredRepayments.length, DEFAULT_TABLE_PAGE_SIZE),
        [filteredRepayments.length],
    );

    const paginatedRepayments = useMemo(
        () => slicePage(filteredRepayments, currentPage, DEFAULT_TABLE_PAGE_SIZE),
        [filteredRepayments, currentPage],
    );

    useEffect(() => {
        setCurrentPage(1);
    }, [branchFilter, officerFilter, centerFilter, groupFilter, dateRangeFilter, searchQuery]);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const handleViewSchedule = async (loan) => {
        const { data: latestLoanData, error } = await supabase.from('loans').select(`*, borrowers (id, first_name, surname)`).eq('id', loan.id).single();
        if (error) {
             toast({ title: 'Error', description: 'Could not fetch latest schedule.', variant: 'destructive' });
             return;
        }
        setSelectedLoanForSchedule(latestLoanData);
        setScheduleDialogOpen(true);
    };
    
    const handleDateRangeSelect = (range) => {
        setDateRangeFilter(range);
    }

    const handleExport = () => {
        const dataToExport = filteredRepayments.map(r => {
            const officer = users.find(u => u.id === r.officer_id);
            const branch = branches.find(b => b.id === officer?.branch_id);
            return {
                'Payment Date': formatTZ(toZonedTime(new Date(r.actual_payment_date), EAT_TIMEZONE), 'yyyy-MM-dd'),
                'Borrower': `${r.loans?.borrowers?.first_name} ${r.loans?.borrowers?.surname}`,
                'Loan ID': r.loans?.loan_id,
                'Branch': branch?.name || 'N/A',
                'Group': r.loans?.borrowers?.groups?.name || 'N/A',
                'Loan Officer': officer?.full_name || 'N/A',
                'Principal Paid': r.principal_paid || 0,
                'Interest Paid': r.interest_paid || 0,
                'Total Paid': r.amount,
            };
        });
        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Repayments');
        XLSX.writeFile(wb, 'repayment_history_full.xlsx');
    };

    if (loading) return <DashboardLayout><Loader2 className="h-8 w-8 animate-spin mx-auto mt-8" /></DashboardLayout>;

    return (
        <DashboardLayout title="Repayment Management">
            <div className="space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Repayment Overview</CardTitle>
                        <CardDescription>System-wide summary of repayments based on selected filters.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            <StatCard title="Total Repayments (Filtered)" value={`${currency} ${stats.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={ArrowRightLeft} color="text-primary" />
                            <StatCard title="Interest Collected" value={`${currency} ${stats.totalInterest.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={TrendingUp} color="text-green-500" />
                            <StatCard title="Principal Repaid" value={`${currency} ${stats.totalPrincipalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={TrendingDown} color="text-orange-500" />
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Filters</CardTitle>
                        <CardDescription>
                            Defaults to today (EAT). Change the date range to load history (up to{' '}
                            {FETCH_HARD_LIMIT.toLocaleString()} rows).
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap items-center gap-4">
                        <Input
                            placeholder="Search: borrower, loan ID, branch, group, officer…"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="min-w-[220px] max-w-md"
                        />
                        <Select value={branchFilter} onValueChange={value => { setBranchFilter(value); setOfficerFilter('all'); }}>
                            <SelectTrigger className="w-[240px]">
                                <SelectValue placeholder="Filter by Branch..." />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Branches</SelectItem>
                                {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Select value={centerFilter} onValueChange={setCenterFilter}>
                            <SelectTrigger className="w-[240px]">
                                <SelectValue placeholder="Center" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Centers</SelectItem>
                                {centersInSelect.map((c) => (
                                    <SelectItem key={c.id} value={c.id}>
                                        {c.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select value={officerFilter} onValueChange={setOfficerFilter}>
                            <SelectTrigger className="w-[240px]">
                                <SelectValue placeholder="Filter by User..." />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Users</SelectItem>
                                {filteredOfficers.map(o => <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Select value={groupFilter} onValueChange={setGroupFilter}>
                            <SelectTrigger className="w-[240px]">
                                <SelectValue placeholder="Group" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Groups</SelectItem>
                                {groupsInSelect.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" className="w-[280px] justify-start text-left font-normal border-gray-200">
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {dateRangeFilter?.from ? (
                                        dateRangeFilter.to ? (
                                            isEatTodayRange(dateRangeFilter.from, dateRangeFilter.to) ? (
                                                'Today'
                                            ) : (
                                                `${format(dateRangeFilter.from, 'LLL dd, y')} - ${format(dateRangeFilter.to, 'LLL dd, y')}`
                                            )
                                        ) : (
                                            format(dateRangeFilter.from, 'LLL dd, y')
                                        )
                                    ) : (
                                        <span>Pick a date range</span>
                                    )}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                    mode="range"
                                    selected={dateRangeFilter}
                                    onSelect={handleDateRangeSelect}
                                    numberOfMonths={2}
                                    disabled={[...getDisabledDates(), (date) => isAfter(date, endOfToday())]}
                                />
                            </PopoverContent>
                        </Popover>
                        <Button onClick={resetFilters} variant="ghost">
                            <X className="mr-2 h-4 w-4" /> Reset to today
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle>Repayment History</CardTitle>
                        <Button onClick={handleExport}><FileDown className="mr-2 h-4 w-4" /> Export</Button>
                    </CardHeader>
                    <CardContent>
                        <div className={excelTableWrapperClassName}>
                        <Table className={excelTableClassName}>
                            <TableHeader>
                                <TableRow className={excelTableRowClassName}>
                                    <TableHead className={excelThClassName()}>Payment Date</TableHead>
                                    <TableHead className={excelThClassName()}>Borrower</TableHead>
                                    <TableHead className={excelThClassName()}>Group</TableHead>
                                    <TableHead className={excelThClassName()}>Branch</TableHead>
                                    <TableHead className={excelThClassName()}>Loan Officer</TableHead>
                                    <TableHead className={excelThClassName()}>Principal Paid</TableHead>
                                    <TableHead className={excelThClassName()}>Interest Paid</TableHead>
                                    <TableHead className={excelThClassName()}>Total Paid</TableHead>
                                    <TableHead className={excelThClassName()}>Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {repayments.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className={excelEmptyStateCellClassName}>
                                            No repayments in the system yet.
                                        </TableCell>
                                    </TableRow>
                                ) : filteredRepayments.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className={excelEmptyStateCellClassName}>
                                            No repayments match the filters.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                paginatedRepayments.map((r) => {
                                    const officer = users.find(u => u.id === r.officer_id);
                                    const branch = branches.find(b => b.id === officer?.branch_id);
                                    return (
                                    <TableRow key={r.id} className={excelTableRowClassName}>
                                        <TableCell className={excelTdClassName()}>{formatTZ(toZonedTime(new Date(r.actual_payment_date), EAT_TIMEZONE), 'MMM dd, yyyy')}</TableCell>
                                        <TableCell className={excelTdClassName()}>{r.loans?.borrowers?.first_name} {r.loans?.borrowers?.surname}</TableCell>
                                        <TableCell className={excelTdClassName()}>{r.loans?.borrowers?.groups?.name || 'N/A'}</TableCell>
                                        <TableCell className={excelTdClassName()}>{branch?.name || 'N/A'}</TableCell>
                                        <TableCell className={excelTdClassName()}>{officer?.full_name || 'N/A'}</TableCell>
                                        <TableCell className={excelTdClassName()}>{currency} {(r.principal_paid || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                        <TableCell className={excelTdClassName()}>{currency} {(r.interest_paid || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                        <TableCell className={excelTdClassName('font-semibold')}>{currency} {r.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                        <TableCell className={excelTdClassName()}>
                                            <Button variant="ghost" size="icon" onClick={() => handleViewSchedule(r.loans)}><Eye className="h-4 w-4" /></Button>
                                        </TableCell>
                                    </TableRow>
                                    );
                                })
                                )}
                            </TableBody>
                            {filteredRepayments.length > 0 && (
                            <TableFooter>
                                <TableRow className={excelTableRowClassName}>
                                    <TableCell colSpan={5} className={excelTdClassName('font-bold text-right')}>Totals</TableCell>
                                    <TableCell className={excelTdClassName('font-bold')}>{currency} {stats.totalPrincipalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                    <TableCell className={excelTdClassName('font-bold')}>{currency} {stats.totalInterest.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                    <TableCell className={excelTdClassName('font-bold')} colSpan={2}>{currency} {stats.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                </TableRow>
                            </TableFooter>
                            )}
                        </Table>
                        </div>
                        <TablePaginationBar
                            currentPage={currentPage}
                            setCurrentPage={setCurrentPage}
                            totalCount={filteredRepayments.length}
                            pageSize={DEFAULT_TABLE_PAGE_SIZE}
                        />
                    </CardContent>
                </Card>
            </div>
            
            <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
              <DialogContent className="max-w-4xl">
                <DialogHeader>
                    <DialogTitle>Repayment Schedule for {selectedLoanForSchedule?.loan_id}</DialogTitle>
                    <DialogDescription>
                        Borrower: {selectedLoanForSchedule?.borrowers?.first_name} {selectedLoanForSchedule?.borrowers?.surname} <br/>
                        Total Payable: {currency} {(selectedLoanForSchedule?.total_payable || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </DialogDescription>
                </DialogHeader>
                {selectedLoanForSchedule && (
                    <div className="max-h-[60vh] overflow-y-auto">
                        <div className={excelTableWrapperClassName}>
                        <Table className={excelTableClassName}>
                            <TableHeader>
                                <TableRow className={excelTableRowClassName}>
                                    <TableHead className={excelThClassName()}>#</TableHead>
                                    <TableHead className={excelThClassName()}>Due Date</TableHead>
                                    <TableHead className={excelThClassName()}>Amount Due</TableHead>
                                    <TableHead className={excelThClassName()}>Principal Paid</TableHead>
                                    <TableHead className={excelThClassName()}>Interest Paid</TableHead>
                                    <TableHead className={excelThClassName()}>Total Paid</TableHead>
                                    <TableHead className={excelThClassName()}>Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {selectedLoanForSchedule.schedule.map(inst => (
                                    <TableRow key={inst.installmentNumber} className={excelTableRowClassName}>
                                        <TableCell className={excelTdClassName()}>{inst.installmentNumber}</TableCell>
                                        <TableCell className={excelTdClassName()}>{formatTZ(toZonedTime(new Date(inst.dueDate), EAT_TIMEZONE), 'MMM dd, yyyy')}</TableCell>
                                        <TableCell className={excelTdClassName()}>{currency} {inst.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                        <TableCell className={excelTdClassName()}>{currency} {(inst.principalPaid || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                        <TableCell className={excelTdClassName()}>{currency} {(inst.interestPaid || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                        <TableCell className={excelTdClassName()}>{currency} {(inst.paidAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                        <TableCell className={excelTdClassName()}><Badge variant={inst.status === 'paid' ? 'success' : inst.status === 'arrears' ? 'warning' : 'secondary'}>{inst.status}</Badge></TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        </div>
                    </div>
                )}
              </DialogContent>
            </Dialog>
        </DashboardLayout>
    );
};

export default AdminRepaymentManagement;