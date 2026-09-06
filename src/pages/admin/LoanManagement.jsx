import React, { useState, useEffect, useMemo, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Eye, Briefcase, DollarSign, AlertTriangle, Calendar as CalendarIconLucide, Loader2, Edit, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { toZonedTime, format as formatTZ } from 'date-fns-tz';
import { getDisabledDates } from '@/utils/holidayUtils';
import { BorrowerSearchSelect } from '@/components/BorrowerSearchSelect';
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
import {
    adminCentersForSelect,
    adminGroupsForLoanTable,
    resolveBorrowerCenterId,
} from '@/lib/adminHierarchyFilters';
import { shouldIncludeLoanByStatusAndSearch } from '@/lib/loanListFilters';
import {
    LOAN_OPEN_STATUSES,
    LOAN_LIST_SELECT_WITH_OFFICER,
    fetchPaidLoansByNameOrLoanId,
} from '@/lib/loanListQuery';

const EAT_TIMEZONE = 'Africa/Nairobi';

const StatCard = ({ title, value, icon: Icon, color }) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-gray-600">{title}</CardTitle>
        <Icon className={`h-5 w-5 ${color}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
);

const AdminLoanManagement = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [loans, setLoans] = useState([]);
    const [paidSearchLoans, setPaidSearchLoans] = useState([]);
    const [branches, setBranches] = useState([]);
    const [centers, setCenters] = useState([]);
    const [groups, setGroups] = useState([]);
    const [officers, setOfficers] = useState([]);
    const [loanProducts, setLoanProducts] = useState([]);
    const [borrowers, setBorrowers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
    const [statusEditDialogOpen, setStatusEditDialogOpen] = useState(false);
    const [selectedLoan, setSelectedLoan] = useState(null);
    const [newStatus, setNewStatus] = useState('');
    const [isRefreshingSchedule, setIsRefreshingSchedule] = useState(false);
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
    const [currency, setCurrency] = useState('TZS');
    
    const [searchQuery, setSearchQuery] = useState('');
    const [branchFilter, setBranchFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('active');
    const [productFilter, setProductFilter] = useState('all');
    const [officerFilter, setOfficerFilter] = useState('all');
    const [centerFilter, setCenterFilter] = useState('all');
    const [groupFilter, setGroupFilter] = useState('all');
    const [borrowerFilter, setBorrowerFilter] = useState(null);
    const [dateRange, setDateRange] = useState({ from: undefined, to: undefined });
    const [currentPage, setCurrentPage] = useState(1);

    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);

        try {
            const [
                configRes,
                branchesRes,
                officersRes,
                centersRes,
                groupsRes,
                loansRes,
                productsRes,
                borrowersRes,
            ] = await Promise.all([
                supabase.from('system_config').select('value').eq('key', 'currency').single(),
                supabase.from('branches').select('*'),
                supabase.from('users').select('id, full_name, branch_id').eq('role', 'officer'),
                supabase.from('centers').select('id, name, branch_id, loan_officer_id'),
                supabase.from('groups').select('*'),
                supabase
                    .from('loans')
                    .select(LOAN_LIST_SELECT_WITH_OFFICER)
                    .in('status', LOAN_OPEN_STATUSES)
                    .order('disbursement_date', { ascending: false }),
                supabase.from('loan_products').select('*'),
                supabase
                    .from('borrowers')
                    .select(
                        'id, first_name, surname, borrower_id, phone_number, group_id, center_id, branch_id, loan_officer_id',
                    ),
            ]);

            if (configRes.data) setCurrency(configRes.data.value);
            if (branchesRes.error) {
                toast({ title: 'Error fetching branches', description: branchesRes.error.message, variant: 'destructive' });
            } else {
                setBranches(branchesRes.data || []);
            }
            if (officersRes.error) {
                toast({ title: 'Error fetching officers', description: officersRes.error.message, variant: 'destructive' });
            } else {
                setOfficers(officersRes.data || []);
            }
            if (centersRes.error) {
                toast({ title: 'Error fetching centers', description: centersRes.error.message, variant: 'destructive' });
            } else {
                setCenters(centersRes.data || []);
            }
            if (groupsRes.error) {
                toast({ title: 'Error fetching groups', description: groupsRes.error.message, variant: 'destructive' });
            } else {
                setGroups(groupsRes.data || []);
            }

            if (loansRes.error || productsRes.error || borrowersRes.error) {
                toast({
                    title: 'Error fetching data',
                    description:
                        loansRes.error?.message || productsRes.error?.message || borrowersRes.error?.message,
                    variant: 'destructive',
                });
            } else {
                setLoans(loansRes.data || []);
                setLoanProducts(productsRes.data || []);
                setBorrowers(borrowersRes.data || []);
            }
        } finally {
            setLoading(false);
        }
    }, [user, toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        const q = searchQuery.trim();
        if (q.length < 2) {
            setPaidSearchLoans([]);
            return;
        }
        let cancelled = false;
        const t = setTimeout(async () => {
            try {
                const paid = await fetchPaidLoansByNameOrLoanId(supabase, {
                    searchQuery: q,
                    select: LOAN_LIST_SELECT_WITH_OFFICER,
                });
                if (!cancelled) setPaidSearchLoans(paid);
            } catch (e) {
                console.error(e);
                if (!cancelled) setPaidSearchLoans([]);
            }
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [searchQuery]);

    const filteredOfficers = useMemo(() => {
        if (branchFilter === 'all') return officers;
        return officers.filter(o => o.branch_id === branchFilter);
    }, [officers, branchFilter]);

    useEffect(() => {
        if (branchFilter !== 'all' && officerFilter !== 'all') {
            const officer = officers.find(o => o.id === officerFilter);
            if (officer && officer.branch_id !== branchFilter) {
                setOfficerFilter('all');
            }
        }
    }, [branchFilter, officerFilter, officers]);

    useEffect(() => {
        setCenterFilter('all');
        setGroupFilter('all');
    }, [branchFilter, officerFilter]);

    useEffect(() => {
        if (centerFilter === 'all') {
            setGroupFilter('all');
        }
    }, [centerFilter]);

    const groupsForTableFilter = useMemo(
        () => adminGroupsForLoanTable(groups, centerFilter, officerFilter),
        [groups, centerFilter, officerFilter],
    );

    useEffect(() => {
        if (groupFilter !== 'all' && !groupsForTableFilter.some((g) => g.id === groupFilter)) {
            setGroupFilter('all');
        }
    }, [centerFilter, groupFilter, groupsForTableFilter]);

    const centersInSelect = useMemo(
        () => adminCentersForSelect(centers, branchFilter),
        [centers, branchFilter],
    );

    const borrowersForSelect = useMemo(() => {
        return borrowers.filter((b) => {
            if (branchFilter !== 'all' && b.branch_id !== branchFilter) return false;
            if (officerFilter !== 'all' && b.loan_officer_id && b.loan_officer_id !== officerFilter) {
                return false;
            }
            const cId = resolveBorrowerCenterId(b, groups);
            if (centerFilter !== 'all' && cId !== centerFilter) return false;
            if (groupFilter !== 'all' && b.group_id !== groupFilter) return false;
            return true;
        });
    }, [borrowers, branchFilter, centerFilter, groupFilter, groups, officerFilter]);

    const filteredLoans = useMemo(() => {
        const byId = new Map();
        for (const loan of loans) byId.set(loan.id, loan);
        for (const loan of paidSearchLoans) byId.set(loan.id, loan);
        return [...byId.values()].filter((loan) => {
            if (!shouldIncludeLoanByStatusAndSearch(loan, { searchQuery, statusFilter })) {
                return false;
            }
            const b = loan.borrowers;
            const matchesProduct = productFilter === 'all' || loan.product_id === productFilter;
            const matchesOfficer = officerFilter === 'all' || loan.officer_id === officerFilter;
            const matchesBranch = branchFilter === 'all' || loan.officer?.branch_id === branchFilter;
            const matchesBorrower = !borrowerFilter || loan.borrower_id === borrowerFilter;
            const centerId = b ? resolveBorrowerCenterId(b, groups) : null;
            const matchesCenter = centerFilter === 'all' || centerId === centerFilter;
            const matchesGroup = groupFilter === 'all' || b?.group_id === groupFilter;

            let matchesDate = true;
            if (dateRange.from && dateRange.to) {
                const loanDate = toZonedTime(new Date(loan.disbursement_date), EAT_TIMEZONE);
                matchesDate = loanDate >= toZonedTime(dateRange.from, EAT_TIMEZONE) && loanDate <= toZonedTime(dateRange.to, EAT_TIMEZONE);
            } else if (dateRange.from) {
                matchesDate = toZonedTime(new Date(loan.disbursement_date), EAT_TIMEZONE) >= toZonedTime(dateRange.from, EAT_TIMEZONE);
            }

            return (
                matchesProduct &&
                matchesOfficer &&
                matchesBranch &&
                matchesBorrower &&
                matchesDate &&
                matchesCenter &&
                matchesGroup
            );
        });
    }, [
        loans,
        paidSearchLoans,
        groups,
        searchQuery,
        statusFilter,
        productFilter,
        officerFilter,
        branchFilter,
        centerFilter,
        groupFilter,
        borrowerFilter,
        dateRange,
    ]);
    
    const stats = useMemo(() => {
        const totalLoans = filteredLoans.length;
        const totalPrincipal = filteredLoans.reduce((sum, l) => sum + Number(l.principal), 0);
        const totalBalance = filteredLoans.reduce((sum, l) => sum + Number(l.balance), 0);
        const atRiskLoans = filteredLoans.filter(l => ['delinquent', 'defaulted'].includes(l.status)).length;
        return { totalLoans, totalPrincipal, totalBalance, atRiskLoans };
    }, [filteredLoans]);

    const totalPages = useMemo(
        () => getTotalPages(filteredLoans.length, DEFAULT_TABLE_PAGE_SIZE),
        [filteredLoans.length],
    );

    const paginatedLoans = useMemo(
        () => slicePage(filteredLoans, currentPage, DEFAULT_TABLE_PAGE_SIZE),
        [filteredLoans, currentPage],
    );

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, statusFilter, productFilter, officerFilter, branchFilter, centerFilter, groupFilter, borrowerFilter, dateRange]);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const viewSchedule = async (loan) => {
        setIsRefreshingSchedule(true);
        try {
            await supabase.rpc('recalculate_loan_schedule', { p_loan_id: loan.id });

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

    const openStatusEdit = (loan) => {
        setSelectedLoan(loan);
        setNewStatus(loan.status);
        setStatusEditDialogOpen(true);
    };

    const handleUpdateStatus = async () => {
        if (!selectedLoan || !newStatus) return;
        setIsUpdatingStatus(true);
        try {
            const { error } = await supabase.rpc('update_loan_status', { 
                p_loan_id: selectedLoan.id, 
                p_new_status: newStatus 
            });

            if (error) throw error;

            toast({ title: 'Success', description: 'Loan status updated successfully.' });
            setStatusEditDialogOpen(false);
            fetchData();
        } catch (error) {
            console.error(error);
            toast({ title: 'Error', description: error.message || 'Failed to update status.', variant: 'destructive' });
        } finally {
            setIsUpdatingStatus(false);
        }
    };

    const getStatusBadge = (status) => ({ active: 'success', paid: 'default', delinquent: 'warning', defaulted: 'destructive', delete_requested: 'secondary', edit_requested: 'secondary' }[status] || 'secondary');
    
    if (loading) {
        return (
            <DashboardLayout title="Admin Loan Management">
                <div className="flex items-center justify-center h-48 gap-2 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    Loading open loans…
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout title="Admin Loan Management">
            <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard title="Total Loans" value={stats.totalLoans} icon={Briefcase} color="text-primary" />
                    <StatCard title="Total Principal" value={`${currency} ${stats.totalPrincipal.toLocaleString()}`} icon={DollarSign} color="text-green-600" />
                    <StatCard title="Total Outstanding" value={`${currency} ${stats.totalBalance.toLocaleString()}`} icon={DollarSign} color="text-yellow-600" />
                    <StatCard title="Loans at Risk" value={stats.atRiskLoans} icon={AlertTriangle} color="text-red-600" />
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-4">
                            <CardTitle>Loans List ({filteredLoans.length})</CardTitle>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                                <Input placeholder="Search name or loan ID (paid loans appear here)…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                                
                                <Select value={branchFilter} onValueChange={setBranchFilter}>
                                    <SelectTrigger><SelectValue placeholder="Filter by Branch" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Branches</SelectItem>
                                        {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>

                                <Select value={centerFilter} onValueChange={setCenterFilter}>
                                    <SelectTrigger><SelectValue placeholder="Center" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Centers</SelectItem>
                                        {centersInSelect.map((c) => (
                                            <SelectItem key={c.id} value={c.id}>
                                                {c.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                <Select value={groupFilter} onValueChange={setGroupFilter}>
                                    <SelectTrigger><SelectValue placeholder="Group" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Groups</SelectItem>
                                        {groupsForTableFilter.map((g) => (
                                            <SelectItem key={g.id} value={g.id}>
                                                {g.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                <Select value={officerFilter} onValueChange={setOfficerFilter}>
                                    <SelectTrigger><SelectValue placeholder="Filter by Officer" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Officers</SelectItem>
                                        {filteredOfficers.map(o => <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                
                                <Select value={statusFilter} onValueChange={setStatusFilter}>
                                    <SelectTrigger><SelectValue placeholder="Filter by Status" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="active">Active</SelectItem>
                                        <SelectItem value="delinquent">Delinquent</SelectItem>
                                        <SelectItem value="defaulted">Defaulted</SelectItem>
                                        <SelectItem value="all">Open statuses</SelectItem>
                                    </SelectContent>
                                </Select>
                                
                                <Select value={productFilter} onValueChange={setProductFilter}>
                                    <SelectTrigger><SelectValue placeholder="Filter by Product" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Products</SelectItem>
                                        {loanProducts.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>

                                <div className="min-w-[200px] md:col-span-2">
                                    <BorrowerSearchSelect 
                                        borrowers={borrowersForSelect} 
                                        value={borrowerFilter} 
                                        onChange={setBorrowerFilter}
                                        placeholder="Filter borrower…" 
                                    />
                                </div>
                                
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant={"outline"} className="justify-start text-left font-normal">
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
                              <TableRow className={excelTableRowClassName}>
                                <TableHead className={excelThClassName()}>Loan ID</TableHead>
                                <TableHead className={excelThClassName()}>Borrower</TableHead>
                                <TableHead className={excelThClassName()}>Officer</TableHead>
                                <TableHead className={excelThClassName()}>Principal</TableHead>
                                <TableHead className={excelThClassName()}>Balance</TableHead>
                                <TableHead className={excelThClassName()}>Disbursement</TableHead>
                                <TableHead className={excelThClassName()}>Status</TableHead>
                                <TableHead className={excelThClassName()}>Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredLoans.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={8} className={excelEmptyStateCellClassName}>
                                            No loans found matching filters.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                paginatedLoans.map(l => (
                                    <TableRow key={l.id} className={excelTableRowClassName}>
                                        <TableCell className={excelTdClassName()}>{l.loan_id}</TableCell>
                                        <TableCell className={excelTdClassName()}>{l.borrowers?.first_name} {l.borrowers?.surname}</TableCell>
                                        <TableCell className={excelTdClassName()}>{l.officer?.full_name}</TableCell>
                                        <TableCell className={excelTdClassName()}>{currency} {Number(l.principal).toLocaleString()}</TableCell>
                                        <TableCell className={excelTdClassName()}>{currency} {Number(l.balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                                        <TableCell className={excelTdClassName()}>{formatTZ(toZonedTime(new Date(l.disbursement_date), EAT_TIMEZONE), 'MMM dd, yyyy', { timeZone: EAT_TIMEZONE })}</TableCell>
                                        <TableCell className={excelTdClassName()}>
                                            <div className="flex items-center gap-2">
                                                <Badge variant={getStatusBadge(l.status)}>{l.status.replace(/_/g, ' ')}</Badge>
                                            </div>
                                        </TableCell>
                                        <TableCell className={excelTdClassName()}>
                                            <div className="flex items-center gap-2">
                                                <Button variant="outline" size="sm" onClick={() => viewSchedule(l)} className="flex items-center gap-2">
                                                    {isRefreshingSchedule && selectedLoan?.id === l.id ? <Loader2 className="h-4 w-4 animate-spin"/> : <Eye className="h-4 w-4"/>}
                                                    <span className="sr-only sm:not-sr-only">Schedule</span>
                                                </Button>
                                                <Button variant="ghost" size="sm" onClick={() => openStatusEdit(l)}>
                                                    <Edit className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                                )}
                            </TableBody>
                        </Table>
                        </div>
                        <TablePaginationBar
                            currentPage={currentPage}
                            setCurrentPage={setCurrentPage}
                            totalCount={filteredLoans.length}
                            pageSize={DEFAULT_TABLE_PAGE_SIZE}
                        />
                    </CardContent>
                </Card>
            </div>

            {/* Schedule Dialog */}
            <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
                <DialogContent className="max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>Repayment Schedule for {selectedLoan?.loan_id}</DialogTitle>
                        <DialogDescription>
                            Borrower: {selectedLoan?.borrowers?.first_name} {selectedLoan?.borrowers?.surname} <br/>
                            Total Payable: {currency} {(selectedLoan?.total_payable || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[60vh] overflow-y-auto">
                      <div className={excelTableWrapperClassName}>
                    <Table className={excelTableClassName}>
                        <TableHeader>
                          <TableRow className={excelTableRowClassName}>
                            <TableHead className={excelThClassName()}>#</TableHead>
                            <TableHead className={excelThClassName()}>Due Date</TableHead>
                            <TableHead className={excelThClassName()}>Amount Due</TableHead>
                            <TableHead className={excelThClassName()}>Paid</TableHead>
                            <TableHead className={excelThClassName()}>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedLoan?.schedule?.map(inst => (
                            <TableRow key={inst.installmentNumber} className={excelTableRowClassName}>
                              <TableCell className={excelTdClassName()}>{inst.installmentNumber}</TableCell>
                              <TableCell className={excelTdClassName()}>{formatTZ(toZonedTime(new Date(inst.dueDate), EAT_TIMEZONE), 'MMM dd, yyyy', { timeZone: EAT_TIMEZONE })}</TableCell>
                              <TableCell className={excelTdClassName()}>{currency} {inst.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                              <TableCell className={excelTdClassName()}>{currency} {(inst.paidAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                              <TableCell className={excelTdClassName()}><Badge variant={inst.status === 'paid' ? 'success' : inst.status === 'arrears' ? 'warning' : 'default'}>{inst.status}</Badge></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                    </Table>
                      </div>
                    </div>
                </DialogContent>
            </Dialog>

             {/* Status Edit Dialog */}
             <Dialog open={statusEditDialogOpen} onOpenChange={setStatusEditDialogOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>Edit Loan Status</DialogTitle>
                        <DialogDescription>
                            Manually change the status for Loan ID: <span className="font-semibold">{selectedLoan?.loan_id}</span>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="status" className="text-right">
                                Status
                            </Label>
                            <Select value={newStatus} onValueChange={setNewStatus}>
                                <SelectTrigger className="col-span-3">
                                    <SelectValue placeholder="Select status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="active">Active</SelectItem>
                                    <SelectItem value="paid">Paid</SelectItem>
                                    <SelectItem value="delinquent">Delinquent</SelectItem>
                                    <SelectItem value="defaulted">Defaulted</SelectItem>
                                    <SelectItem value="written_off">Written Off</SelectItem>
                                    <SelectItem value="pending_approval">Pending Approval</SelectItem>
                                    <SelectItem value="rejected">Rejected</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="submit" onClick={handleUpdateStatus} disabled={isUpdatingStatus}>
                            {isUpdatingStatus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Update Status
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </DashboardLayout>
    );
};

export default AdminLoanManagement;