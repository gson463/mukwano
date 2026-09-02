import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { format as formatTZ, toZonedTime } from 'date-fns-tz';
import { differenceInDays } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Coins, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { getManagerBranchId } from '@/lib/managerBranch';

const EAT_TIMEZONE = 'Africa/Nairobi';
const ARREARS_PAGE_SIZE = 10;

const BORROWER_ARRANGEMENT_SELECT = 'id, first_name, surname, group_id, center_id, branch_id, borrower_id, phone_number, borrower_type';

const ArrearsManagement = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [loans, setLoans] = useState([]);
    const [centers, setCenters] = useState([]);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [clearingLoanId, setClearingLoanId] = useState(null);
    const [selectedLoans, setSelectedLoans] = useState([]);
    const [currency, setCurrency] = useState('TZS');
    const { currentDate } = useDate();
    const [holidays, setHolidays] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [centerFilter, setCenterFilter] = useState('all');
    const [groupFilter, setGroupFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [currentPage, setCurrentPage] = useState(1);

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

    const fetchArrearsLoans = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        setSelectedLoans([]);

        const { data: config } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
        if (config) {
            setCurrency(config.value);
        }
        
        // Step 1: Force backend to update statuses based on Today's date
        // This ensures the DB status column is as fresh as possible
        await supabase.rpc('update_all_loan_statuses');

        const role = user.user_metadata.role;
        const { data: profileRow } = await supabase.from('users').select('branch_id').eq('id', user.id).maybeSingle();
        const branchId =
            role === 'manager'
                ? (profileRow?.branch_id ?? (await getManagerBranchId(user)))
                : (profileRow?.branch_id ?? null);

        let centersQuery = supabase
            .from('centers')
            .select('id, name, branch_id, loan_officer_id')
            .order('name');
        if (role === 'officer') {
            centersQuery = centersQuery.eq('loan_officer_id', user.id);
            if (branchId) {
                centersQuery = centersQuery.eq('branch_id', branchId);
            }
        } else if (role === 'manager' && branchId) {
            centersQuery = centersQuery.eq('branch_id', branchId);
        }

        const { data: centersData, error: centersError } = await centersQuery;
        if (centersError) {
            toast({ title: 'Error loading centres', description: centersError.message, variant: 'destructive' });
            setLoading(false);
            return;
        }
        setCenters(centersData || []);

        let groupsData = [];
        if (role === 'officer') {
            const { data, error: gErr } = await supabase
                .from('groups')
                .select('*')
                .eq('loan_officer_id', user.id);
            if (gErr) {
                toast({ title: 'Error loading groups', description: gErr.message, variant: 'destructive' });
                setLoading(false);
                return;
            }
            groupsData = data || [];
        } else if (role === 'manager') {
            const cids = (centersData || []).map((c) => c.id);
            if (cids.length) {
                const { data, error: gErr } = await supabase
                    .from('groups')
                    .select('*')
                    .in('center_id', cids);
                if (gErr) {
                    toast({ title: 'Error loading groups', description: gErr.message, variant: 'destructive' });
                    setLoading(false);
                    return;
                }
                groupsData = data || [];
            }
        } else {
            const { data, error: gErr } = await supabase.from('groups').select('*');
            if (gErr) {
                toast({ title: 'Error loading groups', description: gErr.message, variant: 'destructive' });
                setLoading(false);
                return;
            }
            groupsData = data || [];
        }
        setGroups(groupsData);

        let query = supabase
            .from('loans')
            .select(`*, borrowers(${BORROWER_ARRANGEMENT_SELECT})`);

        // Role-Based Filtering
        if (user.user_metadata.role === 'officer') {
            query = query.eq('officer_id', user.id);
        } else if (user.user_metadata.role === 'manager' && branchId) {
            const { data: officers, error: officersError } = await supabase
                .from('users')
                .select('id')
                .eq('branch_id', branchId);

            if (officersError) {
                toast({ title: 'Error fetching loan officers', description: officersError.message, variant: 'destructive' });
                setLoading(false);
                return;
            }
            const officerIds = officers.map(o => o.id);
            query = query.in('officer_id', officerIds);
        }
        
        // Step 2: Fetch Active, Delinquent, and Defaulted loans.
        // We include 'active' to catch loans that became arrears TODAY but might not have been caught by the status update yet (redundancy),
        // or simply to ensure the frontend calculator is the ultimate source of truth for display.
        query = query.in('status', ['active', 'delinquent', 'defaulted']);

        const { data, error } = await query;

        if (error) {
            toast({ title: 'Error fetching loans', description: error.message, variant: 'destructive' });
        } else {
            // Step 3: Frontend Calculation - The Source of Truth for "Current Arrears"
            const loansWithArrears = data.map(loan => {
                let arrearsAmount = 0;
                let daysInArrears = 0;
                let firstArrearsDate = null;

                if (loan.schedule) {
                    const today = toZonedTime(currentDate, EAT_TIMEZONE);
                    today.setHours(0, 0, 0, 0); // Normalize comparison date to midnight

                    loan.schedule.forEach(inst => {
                        const dueDate = toZonedTime(new Date(inst.dueDate), EAT_TIMEZONE);
                        dueDate.setHours(0, 0, 0, 0);
                        
                        // Condition 1: Due Date is strictly in the past (< today)
                        const isPastDue = dueDate < today;
                        const outstanding = (inst.amount || 0) - (inst.paidAmount || 0);

                        // Condition 2: Balance remains (> 0.01 tolerance)
                        if (isPastDue && outstanding > 0.01) {
                            arrearsAmount += outstanding;
                            
                            // Track the oldest due date for "Days in Arrears" calculation
                            if (!firstArrearsDate || dueDate < firstArrearsDate) {
                                firstArrearsDate = dueDate;
                            }
                        }
                    });

                    if (firstArrearsDate) {
                        daysInArrears = differenceInDays(today, firstArrearsDate);
                    }
                }
                return { ...loan, arrearsAmount, daysInArrears };
            })
            // Step 4: Final Filter - Only show loans that mathematically have arrears > 0
            .filter(loan => loan.arrearsAmount > 0.01); 

            setLoans(loansWithArrears);
        }
        setLoading(false);
    }, [user, toast, currentDate]);

    useEffect(() => {
        fetchArrearsLoans();
    }, [fetchArrearsLoans]);

    const handleClearArrears = async (loan) => {
        if (isHoliday(currentDate)) {
            toast({ title: 'Action Restricted', description: 'Cannot clear arrears on a public holiday.', variant: 'destructive' });
            return false;
        }

        setClearingLoanId(loan.id);
        try {
            const { error } = await supabase.functions.invoke('record-repayment', {
                body: {
                    loan_id: loan.id,
                    amount: loan.arrearsAmount,
                    officer_id: user.id,
                    actual_payment_date: formatTZ(currentDate, 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE }),
                },
            });

            if (error) throw error;
            toast({ title: 'Success', description: `Arrears for loan ${loan.loan_id} cleared.` });
            return true;
        } catch (error) {
            toast({ title: `Failed to clear arrears for ${loan.loan_id}`, description: error.message, variant: 'destructive' });
            return false;
        } finally {
            setClearingLoanId(null);
        }
    };
    
    const handleBulkClearArrears = async () => {
        if (isHoliday(currentDate)) {
            toast({ title: 'Action Restricted', description: 'Cannot clear arrears on a public holiday.', variant: 'destructive' });
            return;
        }

        setClearingLoanId('bulk');
        let successCount = 0;
        const loansToClear = loans.filter(l => selectedLoans.includes(l.id));

        for (const loan of loansToClear) {
            const success = await handleClearArrears(loan);
            if (success) {
                successCount++;
            }
        }
        
        toast({ title: 'Bulk Operation Complete', description: `${successCount} of ${selectedLoans.length} loans' arrears cleared.` });
        fetchArrearsLoans();
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
        return loans.filter((loan) => {
            const b = loan.borrowers;
            if (statusFilter !== 'all' && loan.status !== statusFilter) {
                return false;
            }
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
                (b?.borrower_id && String(b.borrower_id).toLowerCase().includes(q)) ||
                (b?.phone_number && String(b.phone_number).toLowerCase().includes(q)) ||
                String(loan.arrearsAmount ?? '').includes(q) ||
                (loan.principal != null && String(loan.principal).includes(q))
            );
        });
    }, [loans, searchQuery, centerFilter, groupFilter, statusFilter, resolveBorrowerCenterId]);

    const totalPages = Math.max(1, Math.ceil(filteredLoans.length / ARREARS_PAGE_SIZE) || 1);

    const paginatedLoans = useMemo(() => {
        const start = (currentPage - 1) * ARREARS_PAGE_SIZE;
        return filteredLoans.slice(start, start + ARREARS_PAGE_SIZE);
    }, [filteredLoans, currentPage]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, centerFilter, groupFilter, statusFilter]);

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

    const totalArrears = useMemo(
        () => filteredLoans.reduce((sum, loan) => sum + loan.arrearsAmount, 0),
        [filteredLoans],
    );
    const selectedArrearsTotal = useMemo(
        () => loans.filter((l) => selectedLoans.includes(l.id)).reduce((sum, l) => sum + l.arrearsAmount, 0),
        [loans, selectedLoans],
    );

    if (loading) {
        return <DashboardLayout title="Arrears Management"><div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div></DashboardLayout>;
    }

    return (
        <DashboardLayout title="Arrears Management">
            <div className="space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Total Portfolio in Arrears</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-3xl font-bold">{currency} {totalArrears.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-4">
                            <CardTitle>Loans in Arrears</CardTitle>
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
                                <Select value={statusFilter} onValueChange={setStatusFilter}>
                                    <SelectTrigger className="w-full min-w-0 sm:min-w-[10rem] lg:w-[11rem]">
                                        <SelectValue placeholder="Status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All statuses</SelectItem>
                                        <SelectItem value="active">Active</SelectItem>
                                        <SelectItem value="delinquent">Delinquent</SelectItem>
                                        <SelectItem value="defaulted">Defaulted</SelectItem>
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
                                        Total selected arrears: {currency}{' '}
                                        {selectedArrearsTotal.toLocaleString(undefined, {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2,
                                        })}
                                    </p>
                                </div>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button disabled={clearingLoanId === 'bulk'}>
                                            {clearingLoanId === 'bulk' ? (
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            ) : (
                                                <Coins className="mr-2 h-4 w-4" />
                                            )}
                                            Clear selected arrears
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Confirm bulk clearance</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This will clear arrears for {selectedLoans.length} selected
                                                loans, totaling {currency} {selectedArrearsTotal.toLocaleString()}.
                                                Are you sure?
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={handleBulkClearArrears}>
                                                Yes, clear arrears
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
                                        <TableHead className="font-mono border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Loan ID
                                        </TableHead>
                                        <TableHead className="min-w-[7rem] border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Borrower
                                        </TableHead>
                                        <TableHead className="border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Principal
                                        </TableHead>
                                        <TableHead className="border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            In arrears
                                        </TableHead>
                                        <TableHead className="border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Days
                                        </TableHead>
                                        <TableHead className="border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Status
                                        </TableHead>
                                        <TableHead className="min-w-[8rem] border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Actions
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
                                                <TableCell className="border border-slate-300 font-mono text-xs dark:border-slate-600">
                                                    {loan.loan_id}
                                                </TableCell>
                                                <TableCell className="border border-slate-300 dark:border-slate-600">
                                                    {loan.borrowers?.first_name} {loan.borrowers?.surname}
                                                </TableCell>
                                                <TableCell className="border border-slate-300 tabular-nums dark:border-slate-600">
                                                    {currency} {loan.principal.toLocaleString()}
                                                </TableCell>
                                                <TableCell className="border border-slate-300 font-semibold tabular-nums text-red-600 dark:border-slate-600">
                                                    {currency}{' '}
                                                    {loan.arrearsAmount.toLocaleString(undefined, {
                                                        minimumFractionDigits: 2,
                                                        maximumFractionDigits: 2,
                                                    })}
                                                </TableCell>
                                                <TableCell className="border border-slate-300 tabular-nums dark:border-slate-600">
                                                    {loan.daysInArrears}
                                                </TableCell>
                                                <TableCell className="border border-slate-300 dark:border-slate-600">
                                                    <Badge
                                                        variant={
                                                            loan.status === 'delinquent'
                                                                ? 'warning'
                                                                : loan.status === 'defaulted'
                                                                  ? 'destructive'
                                                                  : 'secondary'
                                                        }
                                                    >
                                                        {loan.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="border border-slate-300 p-1.5 dark:border-slate-600">
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                className="h-8 rounded-md"
                                                                disabled={
                                                                    clearingLoanId === loan.id ||
                                                                    selectedLoans.length > 0
                                                                }
                                                            >
                                                                {clearingLoanId === loan.id ? (
                                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                                ) : (
                                                                    <Coins className="mr-2 h-4 w-4" />
                                                                )}
                                                                Clear
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>
                                                                    Clear arrears?
                                                                </AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    This will record a payment of {currency}{' '}
                                                                    {loan.arrearsAmount.toLocaleString()} for loan{' '}
                                                                    {loan.loan_id}. Are you sure?
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                <AlertDialogAction
                                                                    onClick={() =>
                                                                        handleClearArrears(loan).then(
                                                                            fetchArrearsLoans,
                                                                        )
                                                                    }
                                                                >
                                                                    Yes, clear arrears
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
                                                colSpan={8}
                                                className="border border-slate-300 py-10 text-center text-muted-foreground dark:border-slate-600"
                                            >
                                                {loans.length === 0
                                                    ? 'No loans in arrears.'
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
                                          const from = (currentPage - 1) * ARREARS_PAGE_SIZE + 1;
                                          const to = Math.min(
                                              currentPage * ARREARS_PAGE_SIZE,
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

export default ArrearsManagement;