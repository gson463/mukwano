import React, { useState, useEffect, useMemo, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Eye, Briefcase, DollarSign, AlertTriangle, Calendar as CalendarIconLucide, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toZonedTime, format as formatTZ } from 'date-fns-tz';
import { getDisabledDates } from '@/utils/holidayUtils';
import { BorrowerSearchSelect } from '@/components/BorrowerSearchSelect';
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
const LOAN_PAGE_SIZE = 10;

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

const ManagerLoanManagement = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [loans, setLoans] = useState([]);
    const [officers, setOfficers] = useState([]);
    const [loanProducts, setLoanProducts] = useState([]);
    const [borrowers, setBorrowers] = useState([]);
    const [centers, setCenters] = useState([]);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
    const [selectedLoan, setSelectedLoan] = useState(null);
    const [isRefreshingSchedule, setIsRefreshingSchedule] = useState(false);
    const [currency, setCurrency] = useState('TZS');
    
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('active');
    const [productFilter, setProductFilter] = useState('all');
    const [officerFilter, setOfficerFilter] = useState('all');
    const [borrowerFilter, setBorrowerFilter] = useState(null);
    const [dateRange, setDateRange] = useState({ from: undefined, to: undefined });
    const [centerFilter, setCenterFilter] = useState('all');
    const [groupFilter, setGroupFilter] = useState('all');
    const [currentPage, setCurrentPage] = useState(1);

    const fetchData = useCallback(async () => {
        if (!user || !user.user_metadata.branch_id) return;
        setLoading(true);

        const { data: config } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
        if (config) setCurrency(config.value);

        const { data: officersData, error: officersError } = await supabase
            .from('users')
            .select('id, full_name')
            .eq('branch_id', user.user_metadata.branch_id)
            .eq('role', 'officer');
            
        if (officersError) {
             toast({ title: 'Error fetching officers', description: officersError.message, variant: 'destructive' });
             setLoading(false);
             return;
        }
        setOfficers(officersData || []);
        
        const officerIds = officersData.map(o => o.id);

        if (officerIds.length === 0) {
            setLoans([]);
            setLoading(false);
            return;
        }

        const { data: loansData, error: loansError } = await supabase
            .from('loans')
            .select(
                `*, borrowers ( id, first_name, surname, group_id, center_id, borrower_id, phone_number ), officer:users!officer_id ( full_name )`,
            )
            .in('officer_id', officerIds);

        const { data: productsData, error: productsError } = await supabase
            .from('loan_products')
            .select('*')
            .eq('status', 'active');

        const { data: centersData, error: centersError } = await supabase
            .from('centers')
            .select('id, name, branch_id, loan_officer_id')
            .eq('branch_id', user.user_metadata.branch_id)
            .order('name');

        const { data: groupsData, error: groupsError } = await supabase.from('groups').select('*').in('loan_officer_id', officerIds);

        // Fetch Borrowers for Filter
        const { data: borrowersData, error: borrowersError } = await supabase
            .from('borrowers')
            .select('id, first_name, surname, borrower_id, phone_number')
            .eq('branch_id', user.user_metadata.branch_id);

        if (loansError || productsError || borrowersError || centersError || groupsError) {
            toast({
                title: 'Error fetching data',
                description:
                    loansError?.message ||
                    productsError?.message ||
                    borrowersError?.message ||
                    centersError?.message ||
                    groupsError?.message,
                variant: 'destructive',
            });
        } else {
            setLoans(loansData || []);
            setLoanProducts(productsData || []);
            setBorrowers(borrowersData || []);
            setCenters(centersData || []);
            setGroups(groupsData || []);
        }
        setLoading(false);
    }, [user, toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

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

    const filteredLoans = useMemo(() => {
        return loans.filter((loan) => {
            const b = loan.borrowers;
            const borrowerName = `${b?.first_name || ''} ${b?.surname || ''}`.toLowerCase();
            const query = searchQuery.toLowerCase();
            const qPhone = b?.phone_number && String(b.phone_number).toLowerCase().includes(query);
            const qBorrowerId = b?.borrower_id && String(b.borrower_id).toLowerCase().includes(query);
            const matchesSearch =
                loan.loan_id.toLowerCase().includes(query) ||
                borrowerName.includes(query) ||
                loan.principal.toString().includes(query) ||
                (qPhone ?? false) ||
                (qBorrowerId ?? false);
            const matchesStatus = statusFilter === 'all' || loan.status === statusFilter;
            const matchesProduct = productFilter === 'all' || loan.product_id === productFilter;
            const matchesOfficer = officerFilter === 'all' || loan.officer_id === officerFilter;
            const matchesBorrower = !borrowerFilter || loan.borrower_id === borrowerFilter;
            const centerId = b ? resolveBorrowerCenterId(b) : null;
            const matchesCenter = centerFilter === 'all' || centerId === centerFilter;
            const matchesGroup = groupFilter === 'all' || b?.group_id === groupFilter;

            let matchesDate = true;
            if (dateRange.from && dateRange.to) {
                const loanDate = toZonedTime(new Date(loan.disbursement_date), EAT_TIMEZONE);
                matchesDate =
                    loanDate >= toZonedTime(dateRange.from, EAT_TIMEZONE) &&
                    loanDate <= toZonedTime(dateRange.to, EAT_TIMEZONE);
            } else if (dateRange.from) {
                matchesDate =
                    toZonedTime(new Date(loan.disbursement_date), EAT_TIMEZONE) >=
                    toZonedTime(dateRange.from, EAT_TIMEZONE);
            }

            return (
                matchesSearch &&
                matchesStatus &&
                matchesProduct &&
                matchesOfficer &&
                matchesBorrower &&
                matchesDate &&
                matchesCenter &&
                matchesGroup
            );
        });
    }, [
        loans,
        searchQuery,
        statusFilter,
        productFilter,
        officerFilter,
        borrowerFilter,
        dateRange,
        centerFilter,
        groupFilter,
        resolveBorrowerCenterId,
    ]);

    const stats = useMemo(() => {
        const totalLoans = loans.length;
        const totalPrincipal = loans.reduce((sum, l) => sum + Number(l.principal), 0);
        const totalBalance = loans.reduce((sum, l) => sum + Number(l.balance), 0);
        const atRiskLoans = loans.filter((l) => ['delinquent', 'defaulted'].includes(l.status)).length;
        return { totalLoans, totalPrincipal, totalBalance, atRiskLoans };
    }, [loans]);

    const totalPages = Math.max(1, Math.ceil(filteredLoans.length / LOAN_PAGE_SIZE) || 1);

    const paginatedLoans = useMemo(() => {
        const start = (currentPage - 1) * LOAN_PAGE_SIZE;
        return filteredLoans.slice(start, start + LOAN_PAGE_SIZE);
    }, [filteredLoans, currentPage]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, statusFilter, productFilter, officerFilter, borrowerFilter, dateRange, centerFilter, groupFilter]);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const viewSchedule = async (loan) => {
        setIsRefreshingSchedule(true);
        try {
            await supabase.rpc('recalculate_loan_schedule', { p_loan_id: loan.id });
            await supabase.rpc('update_all_loan_statuses');
            
            const { data: latestLoanData, error } = await supabase
                .from('loans')
                .select(`*, borrowers (id, first_name, surname)`)
                .eq('id', loan.id)
                .single();
                
            if (error) throw error;

            setSelectedLoan(latestLoanData);
            setScheduleDialogOpen(true);
        } catch (error) {
             console.error(error);
             toast({ title: 'Error', description: 'Could not refresh schedule data.', variant: 'destructive' });
        } finally {
            setIsRefreshingSchedule(false);
        }
    };

    const getStatusBadge = (status) => ({ active: 'success', paid: 'default', delinquent: 'warning', defaulted: 'destructive', delete_requested: 'secondary', edit_requested: 'secondary' }[status] || 'secondary');
    
    if (loading) return <DashboardLayout title="Branch Loans"><div className="flex items-center justify-center h-full">Loading...</div></DashboardLayout>;

    return (
        <DashboardLayout title="Branch Loans">
            <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <StatCard title="Total Loans" value={stats.totalLoans} icon={Briefcase} color="text-primary" />
                    <StatCard title="Total Principal" value={`${currency} ${stats.totalPrincipal.toLocaleString()}`} icon={DollarSign} color="text-green-600" />
                    <StatCard title="Total Outstanding" value={`${currency} ${stats.totalBalance.toLocaleString()}`} icon={DollarSign} color="text-yellow-600" />
                    <StatCard title="Loans at Risk" value={stats.atRiskLoans} icon={AlertTriangle} color="text-red-600" />
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-4">
                            <CardTitle>Loans List</CardTitle>
                            <div className="flex w-full flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-end">
                                <Select value={officerFilter} onValueChange={setOfficerFilter}>
                                    <SelectTrigger className="w-full min-w-0 sm:min-w-[10rem] lg:w-[12rem]">
                                        <SelectValue placeholder="Loan officer" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All officers</SelectItem>
                                        {officers.map((o) => (
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
                                        className="w-full min-w-0 sm:min-w-[10rem] lg:w-[12rem] disabled:cursor-not-allowed disabled:opacity-60"
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
                                        className="w-full min-w-0 sm:min-w-[10rem] lg:w-[12rem] disabled:cursor-not-allowed disabled:opacity-60"
                                        title={
                                            officerFilter === 'all'
                                                ? 'Select a loan officer first'
                                                : centerFilter === 'all'
                                                  ? 'Select a centre first to filter by group'
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
                                <div className="min-w-0 flex-1 lg:min-w-[12rem]">
                                    <Input
                                        placeholder="Search loan ID, borrower, phone, amount…"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full"
                                    />
                                </div>
                                <Select value={statusFilter} onValueChange={setStatusFilter}>
                                    <SelectTrigger className="w-full min-w-0 sm:min-w-[10rem] lg:w-[11rem]">
                                        <SelectValue placeholder="Filter by Status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="active">Active</SelectItem>
                                        <SelectItem value="delinquent">Delinquent</SelectItem>
                                        <SelectItem value="defaulted">Defaulted</SelectItem>
                                        <SelectItem value="paid">Paid</SelectItem>
                                        <SelectItem value="all">All Statuses</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Select value={productFilter} onValueChange={setProductFilter}>
                                    <SelectTrigger className="w-full min-w-0 sm:min-w-[10rem] lg:w-[12rem]">
                                        <SelectValue placeholder="Filter by Product" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Products</SelectItem>
                                        {loanProducts.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                <div className="w-full min-w-0 sm:w-auto lg:min-w-[16rem]">
                                    <BorrowerSearchSelect
                                        borrowers={borrowers}
                                        value={borrowerFilter}
                                        onChange={setBorrowerFilter}
                                        placeholder="Filter Borrower..."
                                    />
                                </div>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" className="w-full justify-start text-left font-normal lg:min-w-[200px]">
                                            <CalendarIconLucide className="mr-2 h-4 w-4" />
                                            {dateRange?.from ? (
                                                dateRange.to ? (
                                                    <>{formatTZ(dateRange.from, "LLL dd, y", { timeZone: EAT_TIMEZONE })} - {formatTZ(dateRange.to, "LLL dd, y", { timeZone: EAT_TIMEZONE })}</>
                                                ) : (
                                                    formatTZ(dateRange.from, "LLL dd, y", { timeZone: EAT_TIMEZONE })
                                                )
                                            ) : (
                                                <span>Pick a date range</span>
                                            )}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                        <Calendar mode="range" selected={dateRange} onSelect={setDateRange} numberOfMonths={2} disabled={getDisabledDates()} />
                                    </PopoverContent>
                                </Popover>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className={excelTableWrapperClassName}>
                            <Table className={excelTableClassName}>
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className={excelThClassName()}>Loan ID</TableHead>
                                        <TableHead className={excelThClassName('min-w-[7rem]')}>Borrower</TableHead>
                                        <TableHead className={excelThClassName()}>Officer</TableHead>
                                        <TableHead className={excelThClassName()}>Principal</TableHead>
                                        <TableHead className={excelThClassName()}>Balance</TableHead>
                                        <TableHead className={excelThClassName()}>Disbursement</TableHead>
                                        <TableHead className={excelThClassName()}>Status</TableHead>
                                        <TableHead className={excelThClassName('min-w-[10rem] text-right')}>
                                            Actions
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {paginatedLoans.map((l) => (
                                        <TableRow key={l.id} className={excelTableRowClassName}>
                                            <TableCell className={excelTdClassName('font-mono text-xs text-foreground')}>
                                                {l.loan_id}
                                            </TableCell>
                                            <TableCell className={excelTdClassName()}>
                                                {l.borrowers?.first_name} {l.borrowers?.surname}
                                            </TableCell>
                                            <TableCell className={excelTdClassName()}>{l.officer?.full_name}</TableCell>
                                            <TableCell className={excelTdClassName('font-medium')}>
                                                {currency} {Number(l.principal).toLocaleString()}
                                            </TableCell>
                                            <TableCell className={excelTdClassName('font-medium tabular-nums')}>
                                                {currency}{' '}
                                                {Number(l.balance).toLocaleString(undefined, {
                                                    minimumFractionDigits: 2,
                                                })}
                                            </TableCell>
                                            <TableCell className={excelTdClassName('text-xs tabular-nums')}>
                                                {formatTZ(
                                                    toZonedTime(new Date(l.disbursement_date), EAT_TIMEZONE),
                                                    'MMM dd, yyyy',
                                                    { timeZone: EAT_TIMEZONE },
                                                )}
                                            </TableCell>
                                            <TableCell className={excelTdClassName()}>
                                                <Badge variant={getStatusBadge(l.status)} className="capitalize">
                                                    {l.status.replace(/_/g, ' ')}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className={excelTdClassName('p-1.5 text-right')}>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => viewSchedule(l)}
                                                    className="inline-flex items-center gap-2"
                                                >
                                                    {isRefreshingSchedule && selectedLoan?.id === l.id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <Eye className="h-4 w-4" />
                                                    )}
                                                    Schedule
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {filteredLoans.length === 0 && (
                                        <TableRow>
                                            <TableCell
                                                colSpan={8}
                                                className={excelEmptyStateCellClassName}
                                            >
                                                No loans found matching filters.
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
                                          const from = (currentPage - 1) * LOAN_PAGE_SIZE + 1;
                                          const to = Math.min(currentPage * LOAN_PAGE_SIZE, filteredLoans.length);
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
            <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
                <DialogContent className="max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>Repayment Schedule for {selectedLoan?.loan_id}</DialogTitle>
                        <DialogDescription>
                            Borrower: {selectedLoan?.borrowers?.first_name} {selectedLoan?.borrowers?.surname} <br/>
                            Total Payable: {currency} {(selectedLoan?.total_payable || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </DialogDescription>
                    </DialogHeader>
                    <div className={`max-h-[60vh] overflow-y-auto ${excelTableWrapperClassName}`}>
                        <Table className={excelTableClassName}>
                            <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                    <TableHead className={excelThClassName()}>#</TableHead>
                                    <TableHead className={excelThClassName()}>Due Date</TableHead>
                                    <TableHead className={excelThClassName()}>Amount Due</TableHead>
                                    <TableHead className={excelThClassName()}>Paid</TableHead>
                                    <TableHead className={excelThClassName()}>Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {selectedLoan?.schedule?.map((inst) => (
                                    <TableRow key={inst.installmentNumber} className={excelTableRowClassName}>
                                        <TableCell className={excelTdClassName('tabular-nums')}>
                                            {inst.installmentNumber}
                                        </TableCell>
                                        <TableCell className={excelTdClassName('text-xs tabular-nums')}>
                                            {formatTZ(
                                                toZonedTime(new Date(inst.dueDate), EAT_TIMEZONE),
                                                'MMM dd, yyyy',
                                                { timeZone: EAT_TIMEZONE },
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
                                                          ? 'warning'
                                                          : 'default'
                                                }
                                            >
                                                {inst.status}
                                            </Badge>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </DialogContent>
            </Dialog>
        </DashboardLayout>
    );
};

export default ManagerLoanManagement;