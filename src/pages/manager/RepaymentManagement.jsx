import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { format, startOfToday, isToday, isAfter, endOfToday } from 'date-fns';
import { format as formatTZ, toZonedTime } from 'date-fns-tz';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    Calendar as CalendarIcon,
    Loader2,
    FileDown,
    Eye,
    ArrowRightLeft,
    TrendingUp,
    TrendingDown,
    X,
    Search,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { getDisabledDates } from '@/utils/holidayUtils';
import { statCardIconWellClass } from '@/lib/utils';
import {
    excelEmptyStateCellClassName,
    excelTableClassName,
    excelTableRowClassName,
    excelTableWrapperClassName,
    excelTdClassName,
    excelThClassName,
} from '@/lib/excelTable';

const EAT_TIMEZONE = 'Africa/Nairobi';
const REPAYMENT_PAGE_SIZE = 10;

const StatCard = ({ title, value, icon: Icon, color }) => (
    <Card className="overflow-hidden border-none shadow-md hover:shadow-lg transition-all duration-300">
        <CardHeader className="flex flex-row items-center justify-between pb-2 bg-gradient-to-r from-gray-50 to-white">
            <CardTitle className="text-sm font-semibold text-gray-600 uppercase tracking-wider">{title}</CardTitle>
            <div className={`p-2 rounded-full ${statCardIconWellClass(color)}`}>
                <Icon className={`h-5 w-5 ${color}`} />
            </div>
        </CardHeader>
        <CardContent className="pt-4 bg-white">
            <div className="text-2xl font-extrabold text-gray-800">{value}</div>
        </CardContent>
    </Card>
);

