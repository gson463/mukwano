import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { PlusCircle, Eye, Trash2, Download, Upload, Briefcase, DollarSign, AlertTriangle, Edit, Loader2, Calendar as CalendarIcon, Coins as HandCoins, CheckCircle2, User, CreditCard, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { generateSchedule } from '@/utils/loanUtils';
import { getTodayDateString, isYMDBeforeTodayEAT } from '@/utils/dateValidation';
import { getDisabledDates, validateHolidaySelection, isNonWorkingDay, getNextWorkingDateString } from '@/utils/holidayUtils';
import * as XLSX from 'xlsx';
import { toZonedTime, format as formatTZ } from 'date-fns-tz';
import { addDays, format as formatDate, isAfter, parse } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { BorrowerSearchSelect } from '@/components/BorrowerSearchSelect';
import { statCardIconWellClass } from '@/lib/utils';

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

function excelSerialDateToYYYYMMDD(serial) {
    if (typeof serial !== 'number') {
        if (typeof serial === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(serial)) {
            return serial;
        }
        return null; 
    }
    const utc_days = Math.floor(serial - 25569);
    const date = new Date((utc_days - (25567 + 2)) * 86400 * 1000);
    return formatTZ(date, 'yyyy-MM-dd', { timeZone: 'UTC' });
}

const LoanManagement = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [loans, setLoans] = useState([]);
    const [borrowers, setBorrowers] = useState([]);
    const [loanProducts, setLoanProducts] = useState([]);
    const [holidays, setHolidays] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isImporting, setIsImporting] = useState(false);
    const [isDisbursingLoan, setIsDisbursingLoan] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
    const [repaymentDialogOpen, setRepaymentDialogOpen] = useState(false);
    const [selectedLoan, setSelectedLoan] = useState(null);
    const [isRefreshingSchedule, setIsRefreshingSchedule] = useState(false);
    const [editingLoan, setEditingLoan] = useState(null);
    const [repaymentLoan, setRepaymentLoan] = useState(null);
    const [currency, setCurrency] = useState('TZS');
    const [isSubmittingRepayment, setIsSubmittingRepayment] = useState(false);
    
    const [searchQuery, setSearchQuery] = useState('');
    // Default filter set to 'active' as requested
    const [statusFilter, setStatusFilter] = useState('active');
    const [productFilter, setProductFilter] = useState('all');
    const [dateRange, setDateRange] = useState({ from: undefined, to: undefined });
    const [centers, setCenters] = useState([]);
    const [groups, setGroups] = useState([]);
    const [centerFilter, setCenterFilter] = useState('all');
    const [groupFilter, setGroupFilter] = useState('all');
    const [currentPage, setCurrentPage] = useState(1);

    const [formData, setFormData] = useState({ 
        borrowerId: '', 
        productId: '', 
        principal: '', 
        disbursementDate: '', 
        repaymentStartDate: '' 
    });
    const [editFormData, setEditFormData] = useState({ principal: '', productId: '', disbursementDate: null, repaymentStartDate: null });
    const [newSchedulePreview, setNewSchedulePreview] = useState([]);
    
    const [repaymentFormData, setRepaymentFormData] = useState({ amount: '', payment_date: new Date() });
    const importFileRef = useRef(null);
    
    const disabledDays = useMemo(() => getDisabledDates(), []);

    const resetFormData = useCallback(() => {
        const today = getTodayDateString();
        const disburse = getNextWorkingDateString(today, holidays);
        const [y, m, d] = disburse.split('-').map(Number);
        const dayAfterDisb = formatDate(addDays(new Date(y, m - 1, d), 1), 'yyyy-MM-dd');
        const repay = getNextWorkingDateString(dayAfterDisb, holidays);
        setFormData({
            borrowerId: '',
            productId: '',
            principal: '',
            disbursementDate: disburse,
            repaymentStartDate: repay,
        });
    }, [holidays]);
    
    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);

        await supabase.rpc('update_all_loan_statuses');

        const { data: config } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
        if (config) setCurrency(config.value);

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
        const { data: groupsData, error: groupsError } = await supabase
            .from('groups')
            .select('*')
            .eq('loan_officer_id', user.id);

        const { data: loansData, error: loansError } = await supabase
            .from('loans')
            .select(
                `*, borrowers ( id, first_name, surname, group_id, center_id, borrower_id, phone_number, borrower_type )`
            )
            .eq('officer_id', user.id);
        const { data: borrowersData, error: borrowersError } = await supabase.from('borrowers').select('*').eq('loan_officer_id', user.id);
        const { data: productsData, error: productsError } = await supabase.from('loan_products').select('*').eq('status', 'active');
        const { data: holidaysData, error: holidaysError } = await supabase.from('holidays').select('*');
        
        if (
            loansError ||
            borrowersError ||
            productsError ||
            holidaysError ||
            centersError ||
            groupsError
        ) {
            toast({
                title: 'Error fetching data',
                description:
                    loansError?.message ||
                    borrowersError?.message ||
                    productsError?.message ||
                    holidaysError?.message ||
                    centersError?.message ||
                    groupsError?.message,
                variant: 'destructive',
            });
        } else {
            setLoans(loansData || []);
            setBorrowers(borrowersData || []);
            setLoanProducts(productsData || []);
            setHolidays(holidaysData || []);
            setCenters(centersData || []);
            setGroups(groupsData || []);
        }
        setLoading(false);
    }, [user, toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
       resetFormData();
    }, [resetFormData]);

    const handleDateChange = (field, value) => {
        if (isYMDBeforeTodayEAT(value)) {
            toast({
                title: 'Invalid date',
                description: 'Choose today or a future date. Past dates are not allowed.',
                variant: 'destructive',
            });
            return;
        }
        if (!validateHolidaySelection(value, toast, 'process', holidays)) {
            return;
        }
        setFormData((prev) => {
            const next = { ...prev, [field]: value };
            if (field === 'disbursementDate' && value) {
                const dDisb = parse(value, 'yyyy-MM-dd', new Date());
                const rStr = prev.repaymentStartDate;
                if (rStr) {
                    const rD = parse(rStr, 'yyyy-MM-dd', new Date());
                    if (!isAfter(rD, dDisb) || isNonWorkingDay(rStr, holidays)) {
                        const dayAfter = formatDate(addDays(dDisb, 1), 'yyyy-MM-dd');
                        next.repaymentStartDate = getNextWorkingDateString(dayAfter, holidays);
                    }
                }
            }
            return next;
        });
    };

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
    }, [searchQuery, statusFilter, productFilter, dateRange, centerFilter, groupFilter]);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const handleDisburse = async () => {
        const { borrowerId, productId, principal, disbursementDate, repaymentStartDate } = formData;
        
        if (isYMDBeforeTodayEAT(disbursementDate) || isYMDBeforeTodayEAT(repaymentStartDate)) {
            toast({
                title: 'Invalid dates',
                description: 'Disbursement and repayment dates cannot be in the past.',
                variant: 'destructive',
            });
            return;
        }
        if (isNonWorkingDay(disbursementDate, holidays) || isNonWorkingDay(repaymentStartDate, holidays)) {
            toast({
                title: 'Invalid dates',
                description: 'Choose working days only (not Sunday or a public holiday).',
                variant: 'destructive',
            });
            return;
        }
        if (!validateHolidaySelection(disbursementDate, toast, 'process', holidays)) return;
        if (!validateHolidaySelection(repaymentStartDate, toast, 'process', holidays)) return;

        if (!borrowerId || !productId || !principal || !repaymentStartDate || !disbursementDate) {
            toast({ title: 'Validation Error', description: 'Please fill all required fields.', variant: 'destructive' });
            return;
        }

        if (parseFloat(principal) <= 0) {
            toast({ title: 'Validation Error', description: 'Principal amount must be greater than zero.', variant: 'destructive' });
            return;
        }

        const dDate = parse(disbursementDate, 'yyyy-MM-dd', new Date());
        const rDate = parse(repaymentStartDate, 'yyyy-MM-dd', new Date());

        if (!isAfter(rDate, dDate)) {
             toast({ 
                 title: 'Invalid Dates', 
                 description: 'Repayment start date must be AFTER the disbursement date.', 
                 variant: 'destructive' 
             });
             return;
        }
        
        setIsDisbursingLoan(true);

        try {
            const { data: borrower, error: borrowerError } = await supabase.from('borrowers').select('status').eq('id', borrowerId).single();
            if (borrowerError || !borrower) {
                throw new Error('Borrower not found');
            }

            if (borrower.status === 'active_loan' || borrower.status === 'defaulted') {
                toast({ title: 'Cannot Disburse Loan', description: `Borrower has an ${borrower.status.toLowerCase().replace('_', ' ')} loan and cannot receive a new one.`, variant: 'destructive' });
                setIsDisbursingLoan(false);
                return;
            }

            const product = loanProducts.find(p => p.id === productId);
            if (!product) {
                throw new Error('Loan product not found');
            }

            const principalAmount = parseFloat(principal);

            if (principalAmount < product.min_amount || principalAmount > product.max_amount) {
                toast({ title: 'Validation Error', description: `Principal amount must be between ${currency} ${product.min_amount.toLocaleString()} and ${currency} ${product.max_amount.toLocaleString()}.`, variant: 'destructive' });
                setIsDisbursingLoan(false);
                return;
            }

            const interest = principalAmount * (parseFloat(product.interest_rate) / 100);
            const totalPayable = principalAmount + interest;
            
            const schedule = generateSchedule(principalAmount, product.interest_rate, totalPayable, product.loan_period, product.loan_period_unit, product.repayment_frequency, repaymentStartDate, holidays);
            
            const newLoan = {
                loan_id: `LN-${Date.now()}`, 
                borrower_id: borrowerId, 
                product_id: productId, 
                officer_id: user.id, 
                principal: principalAmount, 
                interest_rate: product.interest_rate, 
                total_payable: totalPayable, 
                balance: totalPayable, 
                outstanding_interest: interest, 
                repayment_frequency: product.repayment_frequency, 
                period: product.loan_period, 
                period_unit: product.loan_period_unit, 
                disbursement_date: disbursementDate, 
                repayment_start_date: repaymentStartDate, 
                status: 'active', 
                schedule: schedule,
            };

            const { error: loanInsertError } = await supabase.from('loans').insert(newLoan);

            if (loanInsertError) {
                throw loanInsertError;
            }

            await supabase.from('borrowers').update({ status: 'active_loan' }).eq('id', borrowerId);
            
            toast({ title: 'Success!', description: 'Loan disbursed successfully!', variant: 'default' });
            setDialogOpen(false);
            resetFormData();
            fetchData();
        } catch (error) {
            console.error('Disbursement error:', error);
            toast({ title: 'Disbursement Failed', description: error.message || 'An error occurred while disbursing the loan.', variant: 'destructive' });
        } finally {
            setIsDisbursingLoan(false);
        }
    };

    const handleOpenEditDialog = (loan) => {
        setEditingLoan(loan);
        setEditFormData({
            principal: loan.principal,
            productId: loan.product_id,
            disbursementDate: toZonedTime(new Date(loan.disbursement_date), EAT_TIMEZONE),
            repaymentStartDate: toZonedTime(new Date(loan.repayment_start_date), EAT_TIMEZONE),
        });
        setNewSchedulePreview([]);
        setEditDialogOpen(true);
    };
    
    useEffect(() => {
        if (!editDialogOpen || !editingLoan || !editFormData.productId) {
            setNewSchedulePreview([]);
            return;
        }

        const product = loanProducts.find(p => p.id === editFormData.productId);
        if (!product || !editFormData.principal || !editFormData.repaymentStartDate) {
            setNewSchedulePreview([]);
            return;
        }

        const principalAmount = parseFloat(editFormData.principal);
        const interest = principalAmount * (parseFloat(product.interest_rate) / 100);
        const totalPayable = principalAmount + interest;
        const formattedRepaymentStartDate = formatTZ(editFormData.repaymentStartDate, 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE });

        const schedule = generateSchedule(principalAmount, product.interest_rate, totalPayable, product.loan_period, product.loan_period_unit, product.repayment_frequency, formattedRepaymentStartDate, holidays);
        setNewSchedulePreview(schedule);

    }, [editFormData, editingLoan, loanProducts, holidays, editDialogOpen]);

    const handleRequestEdit = async () => {
        if (!editingLoan) return;

        const { error } = await supabase.from('loans').update({
            status: 'edit_requested',
            edit_request: { 
                principal: parseFloat(editFormData.principal),
                productId: editFormData.productId,
                disbursementDate: formatTZ(editFormData.disbursementDate, 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE }),
                repaymentStartDate: formatTZ(editFormData.repaymentStartDate, 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE }),
                newSchedule: newSchedulePreview
             }
        }).eq('id', editingLoan.id);

        if (error) {
            toast({ title: 'Failed', description: error.message, variant: 'destructive' });
        } else {
            fetchData();
            setEditDialogOpen(false);
            setEditingLoan(null);
            toast({ title: 'Success', description: 'Loan edit request sent to Branch Manager for approval.' });
        }
    };

    const handleRequestDeletion = async (loanId) => {
        const { error } = await supabase.from('loans').update({ status: 'delete_requested' }).eq('id', loanId);
        if (error) {
            toast({ title: 'Failed', description: error.message, variant: 'destructive' });
        } else {
            fetchData();
            toast({ title: 'Success', description: 'Deletion request sent for approval.' });
        }
    };
    
    const handleDownloadTemplate = () => {
        const templateData = [{ borrower_id: '', loan_product_name: '', principal: '', disbursement_date: '', repayment_start_date: '' }];
        const loansSheet = XLSX.utils.json_to_sheet(templateData);
        const instructions = [
            ['Column Name', 'Description', 'Example'],
            ['borrower_id', 'The unique ID of the borrower. Must exist in the system.', 'B-123456'],
            ['loan_product_name', 'The exact name of an active loan product.', 'Personal Loan'],
            ['principal', 'The loan amount without currency symbols.', '500000'],
            ['disbursement_date', 'Date the loan is given. Format: YYYY-MM-DD. Must be a working day.', '2025-11-10'],
            ['repayment_start_date', 'Date repayments begin. Format: YYYY-MM-DD. Must be a working day.', '2025-12-10']
        ];
        const instructionsSheet = XLSX.utils.aoa_to_sheet(instructions);
        const validBorrowers = borrowers.filter(b => b.status === 'eligible' || b.status === 'paid_up').map(b => ({ 'Borrower ID': b.borrower_id, 'Name': `${b.first_name} ${b.surname}` }));
        const borrowersSheet = XLSX.utils.json_to_sheet(validBorrowers);
        const validProducts = loanProducts.map(p => ({ 'Product Name': p.name }));
        const productsSheet = XLSX.utils.json_to_sheet(validProducts);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, loansSheet, 'Loans Import');
        XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions');
        XLSX.utils.book_append_sheet(workbook, borrowersSheet, 'Valid Borrowers');
        XLSX.utils.book_append_sheet(workbook, productsSheet, 'Valid Loan Products');
        XLSX.writeFile(workbook, 'Loans_Import_Template.xlsx');
    };
    
    const isWorkingDay = (dateStr) => !isNonWorkingDay(dateStr, holidays);
    
    const handleImport = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        setIsImporting(true);
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const importedLoans = XLSX.utils.sheet_to_json(worksheet, { raw: true });
                const borrowersMap = new Map(borrowers.map(b => [b.borrower_id, b]));
                const productsMap = new Map(loanProducts.map(p => [p.name.toLowerCase(), p]));
                const newLoans = [];
                const skippedLoans = [];
                for (const row of importedLoans) {
                    const borrower = borrowersMap.get(row.borrower_id);
                    const product = productsMap.get(row.loan_product_name?.toLowerCase());
                    const disbursementDate = excelSerialDateToYYYYMMDD(row.disbursement_date);
                    const repaymentStartDate = excelSerialDateToYYYYMMDD(row.repayment_start_date);

                    if (!borrower || !product || !row.principal || !disbursementDate || !repaymentStartDate) {
                        skippedLoans.push({ ...row, reason: 'Missing or invalid data' });
                        continue;
                    }
                    if (isYMDBeforeTodayEAT(disbursementDate) || isYMDBeforeTodayEAT(repaymentStartDate)) {
                        skippedLoans.push({ ...row, reason: 'Disbursement or repayment date cannot be in the past' });
                        continue;
                    }
                    if (!isWorkingDay(disbursementDate) || !isWorkingDay(repaymentStartDate)) {
                        skippedLoans.push({ ...row, reason: 'Disbursement or Repayment Start Date is not a working day' });
                        continue;
                    }
                    const dImp = parse(disbursementDate, 'yyyy-MM-dd', new Date());
                    const rImp = parse(repaymentStartDate, 'yyyy-MM-dd', new Date());
                    if (!isAfter(rImp, dImp)) {
                        skippedLoans.push({ ...row, reason: 'Repayment start must be after disbursement date' });
                        continue;
                    }
                     if (borrower.status === 'active_loan' || borrower.status === 'defaulted') {
                        skippedLoans.push({ ...row, reason: `Borrower has an ${borrower.status.replace('_',' ')} loan` });
                        continue;
                    }
                    const principalAmount = parseFloat(row.principal);
                    const interest = principalAmount * (parseFloat(product.interest_rate) / 100);
                    const totalPayable = principalAmount + interest;
                    const schedule = generateSchedule(principalAmount, product.interest_rate, totalPayable, product.loan_period, product.loan_period_unit, product.repayment_frequency, repaymentStartDate, holidays);
                    newLoans.push({
                        loan_id: `LN-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`, borrower_id: borrower.id, product_id: product.id, officer_id: user.id, principal: principalAmount, interest_rate: product.interest_rate, total_payable: totalPayable, balance: totalPayable, outstanding_interest: interest, repayment_frequency: product.repayment_frequency, period: product.loan_period, period_unit: product.loan_period_unit, disbursement_date: disbursementDate, repayment_start_date: repaymentStartDate, status: 'active', schedule: schedule,
                    });
                }
                if (newLoans.length > 0) {
                    const { error } = await supabase.from('loans').insert(newLoans);
                    if (error) throw error;
                    const borrowerIdsToUpdate = newLoans.map(l => l.borrower_id);
                    await supabase.from('borrowers').update({ status: 'active_loan' }).in('id', borrowerIdsToUpdate);
                }
                toast({ title: 'Import Complete', description: `${newLoans.length} loans imported successfully. ${skippedLoans.length} loans skipped.` });
                if (skippedLoans.length > 0) {
                     console.log("Skipped loans:", skippedLoans);
                     toast({ title: 'Some loans were skipped', description: 'Check console for details on skipped loans.', variant: 'default'});
                }
                fetchData();
            } catch (error) {
                toast({ title: 'Import Failed', description: error.message, variant: 'destructive' });
            } finally {
                setIsImporting(false);
                event.target.value = null;
            }
        };
        reader.readAsArrayBuffer(file);
    };

    const viewSchedule = async (loan) => {
        setIsRefreshingSchedule(true);
        try {
            await supabase.rpc('recalculate_loan_schedule', { p_loan_id: loan.id });
            await supabase.rpc('update_all_loan_statuses');
            
            const { data: latestLoanData, error } = await supabase
                .from('loans')
                .select(
                    `*, borrowers ( id, first_name, surname, group_id, center_id, borrower_id, phone_number, borrower_type )`
                )
                .eq('id', loan.id)
                .single();
                
            if (error) throw error;

            setSelectedLoan(latestLoanData);
            setScheduleDialogOpen(true);
        } catch (error) {
             console.error(error);
             toast({ title: 'Error', description: 'Could not refresh schedule data. Please try again.', variant: 'destructive' });
        } finally {
            setIsRefreshingSchedule(false);
        }
    };

    const handleOpenRepaymentDialog = (loan) => {
        setRepaymentLoan(loan);
        setRepaymentFormData({ amount: '', payment_date: new Date() });
        setRepaymentDialogOpen(true);
    };

    const handleRecordRepayment = async () => {
        const { amount, payment_date } = repaymentFormData;
        if (!validateHolidaySelection(payment_date, toast, "process")) return;

        if (!amount || !payment_date || !repaymentLoan) {
            toast({ title: 'Error', description: 'Please fill all fields.', variant: 'destructive' });
            return;
        }
        setIsSubmittingRepayment(true);

        const { data, error } = await supabase.functions.invoke('record-repayment', {
            body: {
                loan_id: repaymentLoan.id,
                amount: parseFloat(amount),
                officer_id: user.id,
                actual_payment_date: formatTZ(payment_date, 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE }),
            },
        });

        if (error) {
            toast({ title: 'Repayment Failed', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Success', description: data.message || 'Repayment recorded successfully!' });
            fetchData();
            setRepaymentDialogOpen(false);
        }
        setIsSubmittingRepayment(false);
    };

    const getStatusBadge = (status) => ({ active: 'success', paid: 'default', delinquent: 'warning', defaulted: 'destructive', delete_requested: 'secondary', edit_requested: 'secondary' }[status] || 'secondary');
    
    const eligibleBorrowers = useMemo(
        () =>
            borrowers.filter(
                (b) =>
                    (b.status === 'eligible' || b.status === 'paid_up') &&
                    !b.duplicate_of_borrower_id,
            ),
        [borrowers],
    );

    const selectedProduct = useMemo(() => {
        return loanProducts.find(p => p.id === formData.productId);
    }, [formData.productId, loanProducts]);

    const todayEAT = useMemo(() => getTodayDateString(), []);
    const repaymentDateMin = useMemo(() => {
        if (!formData.disbursementDate) return todayEAT;
        const [y, m, d] = formData.disbursementDate.split('-').map(Number);
        return formatDate(addDays(new Date(y, m - 1, d), 1), 'yyyy-MM-dd');
    }, [formData.disbursementDate, todayEAT]);

    const canConfirmDisburse = useMemo(() => {
        const { borrowerId, productId, principal, disbursementDate, repaymentStartDate } = formData;
        if (!borrowerId || !productId || principal === '' || principal == null) return false;
        if (productId && !selectedProduct) return false;
        const p = parseFloat(String(principal));
        if (Number.isNaN(p) || p <= 0) return false;
        if (!disbursementDate || !repaymentStartDate) return false;
        if (isYMDBeforeTodayEAT(disbursementDate) || isYMDBeforeTodayEAT(repaymentStartDate)) return false;
        if (isNonWorkingDay(disbursementDate, holidays) || isNonWorkingDay(repaymentStartDate, holidays)) return false;
        const dDisb = parse(disbursementDate, 'yyyy-MM-dd', new Date());
        const rD = parse(repaymentStartDate, 'yyyy-MM-dd', new Date());
        if (!isAfter(rD, dDisb)) return false;
        if (p < selectedProduct.min_amount || p > selectedProduct.max_amount) return false;
        return true;
    }, [formData, holidays, selectedProduct]);

    if (loading) return <DashboardLayout title="Loan Management"><div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div></DashboardLayout>;

    return (
        <DashboardLayout title="Loan Management">
            <div className="space-y-8">
                <div className="flex flex-wrap items-center justify-end gap-3">
                        <Button variant="outline" onClick={handleDownloadTemplate} className="hover:bg-gray-50 border-gray-300">
                             <Download className="mr-2 h-4 w-4" /> Template
                        </Button>
                        <Button variant="outline" onClick={() => importFileRef.current.click()} disabled={isImporting} className="hover:bg-gray-50 border-gray-300">
                            {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />} Import
                        </Button>
                        <input type="file" ref={importFileRef} className="hidden" accept=".csv, .xlsx" onChange={handleImport} />
                        
                        <Dialog open={dialogOpen} onOpenChange={(open) => {
                            setDialogOpen(open);
                            if (open) resetFormData();
                        }}>
                            <DialogTrigger asChild>
                                <Button className="bg-primary text-primary-foreground shadow-md hover:bg-primary/90 hover:shadow-lg transition-all duration-300 transform hover:scale-105">
                                    <PlusCircle className="mr-2 h-4 w-4" /> Disburse Loan
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="max-h-[min(95dvh,920px)] w-[min(100vw-1rem,56rem)] max-w-[min(100vw-1rem,56rem)] overflow-y-auto p-0 overflow-x-hidden rounded-2xl border-0 shadow-2xl sm:max-w-4xl">
                                <div className="bg-gradient-to-br from-emerald-700 via-green-800 to-emerald-950 p-4 sm:p-8 text-white relative overflow-hidden">
                                     <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none" />
                                     <div className="relative z-10">
                                        <DialogTitle className="text-2xl sm:text-3xl font-bold tracking-tight mb-2 pr-8">Disburse New Loan</DialogTitle>
                                        <DialogDescription className="text-white/80 text-sm sm:text-lg">
                                            Follow the steps to successfully disburse a loan to a qualified borrower.
                                        </DialogDescription>
                                     </div>
                                </div>

                                <motion.div 
                                    className="p-4 sm:p-8 bg-white/50 backdrop-blur-sm space-y-6 sm:space-y-8"
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.4 }}
                                >
                                    <p className="text-xs sm:text-sm text-muted-foreground rounded-md border border-border/60 bg-card/80 px-3 py-2">
                                        Disbursement must be on or after today (EAT), on a working day only. Sundays and public holidays in the system are not allowed. Repayment start must be a later working day.
                                    </p>
                                    <div className="grid grid-cols-1 gap-6 sm:gap-8 lg:grid-cols-2">
                                        {/* Left Column: Borrower & Product */}
                                        <motion.div className="space-y-6" initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.1 }}>
                                            <div className="space-y-1">
                                                <Label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                                                    <User className="w-4 h-4 text-primary" />
                                                    Select Borrower *
                                                </Label>
                                                <div className="bg-white rounded-lg shadow-sm">
                                                    <BorrowerSearchSelect 
                                                        borrowers={eligibleBorrowers}
                                                        value={formData.borrowerId}
                                                        onChange={e => setFormData({ ...formData, borrowerId: e })}
                                                        placeholder="Search Borrower..."
                                                    />
                                                </div>
                                            </div>
                                            
                                            <div className="space-y-1">
                                                <Label htmlFor="product" className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                                                    <CreditCard className="w-4 h-4 text-purple-500" />
                                                    Loan Product *
                                                </Label>
                                                <Select value={formData.productId} onValueChange={e => setFormData({ ...formData, productId: e })}>
                                                    <SelectTrigger className="w-full bg-white border-gray-200 focus:ring-2 focus:ring-purple-200 focus:border-purple-500 h-11 transition-all duration-200">
                                                        <SelectValue placeholder="Select Loan Product" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {loanProducts.map(p => (
                                                            <SelectItem key={p.id} value={p.id} className="cursor-pointer">
                                                                <div className="flex flex-col py-1">
                                                                    <span className="font-medium">{p.name}</span>
                                                                    <span className="text-xs text-gray-500">{p.interest_rate}% Interest • {p.loan_period} {p.loan_period_unit}</span>
                                                                </div>
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                             <AnimatePresence>
                                                {selectedProduct && (
                                                    <motion.div 
                                                        initial={{ opacity: 0, height: 0 }} 
                                                        animate={{ opacity: 1, height: 'auto' }}
                                                        exit={{ opacity: 0, height: 0 }}
                                                        className="bg-primary/10 border border-primary/20 rounded-lg p-4 text-sm text-foreground"
                                                    >
                                                        <div className="flex justify-between items-center mb-1">
                                                            <span className="font-semibold">Product Terms</span>
                                                            <Badge variant="outline" className="bg-white text-primary border-primary/30">{selectedProduct.name}</Badge>
                                                        </div>
                                                        <div className="grid grid-cols-1 gap-x-4 gap-y-2 mt-2 text-xs sm:grid-cols-2">
                                                            <div>Min Amount: <span className="font-medium">{currency} {selectedProduct.min_amount.toLocaleString()}</span></div>
                                                            <div>Max Amount: <span className="font-medium">{currency} {selectedProduct.max_amount.toLocaleString()}</span></div>
                                                            <div>Rate: <span className="font-medium">{selectedProduct.interest_rate}%</span></div>
                                                            <div>Period: <span className="font-medium">{selectedProduct.loan_period} {selectedProduct.loan_period_unit}</span></div>
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </motion.div>
                                        
                                        {/* Right Column: Amount & Dates */}
                                        <motion.div className="space-y-6" initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.2 }}>
                                            <div className="space-y-1">
                                                <Label htmlFor="principal" className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                                                    <DollarSign className="w-4 h-4 text-green-600" />
                                                    Principal Amount ({currency}) *
                                                </Label>
                                                <div className="relative">
                                                    <Input 
                                                        id="principal"
                                                        type="number" 
                                                        value={formData.principal} 
                                                        onChange={e => setFormData({ ...formData, principal: e.target.value })}
                                                        placeholder="0.00"
                                                        min="0"
                                                        step="0.01"
                                                        className="w-full pl-8 bg-white border-gray-200 focus:ring-2 focus:ring-green-200 focus:border-green-500 h-11 min-h-11 text-base sm:text-lg font-medium transition-all duration-200"
                                                    />
                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">$</span>
                                                </div>
                                                {selectedProduct && (formData.principal < selectedProduct.min_amount || formData.principal > selectedProduct.max_amount) && formData.principal !== '' && (
                                                    <p className="text-xs text-red-500 font-medium mt-1 animate-pulse">Amount must be between {selectedProduct.min_amount.toLocaleString()} and {selectedProduct.max_amount.toLocaleString()}</p>
                                                )}
                                            </div>

                                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                                <div className="min-w-0 space-y-1">
                                                    <Label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                                                        <CalendarDays className="w-4 h-4 shrink-0 text-orange-500" />
                                                        Disbursement *
                                                    </Label>
                                                    <div className="relative w-full min-w-0">
                                                        <Input
                                                            type="date"
                                                            min={todayEAT}
                                                            value={formData.disbursementDate}
                                                            onChange={(e) => handleDateChange('disbursementDate', e.target.value)}
                                                            className="w-full min-w-0 h-11 min-h-11 max-w-full border-gray-200 focus:ring-2 focus:ring-orange-200 focus:border-orange-500 cursor-pointer [color-scheme:light]"
                                                        />
                                                    </div>
                                                </div>
                                                
                                                <div className="min-w-0 space-y-1">
                                                    <Label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                                                        <CalendarDays className="w-4 h-4 shrink-0 text-teal-500" />
                                                        Repayment Start *
                                                    </Label>
                                                    <div className="relative w-full min-w-0">
                                                        <Input
                                                            type="date"
                                                            min={repaymentDateMin}
                                                            value={formData.repaymentStartDate}
                                                            onChange={(e) => handleDateChange('repaymentStartDate', e.target.value)}
                                                            className="w-full min-w-0 h-11 min-h-11 max-w-full border-gray-200 focus:ring-2 focus:ring-teal-200 focus:border-teal-500 cursor-pointer [color-scheme:light]"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </motion.div>
                                    </div>

                                    <motion.div
                                        className="flex flex-col-reverse gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:justify-end sm:gap-3"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ delay: 0.3 }}
                                    >
                                        <Button variant="outline" onClick={() => setDialogOpen(false)} className="h-11 w-full px-6 text-gray-600 border-gray-300 hover:bg-gray-50 sm:w-auto">Cancel</Button>
                                        <Button 
                                            onClick={handleDisburse} 
                                            className="h-11 w-full bg-primary px-8 text-primary-foreground shadow-lg transition-all duration-300 rounded-lg font-semibold tracking-wide hover:scale-[1.02] hover:shadow-xl enabled:hover:bg-primary/90 sm:w-auto disabled:pointer-events-none disabled:opacity-50"
                                            disabled={isDisbursingLoan || !canConfirmDisburse}
                                        >
                                            {isDisbursingLoan ? (
                                                <>
                                                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                                    Processing...
                                                </>
                                            ) : (
                                                <>
                                                    <CheckCircle2 className="mr-2 h-5 w-5" />
                                                    Confirm Disbursement
                                                </>
                                            )}
                                        </Button>
                                    </motion.div>
                                </motion.div>
                            </DialogContent>
                        </Dialog>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <StatCard title="Total Loans" value={stats.totalLoans} icon={Briefcase} color="text-primary" />
                    <StatCard title="Total Principal" value={`${currency} ${stats.totalPrincipal.toLocaleString()}`} icon={DollarSign} color="text-green-600" />
                    <StatCard title="Total Outstanding" value={`${currency} ${stats.totalBalance.toLocaleString()}`} icon={DollarSign} color="text-yellow-600" />
                    <StatCard title="Loans at Risk" value={stats.atRiskLoans} icon={AlertTriangle} color="text-red-600" />
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-4">
                            <CardTitle>My Loan Portfolio</CardTitle>
                            <div className="flex w-full flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-end">
                                <div className="min-w-0 flex-1 lg:min-w-[12rem]">
                                    <Input
                                        placeholder="Search loan ID, borrower, phone, amount…"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full"
                                    />
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
                                        <SelectItem value="paid">Paid</SelectItem>
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
                                                    {dateRange?.from ? (
                                                        dateRange.to ? (
                                                            <>
                                                                {formatTZ(dateRange.from, 'LLL dd, y', {
                                                                    timeZone: EAT_TIMEZONE,
                                                                })}{' '}
                                                                –{' '}
                                                                {formatTZ(dateRange.to, 'LLL dd, y', {
                                                                    timeZone: EAT_TIMEZONE,
                                                                })}
                                                            </>
                                                        ) : (
                                                            formatTZ(dateRange.from, 'LLL dd, y', {
                                                                timeZone: EAT_TIMEZONE,
                                                            })
                                                        )
                                                    ) : (
                                                        <span className="text-muted-foreground">
                                                            Disbursement date range
                                                        </span>
                                                    )}
                                                </span>
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0" align="start">
                                            <Calendar
                                                mode="range"
                                                selected={dateRange}
                                                onSelect={setDateRange}
                                                numberOfMonths={2}
                                                disabled={disabledDays}
                                            />
                                        </PopoverContent>
                                    </Popover>
                                </div>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto rounded-md border border-slate-300 bg-white shadow-sm dark:border-slate-600 dark:bg-card">
                            <Table className="border-collapse border-0 text-sm">
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Loan ID
                                        </TableHead>
                                        <TableHead className="min-w-[7rem] border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Borrower
                                        </TableHead>
                                        <TableHead className="border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Principal
                                        </TableHead>
                                        <TableHead className="border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Balance
                                        </TableHead>
                                        <TableHead className="border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Disbursement
                                        </TableHead>
                                        <TableHead className="border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Status
                                        </TableHead>
                                        <TableHead className="min-w-[10rem] border border-slate-300 bg-slate-100 px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Actions
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {paginatedLoans.map((l) => (
                                        <TableRow
                                            key={l.id}
                                            className="border-slate-200 dark:border-slate-700"
                                        >
                                            <TableCell className="border border-slate-300 font-mono text-xs text-foreground dark:border-slate-600">
                                                {l.loan_id}
                                            </TableCell>
                                            <TableCell className="border border-slate-300 dark:border-slate-600">
                                                {l.borrowers?.first_name} {l.borrowers?.surname}
                                            </TableCell>
                                            <TableCell className="border border-slate-300 font-medium dark:border-slate-600">
                                                {currency} {Number(l.principal).toLocaleString()}
                                            </TableCell>
                                            <TableCell className="border border-slate-300 font-medium tabular-nums dark:border-slate-600">
                                                {currency}{' '}
                                                {Number(l.balance).toLocaleString(undefined, {
                                                    minimumFractionDigits: 2,
                                                })}
                                            </TableCell>
                                            <TableCell className="border border-slate-300 text-xs tabular-nums dark:border-slate-600">
                                                {formatTZ(
                                                    toZonedTime(new Date(l.disbursement_date), EAT_TIMEZONE),
                                                    'MMM dd, yyyy',
                                                    { timeZone: EAT_TIMEZONE },
                                                )}
                                            </TableCell>
                                            <TableCell className="border border-slate-300 dark:border-slate-600">
                                                <Badge
                                                    variant={getStatusBadge(l.status)}
                                                    className="capitalize"
                                                >
                                                    {l.status.replace(/_/g, ' ')}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="border border-slate-300 p-1.5 text-right dark:border-slate-600">
                                                <div className="flex flex-nowrap items-center justify-end gap-1">
                                                    <Button
                                                        variant="outline"
                                                        size="icon"
                                                        className="h-8 w-8 shrink-0 rounded-md"
                                                        onClick={() => viewSchedule(l)}
                                                        title="View schedule"
                                                        aria-label="View schedule"
                                                    >
                                                        {isRefreshingSchedule && selectedLoan?.id === l.id ? (
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                        ) : (
                                                            <Eye className="h-4 w-4" />
                                                        )}
                                                    </Button>
                                                    <Button
                                                        variant="outline"
                                                        size="icon"
                                                        className="h-8 w-8 shrink-0 rounded-md"
                                                        onClick={() => handleOpenEditDialog(l)}
                                                        disabled={l.status?.includes('_requested')}
                                                        title="Request edit"
                                                        aria-label="Request edit"
                                                    >
                                                        <Edit className="h-4 w-4" />
                                                    </Button>
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button
                                                                variant="outline"
                                                                size="icon"
                                                                className="h-8 w-8 shrink-0 rounded-md"
                                                                disabled={l.status?.includes('_requested')}
                                                                title="Request deletion"
                                                                aria-label="Request deletion"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>
                                                                    Request loan deletion?
                                                                </AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    This sends a deletion request. You cannot undo
                                                                    this.
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                <AlertDialogAction
                                                                    onClick={() => handleRequestDeletion(l.id)}
                                                                >
                                                                    Yes, request
                                                                </AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                    <Button
                                                        type="button"
                                                        variant="default"
                                                        size="icon"
                                                        className="h-8 w-8 shrink-0 rounded-md"
                                                        onClick={() => handleOpenRepaymentDialog(l)}
                                                        title="Record repayment"
                                                        aria-label="Record repayment"
                                                        disabled={l.status === 'paid'}
                                                    >
                                                        <HandCoins className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {filteredLoans.length === 0 && (
                                        <TableRow>
                                            <TableCell
                                                colSpan={7}
                                                className="border border-slate-300 py-8 text-center text-muted-foreground dark:border-slate-600"
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
                                          const to = Math.min(
                                              currentPage * LOAN_PAGE_SIZE,
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
            
            <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
                <DialogContent className="max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>Repayment Schedule for {selectedLoan?.loan_id}</DialogTitle>
                        <DialogDescription>
                            Borrower: {selectedLoan?.borrowers?.first_name} {selectedLoan?.borrowers?.surname} <br/>
                            Total Payable: {currency} {(selectedLoan?.total_payable || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[60vh] overflow-y-auto"><Table>
                        <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Due Date</TableHead><TableHead>Amount Due</TableHead><TableHead>Paid</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                        <TableBody>{selectedLoan?.schedule?.map(inst => (<TableRow key={inst.installmentNumber}><TableCell>{inst.installmentNumber}</TableCell><TableCell>{formatTZ(toZonedTime(new Date(inst.dueDate), EAT_TIMEZONE), 'MMM dd, yyyy', { timeZone: EAT_TIMEZONE })}</TableCell><TableCell>{currency} {inst.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell><TableCell>{currency} {(inst.paidAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell><TableCell><Badge variant={inst.status === 'paid' ? 'success' : inst.status === 'arrears' ? 'warning' : 'default'}>{inst.status}</Badge></TableCell></TableRow>))}</TableBody>
                    </Table></div>
                </DialogContent>
            </Dialog>
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                <DialogContent className="max-w-4xl">
                    <DialogHeader><DialogTitle>Request Edit for Loan {editingLoan?.loan_id}</DialogTitle></DialogHeader>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
                        <div className="space-y-4">
                            <Select value={editFormData.productId} onValueChange={e => setEditFormData({ ...editFormData, productId: e })}>
                                <SelectTrigger className="w-full"><SelectValue placeholder="Select Loan Product" /></SelectTrigger>
                                <SelectContent>
                                    {loanProducts.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <div><Label>Principal Amount ({currency})</Label><Input type="number" value={editFormData.principal} onChange={e => setEditFormData({ ...editFormData, principal: e.target.value })} /></div>
                             <div>
                                <Label>Disbursement Date</Label>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant={"outline"} className="w-full justify-start text-left font-normal">
                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                            {editFormData.disbursementDate ? formatTZ(editFormData.disbursementDate, "PPP", { timeZone: EAT_TIMEZONE }) : <span>Pick a date</span>}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0">
                                        <Calendar mode="single" selected={editFormData.disbursementDate} onSelect={(date) => setEditFormData({...editFormData, disbursementDate: date})} disabled={disabledDays} initialFocus/>
                                    </PopoverContent>
                                </Popover>
                            </div>
                            <div>
                                <Label>Repayment Start Date</Label>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant={"outline"} className="w-full justify-start text-left font-normal">
                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                            {editFormData.repaymentStartDate ? formatTZ(editFormData.repaymentStartDate, "PPP", { timeZone: EAT_TIMEZONE }) : <span>Pick a date</span>}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0">
                                        <Calendar mode="single" selected={editFormData.repaymentStartDate} onSelect={(date) => setEditFormData({...editFormData, repaymentStartDate: date})} disabled={disabledDays} initialFocus/>
                                    </PopoverContent>
                                </Popover>
                            </div>
                            <Button onClick={handleRequestEdit} className="w-full">Send Edit Request</Button>
                        </div>
                        <div className="space-y-2">
                             <h4 className="font-semibold text-lg">New Schedule Preview</h4>
                             <div className="border rounded-md max-h-80 overflow-y-auto">
                                <Table>
                                    <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Due Date</TableHead><TableHead>Amount</TableHead></TableRow></TableHeader>
                                    <TableBody>
                                        {newSchedulePreview.length > 0 ? newSchedulePreview.map(inst => (
                                            <TableRow key={inst.installmentNumber}>
                                                <TableCell>{inst.installmentNumber}</TableCell>
                                                <TableCell>{formatDate(new Date(inst.dueDate), 'MMM dd, yyyy')}</TableCell>
                                                <TableCell>{currency} {inst.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                                            </TableRow>
                                        )) : (
                                            <TableRow><TableCell colSpan={3} className="text-center">Enter valid details to generate preview.</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                             </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
            <Dialog open={repaymentDialogOpen} onOpenChange={setRepaymentDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Record Repayment for {repaymentLoan?.loan_id}</DialogTitle>
                        <DialogDescription>
                            Borrower: {repaymentLoan?.borrowers?.first_name} {repaymentLoan?.borrowers?.surname}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <Label>Repayment Amount ({currency})</Label>
                            <Input
                                type="number"
                                value={repaymentFormData.amount}
                                onChange={(e) => setRepaymentFormData({ ...repaymentFormData, amount: e.target.value })}
                                placeholder="Enter amount"
                            />
                        </div>
                        <div>
                            <Label>Actual Payment Date</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant={"outline"} className="w-full justify-start text-left font-normal">
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {repaymentFormData.payment_date ? formatDate(repaymentFormData.payment_date, "PPP") : <span>Pick a date</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                    <Calendar
                                        mode="single"
                                        selected={repaymentFormData.payment_date}
                                        onSelect={(date) => {
                                            if (validateHolidaySelection(date, toast, "process")) {
                                                setRepaymentFormData({ ...repaymentFormData, payment_date: date });
                                            }
                                        }}
                                        disabled={disabledDays}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>
                        <Button onClick={handleRecordRepayment} className="w-full" disabled={isSubmittingRepayment}>
                           {isSubmittingRepayment ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <HandCoins className="mr-2 h-4 w-4" />}
                           Record Payment
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </DashboardLayout>
    );
};

export default LoanManagement;