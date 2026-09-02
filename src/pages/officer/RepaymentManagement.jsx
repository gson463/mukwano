import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { format, parse, parseISO, startOfToday, startOfDay, endOfDay, isAfter, isToday, endOfToday } from 'date-fns';
import { format as formatTZ, toZonedTime } from 'date-fns-tz';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription as AlertDialogDesc, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger as AlertDialogTriggerComponent } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Trash2, Calendar as CalendarIcon, FileDown, Eye, Loader2, ArrowRightLeft, TrendingUp, TrendingDown, Scale, PlusCircle, Coins, Search, User, X, CheckCircle2, CalendarDays, Coins as HandCoins, ChevronLeft, ChevronRight } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import * as XLSX from 'xlsx';
import { getTodayDateString, formatRepaymentBusinessDate } from '@/utils/dateValidation';
import { getDisabledDates, isNonWorkingDay } from '@/utils/holidayUtils';
import { statCardIconWellClass } from '@/lib/utils';
import {
    getInstallmentUnitFromSchedule,
    isValidRepaymentAmount,
    repaymentAmountValidationMessage,
    REPAYMENT_AMOUNT_INVALID_FALLBACK,
} from '@/lib/repaymentInstallmentUnit.js';
import {
    normalizeWalletPrepaymentSplitMode,
    scheduledDueRpcName,
} from '@/lib/walletPrepaymentSplitMode.js';
import { storedPrepaymentAmount, storedScheduledRepaymentAmount } from '@/lib/repaymentPrepayment.js';

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