const ManagerRepaymentManagement = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [repayments, setRepayments] = useState([]);
    const [branchOfficers, setBranchOfficers] = useState([]);
    const [groups, setGroups] = useState([]);
    const [centers, setCenters] = useState([]);
    const [loanProducts, setLoanProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [repaymentsLoading, setRepaymentsLoading] = useState(false);
    const [currency, setCurrency] = useState('TZS');

    const [officerFilter, setOfficerFilter] = useState('all');
    const [centerFilter, setCenterFilter] = useState('all');
    const [groupFilter, setGroupFilter] = useState('all');
    const [productFilter, setProductFilter] = useState('all');
    const [loanStatusFilter, setLoanStatusFilter] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);

    const [dateRangeFilter, setDateRangeFilter] = useState({
        from: startOfToday(),
        to: startOfToday(),
    });

    const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
    const [selectedLoanForSchedule, setSelectedLoanForSchedule] = useState(null);
    const [scheduleLoadingLoanId, setScheduleLoadingLoanId] = useState(null);

    const resetFilters = () => {
        setOfficerFilter('all');
        setCenterFilter('all');
        setGroupFilter('all');
        setProductFilter('all');
        setLoanStatusFilter('all');
        setSearchTerm('');
        setCurrentPage(1);
        setDateRangeFilter({ from: startOfToday(), to: startOfToday() });
    };

    const fetchContextData = useCallback(async () => {
        if (!user || !user.user_metadata.branch_id) return;
        setLoading(true);
        try {
            const { data: config } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
            if (config) setCurrency(config.value);

            const { data: officersData, error: officersError } = await supabase
                .from('users')
                .select('id, full_name')
                .eq('branch_id', user.user_metadata.branch_id)
                .eq('role', 'officer');
            if (officersError) throw officersError;
            setBranchOfficers(officersData || []);

            const officerIds = (officersData || []).map((o) => o.id);

            const { data: centersData, error: centersError } = await supabase
                .from('centers')
                .select('id, name, branch_id, loan_officer_id')
                .eq('branch_id', user.user_metadata.branch_id)
                .order('name');
            if (centersError) throw centersError;
            setCenters(centersData || []);

            let groupsData = [];
            if (officerIds.length > 0) {
                const { data: gData, error: groupsError } = await supabase
                    .from('groups')
                    .select('*')
                    .in('loan_officer_id', officerIds);
                if (groupsError) throw groupsError;
                groupsData = gData || [];
            }
            setGroups(groupsData);

            const { data: productsData, error: productsError } = await supabase
                .from('loan_products')
                .select('id, name')
                .eq('status', 'active');
            if (productsError) throw productsError;
            setLoanProducts(productsData || []);
        } catch (error) {
            toast({ title: 'Error fetching data', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [user, toast]);

    const fetchRepayments = useCallback(async () => {
        if (!user || !user.user_metadata.branch_id) return;
        const officerIds = branchOfficers.map((o) => o.id);
        setRepaymentsLoading(true);
        try {
            if (officerIds.length === 0) {
                setRepayments([]);
                return;
            }

            let query = supabase
                .from('repayments')
                .select('*, loans(id, borrower_id, schedule, loan_id, product_id, status, borrowers(*, groups(*)))')
                .in('officer_id', officerIds)
                .order('actual_payment_date', { ascending: false });

            if (dateRangeFilter?.from) {
                query = query.gte('actual_payment_date', format(dateRangeFilter.from, 'yyyy-MM-dd'));
                if (dateRangeFilter.to) {
                    query = query.lte('actual_payment_date', format(dateRangeFilter.to, 'yyyy-MM-dd'));
                } else {
                    query = query.lte('actual_payment_date', format(dateRangeFilter.from, 'yyyy-MM-dd'));
                }
            }

            if (officerFilter !== 'all') {
                query = query.eq('officer_id', officerFilter);
            }

            const { data, error } = await query;
            if (error) throw error;
            setRepayments(data || []);
        } catch (error) {
            toast({ title: 'Error fetching repayments', description: error.message, variant: 'destructive' });
        } finally {
            setRepaymentsLoading(false);
        }
    }, [user, branchOfficers, dateRangeFilter, officerFilter, toast]);

    useEffect(() => {
        fetchContextData();
    }, [fetchContextData]);

    useEffect(() => {
        if (loading) return;
        fetchRepayments();
    }, [fetchRepayments, loading]);

    const centersForSelectedOfficer = useMemo(() => {
        if (officerFilter === 'all') return [];
        return centers.filter((c) => c.loan_officer_id === officerFilter);
    }, [centers, officerFilter]);

    const groupsForTableFilter = useMemo(() => {
        if (officerFilter === 'all') {
            if (centerFilter === 'all') return groups;
            return groups.filter((g) => g.center_id === centerFilter);
        }
        if (centerFilter === 'all') {
            return groups.filter((g) => g.loan_officer_id === officerFilter);
        }
        return groups.filter(
            (g) => g.center_id === centerFilter && g.loan_officer_id === officerFilter,
        );
    }, [groups, centerFilter, officerFilter]);

    const groupsInSelectedCenterFilter = useMemo(() => {
        if (officerFilter === 'all' || centerFilter === 'all') return [];
        return groups.filter(
            (g) => g.center_id === centerFilter && g.loan_officer_id === officerFilter,
        );
    }, [groups, centerFilter, officerFilter]);

    useEffect(() => {
        setCenterFilter('all');
        setGroupFilter('all');
    }, [officerFilter]);

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

    const filteredRepayments = useMemo(() => {
        return repayments.filter((r) => {
            const b = r.loans?.borrowers;
            const centerId = b ? resolveBorrowerCenterId(b) : null;
            const matchesCenter = centerFilter === 'all' || centerId === centerFilter;
            const groupMatch = groupFilter === 'all' || b?.group_id === groupFilter;
            const productMatch = productFilter === 'all' || r.loans?.product_id === productFilter;
            const statusMatch = loanStatusFilter === 'all' || r.loans?.status === loanStatusFilter;

            const searchLower = searchTerm.toLowerCase();
            const loanId = r.loans?.loan_id?.toLowerCase() || '';
            const fName = b?.first_name?.toLowerCase() || '';
            const sName = b?.surname?.toLowerCase() || '';
            const borrowerName = `${fName} ${sName}`;
            const borrowerId = b?.borrower_id?.toLowerCase() || '';
            const qPhone = b?.phone_number && String(b.phone_number).toLowerCase().includes(searchLower);

            const searchMatch =
                !searchTerm ||
                loanId.includes(searchLower) ||
                borrowerName.includes(searchLower) ||
                borrowerId.includes(searchLower) ||
                (r.amount && String(r.amount).includes(searchLower)) ||
                (qPhone ?? false);

            return matchesCenter && groupMatch && productMatch && statusMatch && searchMatch;
        });
    }, [repayments, centerFilter, groupFilter, productFilter, loanStatusFilter, searchTerm, resolveBorrowerCenterId]);

    const totalPages = Math.max(1, Math.ceil(filteredRepayments.length / REPAYMENT_PAGE_SIZE) || 1);

    const paginatedRepayments = useMemo(() => {
        const start = (currentPage - 1) * REPAYMENT_PAGE_SIZE;
        return filteredRepayments.slice(start, start + REPAYMENT_PAGE_SIZE);
    }, [filteredRepayments, currentPage]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, centerFilter, groupFilter, productFilter, loanStatusFilter, officerFilter, dateRangeFilter]);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const stats = useMemo(() => {
        const totalPaid = filteredRepayments.reduce((sum, r) => sum + r.amount, 0);
        const totalInterest = filteredRepayments.reduce((sum, r) => sum + (r.interest_paid || 0), 0);
        const totalPrincipalPaid = filteredRepayments.reduce((sum, r) => sum + (r.principal_paid || 0), 0);
        return { totalPaid, totalInterest, totalPrincipalPaid };
    }, [filteredRepayments]);

    const handleDateRangeSelect = (range) => {
        if (!range) {
            setDateRangeFilter({ from: undefined, to: undefined });
            return;
        }
        setDateRangeFilter(range);
    };

    const handleViewSchedule = async (loan) => {
        if (!loan) return;
        setScheduleLoadingLoanId(loan.id);
        try {
            const { data: latestLoanData, error } = await supabase
                .from('loans')
                .select(`*, borrowers (id, first_name, surname)`)
                .eq('id', loan.id)
                .single();
            if (error) throw error;
            setSelectedLoanForSchedule(latestLoanData);
            setScheduleDialogOpen(true);
        } catch (error) {
            toast({ title: 'Error', description: 'Could not fetch latest schedule.', variant: 'destructive' });
        } finally {
            setScheduleLoadingLoanId(null);
        }
    };

    const handleExport = () => {
        const dataToExport = filteredRepayments.map((r) => ({
            'Payment Date': formatTZ(toZonedTime(new Date(r.actual_payment_date), EAT_TIMEZONE), 'yyyy-MM-dd'),
            Borrower: `${r.loans?.borrowers?.first_name} ${r.loans?.borrowers?.surname}`,
            'Loan ID': r.loans?.loan_id,
            Group: r.loans?.borrowers?.groups?.name || 'N/A',
            'Loan Officer': branchOfficers.find((o) => o.id === r.officer_id)?.full_name || 'N/A',
            'Principal Paid': r.principal_paid || 0,
            'Interest Paid': r.interest_paid || 0,
            'Total Paid': r.amount,
        }));
        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Repayments');
        XLSX.writeFile(wb, 'repayment_history.xlsx');
    };

    if (loading) {
        return (
            <DashboardLayout title="Repayment Management">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mt-8" />
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout title="Repayment Management">
            <div className="space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Repayment Overview</CardTitle>
                        <CardDescription>
                            Branch scope: repayments in range{' '}
                            <span className="font-semibold text-primary">
                                {dateRangeFilter?.from ? (
                                    dateRangeFilter.to ? (
                                        isToday(dateRangeFilter.from) && isToday(dateRangeFilter.to) ? (
                                            'Today'
                                        ) : (
                                            `${format(dateRangeFilter.from, 'LLL dd, y')} - ${format(dateRangeFilter.to, 'LLL dd, y')}`
                                        )
                                    ) : (
                                        format(dateRangeFilter.from, 'LLL dd, y')
                                    )
                                ) : (
                                    'Select a date range'
                                )}
                            </span>
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            <StatCard
                                title="Total Repayments"
                                value={`${currency} ${stats.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                icon={ArrowRightLeft}
                                color="text-primary"
                            />
                            <StatCard
                                title="Interest Collected"
                                value={`${currency} ${stats.totalInterest.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                icon={TrendingUp}
                                color="text-green-500"
                            />
                            <StatCard
                                title="Principal Repaid"
                                value={`${currency} ${stats.totalPrincipalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                icon={TrendingDown}
                                color="text-orange-500"
                            />
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Filters</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                        <div className="flex flex-wrap items-end gap-4">
                            <Select value={officerFilter} onValueChange={setOfficerFilter}>
                                <SelectTrigger className="w-[240px]">
                                    <SelectValue placeholder="Loan officer" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All loan officers</SelectItem>
                                    {branchOfficers.map((o) => (
                                        <SelectItem key={o.id} value={o.id}>
                                            {o.full_name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select
                                value={centerFilter}
                                onValueChange={setCenterFilter}
                                disabled={officerFilter === 'all'}
                            >
                                <SelectTrigger
                                    className="w-[240px] disabled:opacity-60"
                                    title={
                                        officerFilter === 'all'
                                            ? 'Select a loan officer first to filter by centre'
                                            : undefined
                                    }
                                >
                                    <SelectValue
                                        placeholder={
                                            officerFilter === 'all' ? 'Select loan officer first' : 'Centre'
                                        }
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All centres</SelectItem>
                                    {centersForSelectedOfficer.map((c) => (
                                        <SelectItem key={c.id} value={c.id}>
                                            {c.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select
                                value={groupFilter}
                                onValueChange={setGroupFilter}
                                disabled={officerFilter === 'all' || centerFilter === 'all'}
                            >
                                <SelectTrigger
                                    className="w-[240px] disabled:opacity-60"
                                    title={
                                        officerFilter === 'all'
                                            ? 'Select a loan officer first'
                                            : centerFilter === 'all'
                                              ? 'Select a centre first'
                                              : undefined
                                    }
                                >
                                    <SelectValue
                                        placeholder={
                                            officerFilter === 'all'
                                                ? 'Select loan officer first'
                                                : centerFilter === 'all'
                                                  ? 'Select centre first'
                                                  : 'Group'
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
                            <div className="min-w-[min(100%,16rem)] flex-1">
                                <Input
                                    placeholder="Search loan, borrower, phone, amount…"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                            <Select value={productFilter} onValueChange={setProductFilter}>
                                <SelectTrigger className="w-[240px]">
                                    <SelectValue placeholder="Product" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All products</SelectItem>
                                    {loanProducts.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>
                                            {p.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={loanStatusFilter} onValueChange={setLoanStatusFilter}>
                                <SelectTrigger className="w-[240px]">
                                    <SelectValue placeholder="Loan status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All loan statuses</SelectItem>
                                    <SelectItem value="active">Active</SelectItem>
                                    <SelectItem value="delinquent">Delinquent</SelectItem>
                                    <SelectItem value="defaulted">Defaulted</SelectItem>
                                    <SelectItem value="paid">Paid</SelectItem>
                                </SelectContent>
                            </Select>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="w-[280px] justify-start text-left font-normal border-gray-200">
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {dateRangeFilter?.from ? (
                                            dateRangeFilter.to ? (
                                                isToday(dateRangeFilter.from) && isToday(dateRangeFilter.to) ? (
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
                            <Button type="button" onClick={resetFilters} variant="ghost">
                                <X className="mr-2 h-4 w-4" /> Reset to today
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle>Repayment History</CardTitle>
                        <Button onClick={handleExport} disabled={filteredRepayments.length === 0}>
                            <FileDown className="mr-2 h-4 w-4" /> Export
                        </Button>
                    </CardHeader>
                    <CardContent>
                        <div className={excelTableWrapperClassName}>
                            <Table className={excelTableClassName}>
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className={excelThClassName('min-w-[6rem]')}>Date</TableHead>
                                        <TableHead className={excelThClassName('min-w-[9rem]')}>Borrower</TableHead>
                                        <TableHead className={excelThClassName()}>Group</TableHead>
                                        <TableHead className={excelThClassName()}>Loan officer</TableHead>
                                        <TableHead className={excelThClassName()}>Principal</TableHead>
                                        <TableHead className={excelThClassName()}>Interest</TableHead>
                                        <TableHead className={excelThClassName()}>Total</TableHead>
                                        <TableHead className={excelThClassName('min-w-[7rem] text-right')}>Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                {repaymentsLoading ? (
                                    <TableRow>
                                        <TableCell
                                            colSpan={8}
                                            className={`${excelEmptyStateCellClassName} h-32`}
                                        >
                                            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                                            <p className="mt-2">Loading repayments…</p>
                                        </TableCell>
                                    </TableRow>
                                ) : paginatedRepayments.length > 0 ? (
                                    paginatedRepayments.map((r) => (
                                        <TableRow key={r.id} className={excelTableRowClassName}>
                                            <TableCell className={excelTdClassName('text-xs tabular-nums')}>
                                                {formatTZ(
                                                    toZonedTime(new Date(r.actual_payment_date), EAT_TIMEZONE),
                                                    'MMM dd, yyyy',
                                                )}
                                            </TableCell>
                                            <TableCell className={excelTdClassName()}>
                                                <div className="flex flex-col">
                                                    <span className="font-medium">
                                                        {r.loans?.borrowers?.first_name} {r.loans?.borrowers?.surname}
                                                    </span>
                                                    <span className="text-xs text-muted-foreground">
                                                        {r.loans?.loan_id}
                                                    </span>
                                                </div>
                                            </TableCell>
                                            <TableCell className={excelTdClassName()}>
                                                {r.loans?.borrowers?.groups?.name || 'N/A'}
                                            </TableCell>
                                            <TableCell className={excelTdClassName()}>
                                                {branchOfficers.find((o) => o.id === r.officer_id)?.full_name || 'N/A'}
                                            </TableCell>
                                            <TableCell className={excelTdClassName('tabular-nums')}>
                                                {currency}{' '}
                                                {(r.principal_paid || 0).toLocaleString(undefined, {
                                                    minimumFractionDigits: 2,
                                                    maximumFractionDigits: 2,
                                                })}
                                            </TableCell>
                                            <TableCell className={excelTdClassName('tabular-nums')}>
                                                {currency}{' '}
                                                {(r.interest_paid || 0).toLocaleString(undefined, {
                                                    minimumFractionDigits: 2,
                                                    maximumFractionDigits: 2,
                                                })}
                                            </TableCell>
                                            <TableCell className={excelTdClassName('font-semibold tabular-nums')}>
                                                {currency}{' '}
                                                {r.amount.toLocaleString(undefined, {
                                                    minimumFractionDigits: 2,
                                                    maximumFractionDigits: 2,
                                                })}
                                            </TableCell>
                                            <TableCell className={excelTdClassName('p-1.5 text-right')}>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleViewSchedule(r.loans)}
                                                    disabled={scheduleLoadingLoanId === r.loans?.id}
                                                    aria-label="View schedule"
                                                >
                                                    {scheduleLoadingLoanId === r.loans?.id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <Eye className="h-4 w-4" />
                                                    )}
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell
                                            colSpan={8}
                                            className={`${excelEmptyStateCellClassName} h-32`}
                                        >
                                            <div className="flex flex-col items-center justify-center gap-2">
                                                <Search className="h-8 w-8 text-gray-300" />
                                                <p>No repayments found for the selected filters.</p>
                                                {isToday(dateRangeFilter?.from) && isToday(dateRangeFilter?.to) && (
                                                    <p className="text-xs">
                                                        Collections made today appear after they are recorded.
                                                    </p>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )}
                                </TableBody>
                                {filteredRepayments.length > 0 && !repaymentsLoading && (
                                    <TableFooter>
                                        <TableRow>
                                            <TableCell
                                                colSpan={4}
                                                className={excelTdClassName('text-right text-sm font-bold')}
                                            >
                                                Totals (all filtered)
                                            </TableCell>
                                            <TableCell className={excelTdClassName('font-bold tabular-nums')}>
                                                {currency}{' '}
                                                {stats.totalPrincipalPaid.toLocaleString(undefined, {
                                                    minimumFractionDigits: 2,
                                                    maximumFractionDigits: 2,
                                                })}
                                            </TableCell>
                                            <TableCell className={excelTdClassName('font-bold tabular-nums')}>
                                                {currency}{' '}
                                                {stats.totalInterest.toLocaleString(undefined, {
                                                    minimumFractionDigits: 2,
                                                    maximumFractionDigits: 2,
                                                })}
                                            </TableCell>
                                            <TableCell className={excelTdClassName('font-bold tabular-nums')}>
                                                {currency}{' '}
                                                {stats.totalPaid.toLocaleString(undefined, {
                                                    minimumFractionDigits: 2,
                                                    maximumFractionDigits: 2,
                                                })}
                                            </TableCell>
                                            <TableCell className={excelTdClassName()} />
                                        </TableRow>
                                    </TableFooter>
                                )}
                            </Table>
                        </div>
                        <div className="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-sm text-muted-foreground">
                                {filteredRepayments.length === 0
                                    ? 'Showing 0 of 0'
                                    : (() => {
                                          const from = (currentPage - 1) * REPAYMENT_PAGE_SIZE + 1;
                                          const to = Math.min(currentPage * REPAYMENT_PAGE_SIZE, filteredRepayments.length);
                                          return `Showing ${from}–${to} of ${filteredRepayments.length}`;
                                      })()}
                            </p>
                            <div className="flex items-center justify-end gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                    disabled={currentPage <= 1 || repaymentsLoading}
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
                                    disabled={currentPage >= totalPages || repaymentsLoading}
                                    aria-label="Next page"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
                <DialogContent className="max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>Repayment Schedule</DialogTitle>
                        <DialogDescription>
                            Loan ID: {selectedLoanForSchedule?.loan_id} | Borrower: {selectedLoanForSchedule?.borrowers?.first_name}{' '}
                            {selectedLoanForSchedule?.borrowers?.surname}
                        </DialogDescription>
                    </DialogHeader>
                    {selectedLoanForSchedule && (
                        <div className={`max-h-[60vh] overflow-y-auto ${excelTableWrapperClassName}`}>
                            <Table className={excelTableClassName}>
                                <TableHeader className="sticky top-0 z-10">
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className={excelThClassName()}>#</TableHead>
                                        <TableHead className={excelThClassName()}>Due date</TableHead>
                                        <TableHead className={excelThClassName()}>Amount due</TableHead>
                                        <TableHead className={excelThClassName()}>Principal paid</TableHead>
                                        <TableHead className={excelThClassName()}>Interest paid</TableHead>
                                        <TableHead className={excelThClassName()}>Total paid</TableHead>
                                        <TableHead className={excelThClassName()}>Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {selectedLoanForSchedule.schedule?.map((inst) => (
                                        <TableRow key={inst.installmentNumber} className={excelTableRowClassName}>
                                            <TableCell className={excelTdClassName('tabular-nums')}>
                                                {inst.installmentNumber}
                                            </TableCell>
                                            <TableCell className={excelTdClassName('text-xs tabular-nums')}>
                                                {formatTZ(
                                                    toZonedTime(new Date(inst.dueDate), EAT_TIMEZONE),
                                                    'MMM dd, yyyy',
                                                )}
                                            </TableCell>
                                            <TableCell className={excelTdClassName('tabular-nums')}>
                                                {currency}{' '}
                                                {inst.amount.toLocaleString(undefined, {
                                                    minimumFractionDigits: 2,
                                                    maximumFractionDigits: 2,
                                                })}
                                            </TableCell>
                                            <TableCell className={excelTdClassName('tabular-nums')}>
                                                {currency}{' '}
                                                {(inst.principalPaid || 0).toLocaleString(undefined, {
                                                    minimumFractionDigits: 2,
                                                    maximumFractionDigits: 2,
                                                })}
                                            </TableCell>
                                            <TableCell className={excelTdClassName('tabular-nums')}>
                                                {currency}{' '}
                                                {(inst.interestPaid || 0).toLocaleString(undefined, {
                                                    minimumFractionDigits: 2,
                                                    maximumFractionDigits: 2,
                                                })}
                                            </TableCell>
                                            <TableCell className={excelTdClassName('tabular-nums')}>
                                                {currency}{' '}
                                                {(inst.paidAmount || 0).toLocaleString(undefined, {
                                                    minimumFractionDigits: 2,
                                                    maximumFractionDigits: 2,
                                                })}
                                            </TableCell>
                                            <TableCell className={excelTdClassName()}>
                                                <Badge
                                                    variant={
                                                        inst.status === 'paid'
                                                            ? 'success'
                                                            : inst.status === 'arrears'
                                                              ? 'destructive'
                                                              : 'secondary'
                                                    }
                                                    className="capitalize"
                                                >
                                                    {inst.status}
                                                </Badge>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </DashboardLayout>
    );
};

export default ManagerRepaymentManagement;