const RepaymentManagement = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [repayments, setRepayments] = useState([]);
    const [loans, setLoans] = useState([]);
    const [groups, setGroups] = useState([]);
    const [centers, setCenters] = useState([]);
    const [loanProducts, setLoanProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [repaymentsLoading, setRepaymentsLoading] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [currency, setCurrency] = useState('TZS');
    const [repaymentDialogOpen, setRepaymentDialogOpen] = useState(false);
    const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
    const [selectedLoanForSchedule, setSelectedLoanForSchedule] = useState(null);
    const [isRefreshingSchedule, setIsRefreshingSchedule] = useState(false);
    const [holidays, setHolidays] = useState([]);
    const [walletPrepaymentSplitMode, setWalletPrepaymentSplitMode] = useState('standard');
    const [pickerTotalDueOnOrBefore, setPickerTotalDueOnOrBefore] = useState(null);

    // Repayment Form State
    const [repaymentFormData, setRepaymentFormData] = useState({
        loanId: '',
        scheduled_portion: '',
        prepayment_portion: '',
        paymentDate: getTodayDateString(),
    });
    const [formErrors, setFormErrors] = useState({});

    const [selectedRepayments, setSelectedRepayments] = useState([]);

    // Filters
    const [centerFilter, setCenterFilter] = useState('all');
    const [groupFilter, setGroupFilter] = useState('all');
    const [productFilter, setProductFilter] = useState('all');
    const [loanStatusFilter, setLoanStatusFilter] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    
    // Date Range Filter (Default: Today)
    const [dateRangeFilter, setDateRangeFilter] = useState({
        from: startOfToday(),
        to: startOfToday()
    });

    const resetFilters = () => {
        setCenterFilter('all');
        setGroupFilter('all');
        setProductFilter('all');
        setLoanStatusFilter('all');
        setSearchTerm('');
        setDateRangeFilter({ from: startOfToday(), to: startOfToday() });
        setSelectedRepayments([]);
        setCurrentPage(1);
    };
    
    const resetRepaymentForm = () => {
        setRepaymentFormData({
            loanId: '',
            scheduled_portion: '',
            prepayment_portion: '',
            paymentDate: getTodayDateString(),
        });
        setFormErrors({});
        setPickerTotalDueOnOrBefore(null);
    };

    // Fetch Context Data (Loans, Groups, Config) - Only on Mount
    const fetchContextData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            await supabase.rpc('update_all_loan_statuses');
            const { data: configRows } = await supabase
                .from('system_config')
                .select('key, value')
                .in('key', ['currency', 'walletPrepaymentSplitMode']);
            for (const row of configRows || []) {
                if (row.key === 'currency') setCurrency(row.value);
                if (row.key === 'walletPrepaymentSplitMode') {
                    setWalletPrepaymentSplitMode(normalizeWalletPrepaymentSplitMode(row.value));
                }
            }

            const { data: profileRow } = await supabase.from('users').select('branch_id').eq('id', user.id).maybeSingle();
            const branchId = profileRow?.branch_id ?? null;

            let centersQuery = supabase
                .from('centers')
                .select('id, name, branch_id')
                .eq('loan_officer_id', user.id)
                .order('name');
            if (branchId) {
                centersQuery = centersQuery.eq('branch_id', branchId);
            }
            const { data: centersData, error: centersError } = await centersQuery;
            if (centersError) throw centersError;
            setCenters(centersData || []);

            let { data: loansData, error: loansError } = await supabase
                .from('loans')
                .select('*, borrowers(*, groups(*))')
                .eq('officer_id', user.id);
            if (loansError) throw loansError;
            setLoans(loansData || []);

            const { data: groupsData, error: groupsError } = await supabase.from('groups').select('*').eq('loan_officer_id', user.id);
            if (groupsError) throw groupsError;
            setGroups(groupsData || []);

            const { data: productsData, error: productsError } = await supabase
                .from('loan_products')
                .select('id, name')
                .eq('status', 'active');
            if (productsError) throw productsError;
            setLoanProducts(productsData || []);

            const { data: holidaysData, error: holidaysError } = await supabase.from('holidays').select('date');
            if (holidaysError) {
                console.warn('holidays', holidaysError);
            }
            setHolidays(holidaysData || []);
        } catch (error) {
            toast({ title: 'Error fetching context data', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [user, toast]);

    // Fetch Repayments - Triggered by Date Change
    const fetchRepayments = useCallback(async () => {
        if (!user) return;
        setRepaymentsLoading(true);
        try {
            let query = supabase
                .from('repayments')
                .select(
                    '*, loans(id, borrower_id, schedule, loan_id, product_id, status, borrowers(*, groups(*)))'
                )
                .eq('officer_id', user.id)
                .order('actual_payment_date', { ascending: false });

            // Apply Date Filters at Database Level
            if (dateRangeFilter?.from) {
                query = query.gte('actual_payment_date', format(dateRangeFilter.from, 'yyyy-MM-dd'));
                
                if (dateRangeFilter.to) {
                     query = query.lte('actual_payment_date', format(dateRangeFilter.to, 'yyyy-MM-dd'));
                } else {
                     // If 'to' is undefined (single day selection), treat 'from' as single day filter
                     query = query.lte('actual_payment_date', format(dateRangeFilter.from, 'yyyy-MM-dd'));
                }
            }

            const { data, error } = await query;
            if (error) throw error;
            setRepayments(data || []);

        } catch (error) {
            toast({ title: 'Error fetching repayments', description: error.message, variant: 'destructive' });
        } finally {
            setRepaymentsLoading(false);
        }
    }, [user, toast, dateRangeFilter]);

    // Initial Load
    useEffect(() => {
        fetchContextData();
    }, [fetchContextData]);

    useEffect(() => {
        if (!repaymentDialogOpen) return;
        setRepaymentFormData((prev) => ({ ...prev, paymentDate: getTodayDateString() }));
    }, [repaymentDialogOpen]);

    useEffect(() => {
        const loanId = repaymentFormData.loanId;
        if (!loanId) {
            setPickerTotalDueOnOrBefore(null);
            return;
        }
        const loan = loans.find((l) => l.id === loanId);
        if (!loan) {
            setPickerTotalDueOnOrBefore(null);
            return;
        }
        const payStr = getTodayDateString();
        const dueRpc = scheduledDueRpcName(walletPrepaymentSplitMode);
        let cancelled = false;
        (async () => {
            const { data, error } = await supabase.rpc(dueRpc, {
                p_schedule: loan.schedule ?? null,
                p_payment_date: payStr,
            });
            if (cancelled) return;
            if (error) {
                setPickerTotalDueOnOrBefore(null);
                return;
            }
            setPickerTotalDueOnOrBefore(Number(data ?? 0));
        })();
        return () => {
            cancelled = true;
        };
    }, [repaymentFormData.loanId, loans, walletPrepaymentSplitMode]);

    const repaymentFormTotal = useMemo(() => {
        const s = parseFloat(String(repaymentFormData.scheduled_portion || '').replace(/,/g, '')) || 0;
        const p = parseFloat(String(repaymentFormData.prepayment_portion || '').replace(/,/g, '')) || 0;
        return s + p;
    }, [repaymentFormData.scheduled_portion, repaymentFormData.prepayment_portion]);

    const pickerInstallmentUnit = useMemo(() => {
        const loan = loans.find((l) => l.id === repaymentFormData.loanId);
        return loan ? getInstallmentUnitFromSchedule(loan.schedule) : null;
    }, [repaymentFormData.loanId, loans]);

    // React to Date Changes
    useEffect(() => {
        fetchRepayments();
    }, [fetchRepayments]);

    const groupsForTableFilter = useMemo(() => {
        if (centerFilter === 'all') return groups;
        return groups.filter((g) => g.center_id === centerFilter);
    }, [groups, centerFilter]);

    const groupsInSelectedCenterFilter = useMemo(() => {
        if (centerFilter === 'all') return [];
        return groups.filter((g) => g.center_id === centerFilter);
    }, [groups, centerFilter]);

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
    }, [
        repayments,
        centerFilter,
        groupFilter,
        productFilter,
        loanStatusFilter,
        searchTerm,
        resolveBorrowerCenterId,
    ]);

    const totalPages = Math.max(1, Math.ceil(filteredRepayments.length / REPAYMENT_PAGE_SIZE) || 1);

    const paginatedRepayments = useMemo(() => {
        const start = (currentPage - 1) * REPAYMENT_PAGE_SIZE;
        return filteredRepayments.slice(start, start + REPAYMENT_PAGE_SIZE);
    }, [filteredRepayments, currentPage]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, centerFilter, groupFilter, productFilter, loanStatusFilter, dateRangeFilter]);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);
    
    const stats = useMemo(() => {
        const totalPaid = filteredRepayments.reduce((sum, r) => sum + r.amount, 0);
        const totalInterest = filteredRepayments.reduce((sum, r) => sum + (r.interest_paid || 0), 0);
        const totalPrincipalPaid = filteredRepayments.reduce((sum, r) => sum + (r.principal_paid || 0), 0);
        
        // Calculate outstanding principal for all active loans to give context
        const relevantLoans = loans.filter(l => ['active', 'delinquent', 'defaulted'].includes(l.status));
        
        let totalOutstandingPrincipal = relevantLoans.reduce((sum, loan) => {
             const principalPaid = loan.schedule?.reduce((s, i) => s + (i.principalPaid || 0), 0) || 0;
             return sum + (loan.principal - principalPaid);
        }, 0);

        return { totalPaid, totalInterest, totalPrincipalPaid, totalOutstandingPrincipal };
    }, [filteredRepayments, loans]);

    const canRecordRepayment = useMemo(() => {
        const todayYmd = getTodayDateString();
        const { loanId } = repaymentFormData;
        if (!loanId || repaymentFormTotal <= 0) return false;
        if (isNonWorkingDay(todayYmd, holidays)) return false;
        const selectedLoan = loans.find((l) => l.id === loanId);
        if (!selectedLoan) return false;
        if (repaymentFormTotal > selectedLoan.balance) return false;
        if (selectedLoan.disbursement_date && todayYmd < selectedLoan.disbursement_date) return false;
        return true;
    }, [repaymentFormData, loans, holidays, repaymentFormTotal]);

    const handleViewSchedule = async (loan) => {
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

            setSelectedLoanForSchedule(latestLoanData);
            setScheduleDialogOpen(true);
        } catch (error) {
            console.error(error);
            toast({ title: 'Error', description: 'Could not refresh schedule data.', variant: 'destructive' });
        } finally {
            setIsRefreshingSchedule(false);
        }
    };

    const handleDateRangeSelect = (range) => {
        // Allow updating state even if incomplete range
        if (!range) {
             setDateRangeFilter({ from: undefined, to: undefined });
             return;
        }
        setDateRangeFilter(range);
    }

    const validateForm = () => {
        const errors = {};
        const { loanId, scheduled_portion, prepayment_portion } = repaymentFormData;
        const schedNum = parseFloat(String(scheduled_portion || '').replace(/,/g, '')) || 0;
        const prepNum = parseFloat(String(prepayment_portion || '').replace(/,/g, '')) || 0;
        const total = schedNum + prepNum;

        if (!loanId) errors.loanId = 'Please select a loan.';
        if (total <= 0) errors.total = 'Enter scheduled repayment and/or prepayment (total must be greater than zero).';
        if (schedNum < 0 || prepNum < 0) errors.total = 'Amounts must be non-negative.';

        const todayYmd = getTodayDateString();
        if (isNonWorkingDay(todayYmd, holidays)) {
            errors.paymentDate =
                'Today (EAT) is not a working day (Sunday or public holiday). You cannot record a repayment today.';
        }

        const selectedLoan = loans.find((l) => l.id === loanId);
        if (selectedLoan) {
            if (total > selectedLoan.balance) {
                errors.total = `Total cannot exceed outstanding balance (${currency} ${selectedLoan.balance.toLocaleString()})`;
            }
            if (selectedLoan.disbursement_date && todayYmd < selectedLoan.disbursement_date) {
                errors.paymentDate = `Repayment date cannot be before the loan disbursement date (${selectedLoan.disbursement_date})`;
            }
            const unit = getInstallmentUnitFromSchedule(selectedLoan.schedule);
            const due = Number(pickerTotalDueOnOrBefore ?? 0);
            if (total > 0 && !isValidRepaymentAmount(total, due, unit)) {
                errors.total =
                    repaymentAmountValidationMessage(total, due, unit, currency) ||
                    REPAYMENT_AMOUNT_INVALID_FALLBACK;
            }
        }

        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleRecordRepayment = async () => {
        if (!validateForm()) return;
        const pd = getTodayDateString();
        if (isNonWorkingDay(pd, holidays)) {
            toast({
                title: 'Invalid date',
                description:
                    "Repayments are recorded for today's business date (EAT) only, on working days. Not for past, future, Sunday, or holidays.",
                variant: 'destructive',
            });
            return;
        }

        setIsSubmitting(true);
        const { loanId, scheduled_portion, prepayment_portion } = repaymentFormData;
        const schedNum = parseFloat(String(scheduled_portion || '').replace(/,/g, '')) || 0;
        const prepNum = parseFloat(String(prepayment_portion || '').replace(/,/g, '')) || 0;
        const total = schedNum + prepNum;
        const recordedOn = getTodayDateString();

        const { data, error } = await supabase.functions.invoke('record-repayment', {
            body: {
                loan_id: loanId,
                amount: total,
                scheduled_portion: schedNum,
                prepayment_portion: prepNum,
                wallet_split_explicit: true,
                actual_payment_date: recordedOn,
            },
        });

        const apiError = error?.message || data?.error;
        if (apiError) {
            toast({ title: 'Repayment Failed', description: String(apiError), variant: 'destructive' });
        } else {
            const selectedLoan = loans.find((l) => l.id === loanId);
            const borrowerName = selectedLoan
                ? `${selectedLoan.borrowers.first_name} ${selectedLoan.borrowers.surname}`
                : 'Borrower';

            toast({
                title: 'Repayment Recorded!',
                description: (
                    <div className="flex flex-col gap-1">
                        <p>
                            Scheduled: <strong>{currency} {schedNum.toLocaleString()}</strong>
                            {prepNum > 0 ? (
                                <>
                                    {' '}
                                    · Prepayment: <strong>{currency} {prepNum.toLocaleString()}</strong>
                                </>
                            ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            For: {borrowerName} on {format(parse(recordedOn, 'yyyy-MM-dd', new Date()), 'MMM dd, yyyy')}
                        </p>
                    </div>
                ),
                className: 'bg-green-50 border-green-200',
            });
            setRepaymentDialogOpen(false);
            resetRepaymentForm();
            fetchRepayments();
            fetchContextData();
        }
        setIsSubmitting(false);
    };

    const handleDelete = async (repaymentId) => {
        try {
            const repayment = repayments.find(r => r.id === repaymentId);
            if (!repayment) throw new Error("Repayment not found");

            const { error: deleteError } = await supabase.from('repayments').delete().eq('id', repaymentId);
            if (deleteError) throw deleteError;
            
            await supabase.rpc('recalculate_loan_schedule', { p_loan_id: repayment.loan_id });
            await supabase.rpc('update_all_loan_statuses');

            toast({ title: 'Success', description: 'Repayment deleted successfully.' });
            fetchRepayments();
            fetchContextData();
        } catch (error) {
            toast({ title: 'Error deleting repayment', description: error.message, variant: 'destructive' });
        }
    };

    const handleBulkDelete = async () => {
        setIsSubmitting(true);
        try {
            const repaymentsToDelete = repayments.filter(r => selectedRepayments.includes(r.id));
            const affectedLoanIds = [...new Set(repaymentsToDelete.map(r => r.loan_id))];

            const { error } = await supabase.from('repayments').delete().in('id', selectedRepayments);
            if (error) throw error;

            for (const loanId of affectedLoanIds) {
                await supabase.rpc('recalculate_loan_schedule', { p_loan_id: loanId });
            }
            await supabase.rpc('update_all_loan_statuses');

            toast({ title: 'Success', description: `${selectedRepayments.length} repayments deleted successfully.` });
            setSelectedRepayments([]);
            fetchRepayments();
            fetchContextData();
        } catch (error) {
            toast({ title: 'Error deleting repayments', description: error.message, variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleExport = (loan) => {
        if (!loan || !loan.borrowers) {
            toast({ title: 'Error', description: 'Cannot export, loan data is incomplete.', variant: 'destructive' });
            return;
        }

        const borrower = loan.borrowers;
        const group = borrower.groups;

        const summaryData = [
            { 'Field': 'Borrower Name', 'Value': `${borrower.first_name} ${borrower.surname}` },
            { 'Field': 'Borrower ID', 'Value': borrower.borrower_id },
            { 'Field': 'Phone Number', 'Value': borrower.phone_number },
            { 'Field': 'Group', 'Value': group ? group.name : 'N/A' },
            { 'Field': 'Loan ID', 'Value': loan.loan_id },
            { 'Field': 'Principal Amount', 'Value': loan.principal, 'Format': 'currency' },
            { 'Field': 'Total Payable', 'Value': loan.total_payable, 'Format': 'currency' },
            { 'Field': 'Outstanding Balance', 'Value': loan.balance, 'Format': 'currency' },
            { 'Field': 'Loan Status', 'Value': loan.status },
        ];

        const scheduleData = loan.schedule.map(inst => ({
            'Installment No.': inst.installmentNumber,
            'Due Date': formatTZ(toZonedTime(new Date(inst.dueDate), EAT_TIMEZONE), 'yyyy-MM-dd'),
            'Amount Due': inst.amount,
            'Principal Component': inst.principalComponent,
            'Interest Component': inst.interestComponent,
            'Amount Paid': inst.paidAmount || 0,
            'Principal Paid': inst.principalPaid || 0,
            'Interest Paid': inst.interestPaid || 0,
            'Balance': inst.amount - (inst.paidAmount || 0),
            'Status': inst.status,
        }));

        const repaymentsForLoan = repayments.filter(r => r.loan_id === loan.id).map(r => ({
            'Payment Date': formatRepaymentBusinessDate(r.actual_payment_date, 'yyyy-MM-dd'),
            'Principal Paid': r.principal_paid,
            'Interest Paid': r.interest_paid,
            'Total Amount': r.amount,
        }));
        
        const wb = XLSX.utils.book_new();
        const wsSummary = XLSX.utils.json_to_sheet(summaryData, { skipHeader: true });
        XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
        const wsSchedule = XLSX.utils.json_to_sheet(scheduleData);
        XLSX.utils.book_append_sheet(wb, wsSchedule, 'Repayment Schedule');
        const wsRepayments = XLSX.utils.json_to_sheet(repaymentsForLoan);
        XLSX.utils.book_append_sheet(wb, wsRepayments, 'Payments Made');
        XLSX.writeFile(wb, `statement_${borrower.first_name}_${borrower.surname}_${loan.loan_id}.xlsx`);
    };

    const activeLoanOptions = useMemo(() =>
      loans
        .filter(l => ['active', 'delinquent', 'defaulted'].includes(l.status))
        .sort((a, b) => {
             const nameA = `${a.borrowers.first_name} ${a.borrowers.surname}`;
             const nameB = `${b.borrowers.first_name} ${b.borrowers.surname}`;
             return nameA.localeCompare(nameB);
        })
        .map(l => ({
          id: l.id,
          label: `${l.borrowers.first_name} ${l.borrowers.surname} • ${l.loan_id}`,
          balance: l.balance
        })),
      [loans]
    );

    const allOnPageSelected =
        paginatedRepayments.length > 0 &&
        paginatedRepayments.every((r) => selectedRepayments.includes(r.id));

    const handleSelectAllPage = (checked) => {
        const pageIds = paginatedRepayments.map((r) => r.id);
        if (checked) {
            setSelectedRepayments((prev) => [...new Set([...prev, ...pageIds])]);
        } else {
            setSelectedRepayments((prev) => prev.filter((id) => !pageIds.includes(id)));
        }
    };

    const handleSelectOne = (repaymentId, checked) => {
        if (checked) {
            setSelectedRepayments(prev => [...prev, repaymentId]);
        } else {
            setSelectedRepayments(prev => prev.filter(id => id !== repaymentId));
        }
    };

    if (loading && !loans.length) return <DashboardLayout><Loader2 className="h-8 w-8 animate-spin mx-auto mt-8" /></DashboardLayout>;

    return (
        <DashboardLayout title="Repayment Management">
            <div className="space-y-6">
                 {/* Header & Action */}
                 <div className="flex flex-wrap items-center justify-end gap-4">
                    <Dialog open={repaymentDialogOpen} onOpenChange={(open) => {
                        setRepaymentDialogOpen(open);
                        if(open) resetRepaymentForm();
                    }}>
                        <DialogTrigger asChild>
                            <Button className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90 hover:shadow-lg transition-all duration-300 transform hover:scale-105">
                                <PlusCircle className="mr-2 h-4 w-4" /> Record Repayment
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-xl p-0 overflow-hidden rounded-2xl border-0 shadow-2xl">
                             {/* Gradient Hero Header */}
                            <div className="bg-gradient-to-br from-emerald-700 via-green-800 to-emerald-950 p-8 text-white relative overflow-hidden">
                                 <div className="absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>
                                 <div className="relative z-10 flex items-center gap-3">
                                    <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm">
                                        <HandCoins className="h-6 w-6 text-white" />
                                    </div>
                                    <div>
                                        <DialogTitle className="text-2xl font-bold tracking-tight">Record New Repayment</DialogTitle>
                                        <DialogDescription className="text-white/80 text-sm leading-relaxed">
                                            Repayments are posted for{' '}
                                            <strong className="text-white/95">{"today's date (EAT) only"}</strong>
                                            {'. '}Past and future dates are not available. You cannot record on Sundays
                                            or public holidays.
                                        </DialogDescription>
                                    </div>
                                 </div>
                            </div>

                             {/* Form Content */}
                             <div className="p-8 space-y-6 bg-white">
                                {/* Loan Selection */}
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                                        <User className="w-4 h-4 text-primary" />
                                        Select Loan Account *
                                    </Label>
                                    <Select 
                                        value={repaymentFormData.loanId} 
                                        onValueChange={(val) => {
                                            setRepaymentFormData({ ...repaymentFormData, loanId: val });
                                            setFormErrors({...formErrors, loanId: null});
                                        }}
                                    >
                                        <SelectTrigger className={`w-full h-11 ${formErrors.loanId ? 'border-red-500 ring-red-200' : 'border-gray-200 focus:ring-2 focus:ring-primary/20 focus:border-primary'}`}>
                                            <SelectValue placeholder="Select Loan..." />
                                        </SelectTrigger>
                                        <SelectContent className="max-h-60">
                                            {activeLoanOptions.length > 0 ? activeLoanOptions.map(l => (
                                                <SelectItem key={l.id} value={l.id} className="cursor-pointer py-3">
                                                    <div className="flex flex-col">
                                                        <span className="font-medium text-gray-900">{l.label}</span>
                                                        <span className="text-xs text-gray-500">Balance: {currency} {l.balance.toLocaleString()}</span>
                                                    </div>
                                                </SelectItem>
                                            )) : (
                                                <div className="p-4 text-center text-sm text-gray-500">No active loans found.</div>
                                            )}
                                        </SelectContent>
                                    </Select>
                                    {formErrors.loanId && <p className="text-xs text-red-500 font-medium animate-in fade-in slide-in-from-top-1">{formErrors.loanId}</p>}
                                </div>

                                {/* Scheduled repayment */}
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                                        <Coins className="w-4 h-4 text-yellow-500" />
                                        Scheduled repayment ({currency})
                                    </Label>
                                    <p className="text-xs text-muted-foreground">
                                        Overdue balance and today&apos;s installment due on the payment date.
                                        {pickerTotalDueOnOrBefore != null
                                            ? ` Amount due: ${currency} ${Number(pickerTotalDueOnOrBefore).toLocaleString()}.`
                                            : ''}
                                    </p>
                                    <Input
                                        type="number"
                                        value={repaymentFormData.scheduled_portion}
                                        onChange={(e) => {
                                            setRepaymentFormData({ ...repaymentFormData, scheduled_portion: e.target.value });
                                            setFormErrors({ ...formErrors, total: null });
                                        }}
                                        placeholder="0.00"
                                        className={`h-11 text-lg font-medium transition-all ${formErrors.total ? 'border-red-500 ring-red-200' : 'border-gray-200 focus:ring-yellow-200 focus:border-yellow-500'}`}
                                        min="0"
                                    />
                                </div>

                                {/* Prepayment */}
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                                        <TrendingUp className="w-4 h-4 text-emerald-600" />
                                        Prepayment ({currency})
                                    </Label>
                                    <p className="text-xs text-muted-foreground">
                                        Advance payment applied to upcoming installments, starting with the next due date.
                                        Fully prepaid days are excluded from Group Repayment.
                                    </p>
                                    <Input
                                        type="number"
                                        value={repaymentFormData.prepayment_portion}
                                        onChange={(e) => {
                                            setRepaymentFormData({ ...repaymentFormData, prepayment_portion: e.target.value });
                                            setFormErrors({ ...formErrors, total: null });
                                        }}
                                        placeholder="0.00"
                                        className={`h-11 text-lg font-medium transition-all ${formErrors.total ? 'border-red-500 ring-red-200' : 'border-gray-200 focus:ring-emerald-200 focus:border-emerald-500'}`}
                                        min="0"
                                    />
                                </div>

                                {/* Total */}
                                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-semibold text-gray-700">Total repayment</span>
                                        <span className="text-lg font-bold text-gray-900">
                                            {currency}{' '}
                                            {repaymentFormTotal.toLocaleString(undefined, {
                                                minimumFractionDigits: 2,
                                                maximumFractionDigits: 2,
                                            })}
                                        </span>
                                    </div>
                                    {pickerInstallmentUnit != null && (
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            Installment unit: {currency}{' '}
                                            {pickerInstallmentUnit.toLocaleString(undefined, {
                                                minimumFractionDigits: 2,
                                                maximumFractionDigits: 2,
                                            })}
                                        </p>
                                    )}
                                </div>
                                {formErrors.total && (
                                    <p className="text-xs text-red-500 font-medium animate-in fade-in slide-in-from-top-1">
                                        {formErrors.total}
                                    </p>
                                )}

                                {/* Payment business date = today (EAT) only — not editable */}
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                                        <CalendarDays className="w-4 h-4 text-purple-500" />
                                        Payment date (today, EAT)
                                    </Label>
                                    <div
                                        className={`rounded-md border bg-muted/40 px-3 py-2.5 text-sm ${formErrors.paymentDate ? 'border-red-500' : 'border-border'}`}
                                    >
                                        <p className="font-medium text-foreground">
                                            {format(parse(getTodayDateString(), 'yyyy-MM-dd', new Date()), 'EEEE, MMMM d, yyyy')}
                                        </p>
                                    </div>
                                    {formErrors.paymentDate && <p className="text-xs text-red-500 font-medium animate-in fade-in slide-in-from-top-1">{formErrors.paymentDate}</p>}
                                </div>

                                <div className="flex gap-3 pt-4">
                                    <Button variant="outline" className="flex-1 h-11" onClick={() => resetRepaymentForm()}>Reset</Button>
                                    <Button 
                                        className="flex-[2] h-11 bg-primary text-primary-foreground shadow-lg enabled:hover:bg-primary/90 enabled:hover:shadow-xl transition-all disabled:opacity-50"
                                        onClick={handleRecordRepayment}
                                        disabled={isSubmitting || !canRecordRepayment}
                                    >
                                        {isSubmitting ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Processing...</> : <><CheckCircle2 className="mr-2 h-5 w-5" /> Confirm Payment</>}
                                    </Button>
                                </div>
                             </div>
                        </DialogContent>
                    </Dialog>
                </div>

                {/* Stats */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <StatCard title="Total Repayments" value={`${currency} ${stats.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={ArrowRightLeft} color="text-primary" />
                    <StatCard title="Interest Collected" value={`${currency} ${stats.totalInterest.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={TrendingUp} color="text-green-600" />
                    <StatCard title="Principal Returned" value={`${currency} ${stats.totalPrincipalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={TrendingDown} color="text-orange-600" />
                    <StatCard title="Outstanding Portfolio" value={`${currency} ${stats.totalOutstandingPrincipal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={Scale} color="text-red-600" />
                </div>

                {/* Main Content Area: History & Filters */}
                <Card className="border-none shadow-md overflow-hidden bg-white">
                    <CardHeader className="bg-gray-50/50 border-b border-gray-100 pb-4">
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
                             <div>
                                <CardTitle className="text-xl font-bold text-gray-800">Repayment History</CardTitle>
                                <CardDescription>
                                    Showing payments from <span className="font-semibold text-primary">
                                        {dateRangeFilter?.from 
                                            ? (dateRangeFilter.to ? (
                                                isToday(dateRangeFilter.from) && isToday(dateRangeFilter.to) ? "Today" : `${format(dateRangeFilter.from, "LLL dd, y")} to ${format(dateRangeFilter.to, "LLL dd, y")}`
                                              ) : format(dateRangeFilter.from, "LLL dd, y"))
                                            : 'Select a Date Range'
                                        }
                                    </span>
                                </CardDescription>
                             </div>
                             {selectedRepayments.length > 0 && (
                                <AlertDialog>
                                    <AlertDialogTriggerComponent asChild>
                                        <Button variant="destructive" size="sm" className="shadow-sm">
                                            <Trash2 className="mr-2 h-4 w-4" /> Delete Selected ({selectedRepayments.length})
                                        </Button>
                                    </AlertDialogTriggerComponent>
                                    <AlertDialogContent>
                                        <AlertDialogHeader><AlertDialogTitle>Delete Repayments?</AlertDialogTitle><AlertDialogDesc>This will remove the selected payments and recalculate balances. Irreversible.</AlertDialogDesc></AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={handleBulkDelete}>Yes, delete</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                             )}
                        </div>

                        <div className="flex w-full flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-end">
                            <div className="min-w-0 flex-1 lg:min-w-[12rem]">
                                <div className="relative">
                                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Search loan ID, name, phone, amount…"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
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
                                        placeholder={centerFilter === 'all' ? 'Select centre first' : 'Group'}
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
                            <Select value={productFilter} onValueChange={setProductFilter}>
                                <SelectTrigger className="w-full min-w-0 sm:min-w-[10rem] lg:w-[12rem]">
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
                                <SelectTrigger className="w-full min-w-0 sm:min-w-[10rem] lg:w-[12rem]">
                                    <SelectValue placeholder="Loan status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All loan statuses</SelectItem>
                                    <SelectItem value="active">Active</SelectItem>
                                    <SelectItem value="delinquent">Delinquent</SelectItem>
                                    <SelectItem value="defaulted">Defaulted</SelectItem>
                                    <SelectItem value="paid">Paid</SelectItem>
                                    <SelectItem value="edit_requested">Edit requested</SelectItem>
                                    <SelectItem value="delete_requested">Delete requested</SelectItem>
                                </SelectContent>
                            </Select>
                            <div className="w-full min-w-0 sm:w-auto lg:min-w-[16rem]">
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            className="w-full justify-start text-left font-normal"
                                        >
                                            <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                                            <span className="truncate">
                                                {dateRangeFilter?.from ? (
                                                    dateRangeFilter.to ? (
                                                        isToday(dateRangeFilter.from) && isToday(dateRangeFilter.to) ? (
                                                            'Today'
                                                        ) : (
                                                            <>
                                                                {format(dateRangeFilter.from, 'LLL dd, y')} –{' '}
                                                                {format(dateRangeFilter.to, 'LLL dd, y')}
                                                            </>
                                                        )
                                                    ) : (
                                                        format(dateRangeFilter.from, 'LLL dd, y')
                                                    )
                                                ) : (
                                                    <span className="text-muted-foreground">Payment date range</span>
                                                )}
                                            </span>
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                        <Calendar
                                            mode="range"
                                            selected={dateRangeFilter}
                                            onSelect={handleDateRangeSelect}
                                            numberOfMonths={2}
                                            disabled={[
                                                ...getDisabledDates(),
                                                (date) => isAfter(date, endOfToday()),
                                            ]}
                                        />
                                    </PopoverContent>
                                </Popover>
                            </div>
                            <Button
                                type="button"
                                onClick={resetFilters}
                                variant="outline"
                                className="w-full sm:w-auto"
                            >
                                <X className="mr-2 h-4 w-4" /> Reset
                            </Button>
                        </div>
                    </CardHeader>
                    
                    <CardContent>
                        <div className="overflow-x-auto rounded-md border border-slate-300 bg-white shadow-sm dark:border-slate-600 dark:bg-card">
                            <Table className="border-collapse border-0 text-sm">
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="w-10 min-w-8 border border-slate-300 bg-slate-100 px-1 py-2 dark:border-slate-600 dark:bg-slate-800/90">
                                            <Checkbox
                                                checked={allOnPageSelected}
                                                onCheckedChange={handleSelectAllPage}
                                                disabled={paginatedRepayments.length === 0 || repaymentsLoading}
                                                aria-label="Select all on this page"
                                            />
                                        </TableHead>
                                        <TableHead className="min-w-[6rem] border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Payment date
                                        </TableHead>
                                        <TableHead className="min-w-[9rem] border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Borrower
                                        </TableHead>
                                        <TableHead className="border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Principal
                                        </TableHead>
                                        <TableHead className="border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Interest
                                        </TableHead>
                                        <TableHead className="border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Total
                                        </TableHead>
                                        <TableHead className="border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Scheduled
                                        </TableHead>
                                        <TableHead className="border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Prepayment
                                        </TableHead>
                                        <TableHead className="min-w-[7rem] border border-slate-300 bg-slate-100 px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Actions
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {repaymentsLoading ? (
                                        <TableRow>
                                            <TableCell
                                                colSpan={9}
                                                className="h-48 border border-slate-300 text-center text-muted-foreground dark:border-slate-600"
                                            >
                                                <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                                                <p className="mt-2">Loading repayments…</p>
                                            </TableCell>
                                        </TableRow>
                                    ) : paginatedRepayments.length > 0 ? (
                                        paginatedRepayments.map((r) => (
                                            <TableRow
                                                key={r.id}
                                                className="border-slate-200 dark:border-slate-700"
                                            >
                                                <TableCell className="border border-slate-300 px-1 py-1.5 dark:border-slate-600">
                                                    <Checkbox
                                                        checked={selectedRepayments.includes(r.id)}
                                                        onCheckedChange={(checked) =>
                                                            handleSelectOne(r.id, checked)
                                                        }
                                                    />
                                                </TableCell>
                                                <TableCell className="border border-slate-300 text-xs tabular-nums dark:border-slate-600">
                                                    {formatRepaymentBusinessDate(r.actual_payment_date)}
                                                </TableCell>
                                                <TableCell className="border border-slate-300 dark:border-slate-600">
                                                    <div className="flex flex-col">
                                                        <span className="font-medium text-foreground">
                                                            {r.loans?.borrowers?.first_name} {r.loans?.borrowers?.surname}
                                                        </span>
                                                        <span className="font-mono text-xs text-muted-foreground">
                                                            {r.loans?.loan_id}
                                                        </span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="border border-slate-300 tabular-nums dark:border-slate-600">
                                                    {currency}{' '}
                                                    {(r.principal_paid || 0).toLocaleString(undefined, {
                                                        minimumFractionDigits: 2,
                                                    })}
                                                </TableCell>
                                                <TableCell className="border border-slate-300 tabular-nums dark:border-slate-600">
                                                    {currency}{' '}
                                                    {(r.interest_paid || 0).toLocaleString(undefined, {
                                                        minimumFractionDigits: 2,
                                                    })}
                                                </TableCell>
                                                <TableCell className="border border-slate-300 dark:border-slate-600">
                                                    <Badge
                                                        variant="outline"
                                                        className="bg-green-50 font-semibold text-green-800 border-green-200 dark:bg-green-950/40 dark:text-green-100"
                                                    >
                                                        {currency}{' '}
                                                        {r.amount.toLocaleString(undefined, {
                                                            minimumFractionDigits: 2,
                                                        })}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="border border-slate-300 tabular-nums dark:border-slate-600">
                                                    {currency}{' '}
                                                    {storedScheduledRepaymentAmount(r).toLocaleString(undefined, {
                                                        minimumFractionDigits: 2,
                                                    })}
                                                </TableCell>
                                                <TableCell className="border border-slate-300 tabular-nums dark:border-slate-600">
                                                    {currency}{' '}
                                                    {storedPrepaymentAmount(r).toLocaleString(undefined, {
                                                        minimumFractionDigits: 2,
                                                    })}
                                                </TableCell>
                                                <TableCell className="border border-slate-300 p-1.5 text-right dark:border-slate-600">
                                                    <div className="flex flex-nowrap items-center justify-end gap-1">
                                                        <AlertDialog>
                                                            <AlertDialogTriggerComponent asChild>
                                                                <Button
                                                                    variant="outline"
                                                                    size="icon"
                                                                    className="h-8 w-8 shrink-0 rounded-md"
                                                                    title="Delete payment"
                                                                >
                                                                    <Trash2 className="h-4 w-4" />
                                                                </Button>
                                                            </AlertDialogTriggerComponent>
                                                            <AlertDialogContent>
                                                                <AlertDialogHeader>
                                                                    <AlertDialogTitle>Delete payment?</AlertDialogTitle>
                                                                    <AlertDialogDesc>
                                                                        This action cannot be undone.
                                                                    </AlertDialogDesc>
                                                                </AlertDialogHeader>
                                                                <AlertDialogFooter>
                                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                    <AlertDialogAction
                                                                        onClick={() => handleDelete(r.id)}
                                                                    >
                                                                        Delete
                                                                    </AlertDialogAction>
                                                                </AlertDialogFooter>
                                                            </AlertDialogContent>
                                                        </AlertDialog>
                                                        <Button
                                                            variant="outline"
                                                            size="icon"
                                                            className="h-8 w-8 shrink-0 rounded-md"
                                                            onClick={() => handleViewSchedule(r.loans)}
                                                            title="View schedule"
                                                        >
                                                            <Eye className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            variant="outline"
                                                            size="icon"
                                                            className="h-8 w-8 shrink-0 rounded-md"
                                                            onClick={() => handleExport(r.loans)}
                                                            title="Export"
                                                        >
                                                            <FileDown className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell
                                                colSpan={9}
                                                className="h-40 border border-slate-300 text-center text-muted-foreground dark:border-slate-600"
                                            >
                                                <div className="flex flex-col items-center justify-center gap-2">
                                                    <Search className="h-8 w-8 text-muted-foreground/50" />
                                                    <p>
                                                        No repayments found for the selected period and
                                                        filters.
                                                    </p>
                                                    <Button variant="link" onClick={resetFilters}>
                                                        Reset to today
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                        <div className="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-sm text-muted-foreground">
                                {repaymentsLoading
                                    ? '—'
                                    : filteredRepayments.length === 0
                                      ? 'Showing 0 of 0'
                                      : (() => {
                                            const from = (currentPage - 1) * REPAYMENT_PAGE_SIZE + 1;
                                            const to = Math.min(
                                                currentPage * REPAYMENT_PAGE_SIZE,
                                                filteredRepayments.length,
                                            );
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
              <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Repayment Schedule</DialogTitle>
                    <DialogDescription>
                        Details for Loan: <span className="font-semibold text-gray-900">{selectedLoanForSchedule?.loan_id}</span>
                    </DialogDescription>
                </DialogHeader>
                {selectedLoanForSchedule && (
                    <div className="overflow-y-auto flex-1 border rounded-md">
                        <Table>
                            <TableHeader className="sticky top-0 bg-white z-10 shadow-sm">
                                <TableRow>
                                    <TableHead className="w-[50px]">#</TableHead>
                                    <TableHead>Due Date</TableHead>
                                    <TableHead>Expected</TableHead>
                                    <TableHead>Paid (Princ/Int)</TableHead>
                                    <TableHead>Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {selectedLoanForSchedule.schedule.map(inst => (
                                    <TableRow key={inst.installmentNumber} className={inst.status === 'paid' ? 'bg-green-50/50' : inst.status === 'arrears' ? 'bg-red-50/50' : ''}>
                                        <TableCell className="font-medium text-gray-500">{inst.installmentNumber}</TableCell>
                                        <TableCell>{formatTZ(toZonedTime(new Date(inst.dueDate), EAT_TIMEZONE), 'MMM dd, yyyy')}</TableCell>
                                        <TableCell className="font-medium">{currency} {inst.amount.toLocaleString()}</TableCell>
                                        <TableCell>
                                            <div className="flex flex-col text-xs">
                                                <span className="text-green-600">P: {currency} {(inst.principalPaid || 0).toLocaleString()}</span>
                                                <span className="text-primary">I: {currency} {(inst.interestPaid || 0).toLocaleString()}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={inst.status === 'paid' ? 'success' : inst.status === 'arrears' ? 'destructive' : 'secondary'} className="capitalize">
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

export default RepaymentManagement;