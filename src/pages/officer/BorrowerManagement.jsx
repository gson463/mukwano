import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    PlusCircle,
    Edit,
    Trash2,
    Eye,
    Download,
    Upload,
    Users,
    UserCheck,
    UserX,
    UserPlus as UserPlusIcon,
    Loader2,
    FileSpreadsheet,
    CheckCircle,
    AlertCircle,
    ChevronLeft,
    ChevronRight,
    User,
    Phone,
    FileText,
    Building2,
    Users2,
    ArrowRightLeft,
} from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from '@/components/ui/badge';
import * as XLSX from 'xlsx';
import { Checkbox } from '@/components/ui/checkbox';
import {
    normalizeBorrowerPhoneKey,
    idKeyForImportDuplicateCheck,
    normalizeIdKey,
    identificationNumberNeedsDataReview,
    phoneNumberNeedsDataReview,
    borrowerRowNeedsDataReview,
    borrowerRowIsDuplicateRecord,
    duplicateRowMatchSummary,
} from '@/lib/borrowerDuplicateCheck';
import { cn } from '@/lib/utils';
import {
    NIDA_DIGIT_LENGTH,
    VOTERS_ID_MAX_INPUT_LENGTH,
    DRIVER_LICENSE_DIGIT_LENGTH,
    PHONE_DIGIT_LENGTH,
    normalizeNidaDigits,
    normalizeVotersIdInput,
    normalizeDriversLicenseDigits,
    normalizePhoneDigitsMax10,
    normalizePersonNameLettersOnly,
    validateNidaIdentificationNumber,
    validateVotersIdentificationNumber,
    validateDriversLicenseIdentificationNumber,
    validatePhoneNumberTenDigits,
    isNationalIdIdentificationType,
    isVotersIdIdentificationType,
    isDriversLicenseIdentificationType,
} from '@/lib/borrowerIdValidation';

function FieldRequired() {
    return <span className="text-destructive ml-0.5" aria-hidden>*</span>;
}

function getIdentificationNumberFieldLabel(identificationType) {
    switch (identificationType) {
        case 'national_id':
            return 'NIDA number';
        case 'passport':
            return 'Passport number';
        case 'drivers_license':
            return "Driver's licence number";
        case 'voters_id':
            return "Voter's ID number";
        default:
            return 'ID number';
    }
}

const BORROWER_PAGE_SIZE = 10;

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

const BorrowerManagement = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const navigate = useNavigate();
    const [borrowers, setBorrowers] = useState([]);
    const [groups, setGroups] = useState([]);
    const [centers, setCenters] = useState([]);
    const [officerBranchId, setOfficerBranchId] = useState(null);
    const [loanProducts, setLoanProducts] = useState([]);
    /** Map: canonical borrower id → { borrower_id, first_name, surname } for rows marked duplicate_of_borrower_id */
    const [duplicateCanonicalById, setDuplicateCanonicalById] = useState({});
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingBorrower, setEditingBorrower] = useState(null);
    const [similarNameDialogOpen, setSimilarNameDialogOpen] = useState(false);
    const [similarNameMatch, setSimilarNameMatch] = useState(null);
    const importFileRef = useRef(null);
    const [deleteTargetId, setDeleteTargetId] = useState(null);
    const [transferOpen, setTransferOpen] = useState(false);
    const [transferBorrowerIds, setTransferBorrowerIds] = useState([]);
    const [transferCenterId, setTransferCenterId] = useState('');
    const [transferGroupId, setTransferGroupId] = useState('');
    const [transferSaving, setTransferSaving] = useState(false);

    const [selectedBorrowers, setSelectedBorrowers] = useState(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [centerFilter, setCenterFilter] = useState('all');
    const [groupFilter, setGroupFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [idReviewFilter, setIdReviewFilter] = useState('all');
    const [currentPage, setCurrentPage] = useState(1);

    const defaultFormState = {
        first_name: '',
        surname: '',
        gender: 'male',
        phone_number: '',
        address: '',
        business_name: '',
        business_location: '',
        group_id: null,
        center_id: null,
        identification_type: 'national_id',
        identification_number: '',
        borrower_type: 'group',
    };

    const [formData, setFormData] = useState(defaultFormState);

    const fetchDuplicateBorrower = useCallback(async (phone, idNumber, excludeBorrowerId) => {
        const { data, error } = await supabase.rpc('find_duplicate_borrower', {
            p_phone: phone ?? '',
            p_identification_number: idNumber ?? '',
            p_exclude_borrower_id: excludeBorrowerId ?? null,
        });
        if (error) {
            console.error(error);
            return null;
        }
        if (data == null) return null;
        const row = Array.isArray(data) ? data[0] : data;
        return row && row.id ? row : null;
    }, []);

    const fetchSimilarBorrowerName = useCallback(async (firstName, surname, excludeBorrowerId) => {
        const { data, error } = await supabase.rpc('find_similar_borrower_name', {
            p_first_name: firstName ?? '',
            p_surname: surname ?? '',
            p_exclude_borrower_id: excludeBorrowerId ?? null,
            p_min_similarity: 0.4,
        });
        if (error) {
            console.warn('find_similar_borrower_name:', error.message);
            return null;
        }
        if (data == null) return null;
        const row = Array.isArray(data) ? data[0] : data;
        return row && row.id ? row : null;
    }, []);

    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);

        const { data: profileRow } = await supabase.from('users').select('branch_id').eq('id', user.id).maybeSingle();
        const branchId = profileRow?.branch_id ?? null;
        setOfficerBranchId(branchId);

        const { data: borrowersData, error: borrowersError } = await supabase
            .from('borrowers')
            .select('*')
            .eq('loan_officer_id', user.id);

        const { data: groupsData, error: groupsError } = await supabase
            .from('groups')
            .select('*')
            .eq('loan_officer_id', user.id);

        let centersQuery = supabase.from('centers').select('id, name, branch_id').eq('loan_officer_id', user.id).order('name');
        if (branchId) {
            centersQuery = centersQuery.eq('branch_id', branchId);
        }
        const { data: centersData, error: centersError } = await centersQuery;

        const { data: productsData, error: productsError } = await supabase
            .from('loan_products')
            .select('name')
            .eq('status', 'active');

        if (borrowersError || groupsError || centersError || productsError) {
            toast({
                title: 'Error fetching data',
                description: borrowersError?.message || groupsError?.message || centersError?.message || productsError.message,
                variant: 'destructive',
            });
            setDuplicateCanonicalById({});
        } else {
            const list = borrowersData || [];
            const dupTargetIds = [...new Set(list.map((b) => b.duplicate_of_borrower_id).filter(Boolean))];
            let canonMap = {};
            if (dupTargetIds.length) {
                const { data: canRows, error: canErr } = await supabase
                    .from('borrowers')
                    .select('id, borrower_id, first_name, surname, phone_number, identification_number')
                    .in('id', dupTargetIds);
                if (!canErr && canRows) {
                    canonMap = Object.fromEntries(canRows.map((c) => [c.id, c]));
                }
            }
            setDuplicateCanonicalById(canonMap);
            setBorrowers(list);
            setGroups(groupsData || []);
            setCenters(centersData || []);
            setLoanProducts(productsData || []);
        }
        setLoading(false);
    }, [user, toast]);
    
    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const groupsInSelectedCenter = useMemo(() => {
        if (!formData.center_id) return [];
        return groups.filter((g) => g.center_id === formData.center_id);
    }, [groups, formData.center_id]);

    /** Groups shown in the list filter: all, or only those in the selected centre */
    /** For validation when centre changes: which groups are valid for current centre filter */
    const groupsForTableFilter = useMemo(() => {
        if (centerFilter === 'all') return groups;
        return groups.filter((g) => g.center_id === centerFilter);
    }, [groups, centerFilter]);

    /** Orodha ya vikundi ndani ya kituo kilichochaguliwa (kwa dropdown ya group tu) */
    const groupsInSelectedCenterFilter = useMemo(() => {
        if (centerFilter === 'all') return [];
        return groups.filter((g) => g.center_id === centerFilter);
    }, [groups, centerFilter]);

    const resolveBorrowerCenterId = useCallback(
        (b) => {
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

    const getCenterName = useCallback(
        (centerId) => (centerId ? centers.find((c) => c.id === centerId)?.name : null) || '—',
        [centers],
    );

    const groupsInTransferCenter = useMemo(() => {
        if (!transferCenterId) return [];
        return groups.filter((g) => g.center_id === transferCenterId);
    }, [groups, transferCenterId]);

    useEffect(() => {
        if (!transferOpen || !transferCenterId) return;
        setTransferGroupId((prev) => {
            const list = groups.filter((g) => String(g.center_id) === String(transferCenterId));
            if (prev && list.some((g) => String(g.id) === String(prev))) return prev;
            return list[0] ? String(list[0].id) : '';
        });
    }, [transferOpen, transferCenterId, groups]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, centerFilter, groupFilter, statusFilter, idReviewFilter]);

    const identificationNumberLabel = getIdentificationNumberFieldLabel(formData.identification_type);

    const borrowerTemplateDownloadBlocked = !officerBranchId || centers.length === 0 || groups.length === 0;
    const borrowerTemplateDownloadTitle = !officerBranchId
        ? 'Assign a branch to your profile first (User Management).'
        : centers.length === 0 || groups.length === 0
          ? 'Create at least one centre and one group under Centers & Groups first.'
          : undefined;

    const idReviewCount = useMemo(
        () => borrowers.filter((b) => borrowerRowNeedsDataReview(b)).length,
        [borrowers],
    );

    const duplicateRowCount = useMemo(
        () => borrowers.filter((b) => borrowerRowIsDuplicateRecord(b)).length,
        [borrowers],
    );

    const filteredBorrowers = useMemo(() => {
        return borrowers.filter((b) => {
            const query = searchQuery.toLowerCase();
            const matchesSearch =
                b.first_name.toLowerCase().includes(query) ||
                b.surname.toLowerCase().includes(query) ||
                (b.borrower_id && b.borrower_id.toLowerCase().includes(query)) ||
                (b.phone_number && b.phone_number.includes(query)) ||
                (b.identification_number && b.identification_number.includes(query));
            const centerId = resolveBorrowerCenterId(b);
            const matchesCenter = centerFilter === 'all' || centerId === centerFilter;
            const matchesGroup = groupFilter === 'all' || b.group_id === groupFilter;
            const matchesStatus = statusFilter === 'all' || b.status === statusFilter;
            const needsReview = borrowerRowNeedsDataReview(b);
            const isDupRow = borrowerRowIsDuplicateRecord(b);
            const matchesIdReview =
                idReviewFilter === 'all' ||
                (idReviewFilter === 'needs_review' && needsReview) ||
                (idReviewFilter === 'is_duplicate' && isDupRow) ||
                (idReviewFilter === 'ok' && !needsReview && !isDupRow);
            return matchesSearch && matchesCenter && matchesGroup && matchesStatus && matchesIdReview;
        });
    }, [
        borrowers,
        searchQuery,
        centerFilter,
        groupFilter,
        statusFilter,
        idReviewFilter,
        resolveBorrowerCenterId,
    ]);

    const totalPages = Math.max(1, Math.ceil(filteredBorrowers.length / BORROWER_PAGE_SIZE) || 1);

    const paginatedBorrowers = useMemo(() => {
        const start = (currentPage - 1) * BORROWER_PAGE_SIZE;
        return filteredBorrowers.slice(start, start + BORROWER_PAGE_SIZE);
    }, [filteredBorrowers, currentPage]);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const handleSelectBorrower = (borrowerId, isSelected) => {
        const newSelection = new Set(selectedBorrowers);
        if (isSelected) {
            newSelection.add(borrowerId);
        } else {
            newSelection.delete(borrowerId);
        }
        setSelectedBorrowers(newSelection);
    };

    const allOnPageSelected =
        paginatedBorrowers.length > 0 && paginatedBorrowers.every((b) => selectedBorrowers.has(b.id));

    const handleSelectAllPage = (isSelected) => {
        setSelectedBorrowers((prev) => {
            const next = new Set(prev);
            if (isSelected) {
                paginatedBorrowers.forEach((b) => next.add(b.id));
            } else {
                paginatedBorrowers.forEach((b) => next.delete(b.id));
            }
            return next;
        });
    };

    const openTransferFromBorrower = useCallback(
        (b) => {
            if (b.borrower_type !== 'group') {
                toast({
                    title: 'Not a group borrower',
                    description: 'Centre and group transfer applies to group borrowers only. Individual clients are not attached to a centre or group.',
                    variant: 'warning',
                });
                return;
            }
            if (b.duplicate_of_borrower_id) {
                toast({
                    title: 'Cannot transfer this row',
                    description: 'Duplicate history rows are not moved. Open the main borrower and transfer that record, or deselect the duplicate row.',
                    variant: 'warning',
                });
                return;
            }
            const cid = resolveBorrowerCenterId(b);
            setTransferBorrowerIds([b.id]);
            setTransferCenterId(cid ? String(cid) : '');
            setTransferGroupId(b.group_id ? String(b.group_id) : '');
            setTransferOpen(true);
        },
        [resolveBorrowerCenterId, toast],
    );

    const openTransferBulk = useCallback(() => {
        if (selectedBorrowers.size === 0) {
            toast({
                title: 'No borrowers selected',
                description: 'Select one or more group borrowers to transfer.',
                variant: 'warning',
            });
            return;
        }
        const selected = borrowers.filter((b) => selectedBorrowers.has(b.id));
        const groupRows = selected.filter(
            (b) => b.borrower_type === 'group' && !b.duplicate_of_borrower_id,
        );
        if (groupRows.length === 0) {
            toast({
                title: 'No eligible borrowers',
                description:
                    'Select main group borrowers only. Individual borrowers are not in a centre, and duplicate rows must use the main record.',
                variant: 'warning',
            });
            return;
        }
        const first = groupRows[0];
        const cid = resolveBorrowerCenterId(first);
        setTransferBorrowerIds(groupRows.map((b) => b.id));
        setTransferCenterId(cid ? String(cid) : '');
        setTransferGroupId(first.group_id ? String(first.group_id) : '');
        setTransferOpen(true);
        const skipped = selected.length - groupRows.length;
        if (skipped > 0) {
            toast({
                title: 'Note',
                description: `Only ${groupRows.length} group borrower(s) are included. ${skipped} selected row(s) (individual or duplicate) were not included in this transfer.`,
            });
        }
    }, [borrowers, selectedBorrowers, resolveBorrowerCenterId, toast]);

    const handleTransferSave = useCallback(async () => {
        if (transferBorrowerIds.length === 0) return;
        if (!transferCenterId) {
            toast({ title: 'Select a centre', description: 'Choose the destination centre.', variant: 'destructive' });
            return;
        }
        if (!transferGroupId) {
            toast({ title: 'Select a group', description: 'Choose a group in that centre.', variant: 'destructive' });
            return;
        }
        const g = groups.find((x) => String(x.id) === String(transferGroupId));
        if (!g || String(g.center_id) !== String(transferCenterId)) {
            toast({
                title: 'Invalid group',
                description: 'The group must belong to the selected centre.',
                variant: 'destructive',
            });
            return;
        }
        setTransferSaving(true);
        const { error } = await supabase
            .from('borrowers')
            .update({ center_id: transferCenterId, group_id: transferGroupId })
            .in('id', transferBorrowerIds);
        setTransferSaving(false);
        if (error) {
            toast({ title: 'Transfer failed', description: error.message, variant: 'destructive' });
            return;
        }
        toast({
            title: 'Transfer complete',
            description: `${transferBorrowerIds.length} borrower(s) updated.`,
        });
        setTransferOpen(false);
        setTransferBorrowerIds([]);
        setTransferCenterId('');
        setTransferGroupId('');
        setSelectedBorrowers(new Set());
        fetchData();
    }, [transferBorrowerIds, transferCenterId, transferGroupId, groups, toast, fetchData]);

    const handleMarkAsEligible = async () => {
        if (selectedBorrowers.size === 0) {
            toast({ title: 'No Borrowers Selected', description: 'Please select borrowers to mark as eligible.', variant: 'warning' });
            return;
        }

        const borrowersToUpdate = borrowers.filter(
            (b) => selectedBorrowers.has(b.id) && b.status === 'paid_up' && !b.duplicate_of_borrower_id,
        );
        const borrowerIdsToUpdate = borrowersToUpdate.map(b => b.id);
        const skippedDuplicate = borrowers.filter(
            (b) => selectedBorrowers.has(b.id) && b.duplicate_of_borrower_id,
        ).length;
        const nonEligibleCount = selectedBorrowers.size - borrowerIdsToUpdate.length - skippedDuplicate;

        if (borrowerIdsToUpdate.length === 0) {
            toast({
                title: 'Action Not Allowed',
                description:
                    skippedDuplicate > 0
                        ? 'Duplicate history rows cannot be marked eligible. Deselect them and use the main borrower record, or select borrowers that are "Paid Up" and not marked as duplicate.'
                        : 'None of the selected borrowers are in "Paid Up" status.',
                variant: 'warning',
            });
            return;
        }

        const { error } = await supabase
            .from('borrowers')
            .update({ status: 'eligible' })
            .in('id', borrowerIdsToUpdate);

        if (error) {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        } else {
            let successMessage = `${borrowerIdsToUpdate.length} borrower(s) marked as eligible.`;
            if (nonEligibleCount > 0) {
                successMessage += ` ${nonEligibleCount} borrower(s) were skipped as they are not "Paid Up".`;
            }
            if (skippedDuplicate > 0) {
                successMessage += ` ${skippedDuplicate} duplicate record(s) were skipped.`;
            }
            toast({ title: 'Success', description: successMessage });
            fetchData();
            setSelectedBorrowers(new Set());
        }
    };


    const handleGenerateLoanTemplate = () => {
        if (selectedBorrowers.size === 0) {
            toast({ title: 'No Borrowers Selected', description: 'Please select at least one borrower to prepare loans.', variant: 'warning' });
            return;
        }

        const skippedDups = borrowers.filter((b) => selectedBorrowers.has(b.id) && b.duplicate_of_borrower_id);
        const selectedBorrowerData = borrowers.filter(
            (b) => selectedBorrowers.has(b.id) && !b.duplicate_of_borrower_id,
        );

        if (selectedBorrowerData.length === 0) {
            toast({
                title: 'No main borrower rows selected',
                description:
                    'Duplicate records cannot be used for loan preparation. Deselect rows marked as duplicate, or add the main borrower (same person) instead.',
                variant: 'warning',
            });
            return;
        }

        if (skippedDups.length > 0) {
            toast({
                title: 'Note',
                description: `${skippedDups.length} duplicate row(s) were left out of the template. Use the main borrower for each person.`,
            });
        }

        const templateData = selectedBorrowerData.map(b => ({
            borrower_id: b.borrower_id,
            borrower_name: `${b.first_name} ${b.surname}`,
            loan_product_name: '',
            principal: '',
            disbursement_date: '',
            repayment_start_date: '',
        }));
        
        const loansSheet = XLSX.utils.json_to_sheet(templateData);
        
        const instructions = [
            ['Column Name', 'Description', 'Example'],
            ['borrower_id', 'DO NOT CHANGE. This is the unique ID of the borrower.', 'BRW-12345'],
            ['borrower_name', 'DO NOT CHANGE. Name of the borrower for reference.', 'John Doe'],
            ['loan_product_name', 'The exact name of an active loan product.', 'Personal Loan'],
            ['principal', 'The loan amount without currency symbols.', '500000'],
            ['disbursement_date', 'Date the loan is given. Format: YYYY-MM-DD.', '2025-11-09'],
            ['repayment_start_date', 'Date repayments begin. Format: YYYY-MM-DD.', '2025-12-09']
        ];
        const instructionsSheet = XLSX.utils.aoa_to_sheet(instructions);
        
        const validProducts = loanProducts.map(p => ({ 'Product Name': p.name }));
        const productsSheet = XLSX.utils.json_to_sheet(validProducts);
        
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, loansSheet, 'Prepared Loans');
        XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions');
        XLSX.utils.book_append_sheet(workbook, productsSheet, 'Valid Loan Products');
        
        XLSX.writeFile(workbook, 'Prepared_Loans_Template.xlsx');
        toast({ title: 'Template Generated', description: `Template for ${selectedBorrowerData.length} borrower(s) has been downloaded.` });
        setSelectedBorrowers(new Set());
    };

    const stats = useMemo(() => {
        return {
            total: borrowers.length,
            active: borrowers.filter((b) => b.status === 'active_loan').length,
            eligible: borrowers.filter((b) => b.status === 'eligible').length,
            defaulted: borrowers.filter((b) => b.status === 'defaulted').length,
        };
    }, [borrowers]);

    const handleSave = async (bypassSimilarName = false) => {
        setIsSaving(true);
        const { first_name, surname, phone_number, identification_number, group_id, borrower_type, center_id } = formData;
        const trim = (v) => String(v ?? '').trim();

        const missing = [];
        if (!trim(first_name)) missing.push('First name');
        if (!trim(surname)) missing.push('Surname');
        if (!formData.gender) missing.push('Gender');
        if (!trim(formData.address)) missing.push('Address');
        if (!trim(formData.business_name)) missing.push('Business name');
        if (!trim(formData.business_location)) missing.push('Business location');
        if (!formData.identification_type) missing.push('ID type');
        if (!String(identification_number ?? '').trim()) missing.push('ID number');
        if (borrower_type === 'group') {
            if (!center_id) missing.push('Centre');
            if (!group_id) missing.push('Group');
        }

        if (missing.length > 0) {
            toast({
                title: 'Missing information',
                description: `Please complete: ${missing.join(', ')}.`,
                variant: 'destructive',
            });
            setIsSaving(false);
            return;
        }

        const phoneCheck = validatePhoneNumberTenDigits(phone_number);
        if (!phoneCheck.ok) {
            toast({ title: 'Invalid phone', description: phoneCheck.error, variant: 'destructive' });
            setIsSaving(false);
            return;
        }

        if (borrower_type === 'group') {
            const g = groups.find((x) => x.id === group_id);
            if (!g || g.center_id !== center_id) {
                toast({ title: 'Error', description: 'The selected group must belong to the selected centre.', variant: 'destructive' });
                setIsSaving(false);
                return;
            }
        }

        let idNumberForSave = identification_number;
        if (isNationalIdIdentificationType(formData.identification_type)) {
            const nida = validateNidaIdentificationNumber(identification_number);
            if (!nida.ok) {
                toast({ title: 'Invalid National ID', description: nida.error, variant: 'destructive' });
                setIsSaving(false);
                return;
            }
            idNumberForSave = nida.value;
        } else if (isVotersIdIdentificationType(formData.identification_type)) {
            const vid = validateVotersIdentificationNumber(identification_number);
            if (!vid.ok) {
                toast({ title: "Invalid Voter's ID", description: vid.error, variant: 'destructive' });
                setIsSaving(false);
                return;
            }
            idNumberForSave = vid.value;
        } else if (isDriversLicenseIdentificationType(formData.identification_type)) {
            const dl = validateDriversLicenseIdentificationNumber(identification_number);
            if (!dl.ok) {
                toast({ title: "Invalid Driver's License", description: dl.error, variant: 'destructive' });
                setIsSaving(false);
                return;
            }
            idNumberForSave = dl.value;
        } else if (formData.identification_type === 'passport') {
            idNumberForSave = String(identification_number).trim();
        }

        if (!editingBorrower && identificationNumberNeedsDataReview(idNumberForSave)) {
            setIsSaving(false);
            toast({
                title: 'Registration not allowed',
                description:
                    'This ID value looks like a system-only tag. Enter the real document number (NIDA, voter ID, etc.).',
                variant: 'destructive',
            });
            return;
        }

        if (!editingBorrower && phoneNumberNeedsDataReview(phoneCheck.value)) {
            setIsSaving(false);
            toast({
                title: 'Registration not allowed',
                description: 'This phone value looks like a system-only tag. Enter a real 10-digit mobile number.',
                variant: 'destructive',
            });
            return;
        }

        const excludeId = editingBorrower ? editingBorrower.id : null;
        const dup = await fetchDuplicateBorrower(phoneCheck.value, idNumberForSave, excludeId);
        if (dup) {
            const { data: off } = await supabase
                .from('users')
                .select('full_name')
                .eq('id', dup.loan_officer_id)
                .maybeSingle();
            setIsSaving(false);
            toast({
                title: 'Already in the system',
                description: `Phone or ID is already used by ${dup.first_name} ${dup.surname} (${dup.borrower_id}).${
                    off?.full_name ? ` Borrower is assigned to officer: ${off.full_name}.` : ''
                } New registration is not allowed — use the existing borrower or change phone/ID.`,
                variant: 'destructive',
            });
            return;
        }

        const nameFirst = normalizePersonNameLettersOnly(first_name).trim();
        const nameLast = normalizePersonNameLettersOnly(surname).trim();
        if (!bypassSimilarName && nameFirst && nameLast) {
            const sim = await fetchSimilarBorrowerName(nameFirst, nameLast, excludeId);
            if (sim) {
                setSimilarNameMatch(sim);
                setSimilarNameDialogOpen(true);
                setIsSaving(false);
                return;
            }
        }

        const payload = {
            first_name: nameFirst,
            surname: nameLast,
            gender: formData.gender,
            phone_number: phoneCheck.value,
            address: trim(formData.address),
            business_name: trim(formData.business_name),
            business_location: trim(formData.business_location),
            identification_type: formData.identification_type,
            identification_number: idNumberForSave,
            borrower_type: formData.borrower_type,
            group_id: borrower_type === 'individual' ? null : group_id,
            center_id: borrower_type === 'group' ? center_id : null,
            loan_officer_id: user.id,
            branch_id: officerBranchId ?? user.user_metadata?.branch_id,
            status: editingBorrower ? editingBorrower.status : 'eligible',
        };

        if (!editingBorrower) {
            const dupBeforeInsert = await fetchDuplicateBorrower(phoneCheck.value, idNumberForSave, null);
            if (dupBeforeInsert) {
                setIsSaving(false);
                toast({
                    title: 'Registration blocked',
                    description:
                        'This phone or ID was just registered in the system. Use the existing borrower or different details.',
                    variant: 'destructive',
                });
                return;
            }
        }

        let result;
        if (editingBorrower) {
            result = await supabase.from('borrowers').update(payload).eq('id', editingBorrower.id);
        } else {
            const borrower_id = `B-${Date.now().toString().slice(-6)}`;
            result = await supabase.from('borrowers').insert({ ...payload, borrower_id });
        }

        setIsSaving(false);
        if (result.error) {
            const msg = result.error.message || '';
            if (
                msg.includes('idx_borrowers_phone_norm_unique') ||
                msg.includes('idx_borrowers_ident_norm_unique') ||
                msg.includes('idx_borrowers_phone_norm_unique_canonical') ||
                msg.includes('idx_borrowers_ident_norm_unique_canonical')
            ) {
                toast({
                    title: 'Duplicate',
                    description:
                        'Phone or ID is already registered (possibly by another officer). Fix the values or use the existing record.',
                    variant: 'destructive',
                });
            } else {
                toast({ title: 'Error saving borrower', description: msg, variant: 'destructive' });
            }
        } else {
            setSimilarNameMatch(null);
            setSimilarNameDialogOpen(false);
            fetchData();
            setDialogOpen(false);
            setEditingBorrower(null);
            toast({ title: 'Success', description: `Borrower ${editingBorrower ? 'updated' : 'registered'}.` });
        }
    };

    const handleDelete = async (borrowerId) => {
        const { error } = await supabase.from('borrowers').delete().eq('id', borrowerId);
        if (error) {
            toast({ title: 'Error deleting borrower', description: error.message, variant: 'destructive' });
        } else {
            fetchData();
            toast({ title: 'Success', description: 'Borrower deleted.' });
        }
    };
    
    const handleEdit = (borrower) => {
        setEditingBorrower(borrower);
        let centerId = borrower.center_id || null;
        const groupId = borrower.group_id || null;
        if (!centerId && groupId) {
            const g = groups.find((x) => x.id === groupId);
            if (g?.center_id) centerId = g.center_id;
        }
        let idNum = borrower.identification_number ?? '';
        if (borrower.identification_type === 'voters_id' && idNum.charAt(0) === 't') {
            idNum = `T${idNum.slice(1)}`;
        }
        setFormData({
            ...defaultFormState,
            ...borrower,
            group_id: groupId,
            center_id: centerId,
            identification_number: idNum,
        });
        setDialogOpen(true);
    };

    const handleDownloadTemplate = () => {
        if (!officerBranchId) {
            toast({
                title: 'Branch not assigned',
                description:
                    'Your officer profile has no branch. Ask an admin to assign you in User Management, then sign out and sign in again.',
                variant: 'destructive',
            });
            return;
        }
        if (centers.length === 0 || groups.length === 0) {
            toast({
                title: 'Add centres and groups first',
                description:
                    'Create at least one centre and one group under Centers & Groups before downloading the import template.',
                variant: 'destructive',
            });
            return;
        }
        const templateData = [
            {
                first_name: 'John',
                surname: 'Doe',
                gender: 'male',
                phone_number: '0712345678',
                address: '123 Main St, Dar es Salaam',
                business_name: 'Johns Store',
                business_location: 'Kariakoo',
                identification_type: 'national_id',
                identification_number: '12345678901234567890',
                borrower_type: 'group',
                center_name: centers[0]?.name ?? 'My Centre',
                group_name: groups[0]?.name ?? 'Upendo Group',
            },
            {
                first_name: 'Mary',
                surname: 'Individual',
                gender: 'female',
                phone_number: '0722111222',
                address: '456 Other St',
                business_name: 'Mary Shop',
                business_location: 'Ilala',
                identification_type: 'national_id',
                identification_number: '19876543210987654321',
                borrower_type: 'individual',
                center_name: '',
                group_name: '',
            },
        ];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(templateData), 'Borrowers');
        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.json_to_sheet(centers.map((c) => ({ center_name: c.name }))),
            'Reference_Centres',
        );
        XLSX.writeFile(wb, 'Borrowers_Import_Template.xlsx');
    };

    const handleImport = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        setIsImporting(true);
        const reader = new FileReader();
        reader.onload = async (e) => {
            const detailLines = [];
            let imported = 0;
            let skippedDuplicate = 0;
            let skippedInvalid = 0;
            let skippedNameSimilar = 0;
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName =
                    workbook.SheetNames.find((n) => /^borrowers$/i.test(n)) || workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const json = XLSX.utils.sheet_to_json(worksheet);

                const centersMap = new Map(centers.map((c) => [c.name.toLowerCase(), c.id]));
                const branchForInsert = officerBranchId ?? user.user_metadata?.branch_id ?? null;
                const seenInFile = new Set();

                for (let idx = 0; idx < json.length; idx++) {
                    const row = json[idx];
                    const rowNum = idx + 2;
                    if (!String(row.first_name ?? '').trim() && !String(row.phone_number ?? '').trim()) {
                        continue;
                    }

                    const pk = normalizeBorrowerPhoneKey(row.phone_number);
                    const idRaw = idKeyForImportDuplicateCheck(row);
                    const ik = normalizeIdKey(idRaw);
                    if (pk && seenInFile.has(`p:${pk}`)) {
                        skippedInvalid += 1;
                        detailLines.push(`Row ${rowNum}: duplicate phone in file (${row.phone_number})`);
                        continue;
                    }
                    if (ik && seenInFile.has(`i:${ik}`)) {
                        skippedInvalid += 1;
                        detailLines.push(`Row ${rowNum}: duplicate ID in file`);
                        continue;
                    }
                    if (pk) seenInFile.add(`p:${pk}`);
                    if (ik) seenInFile.add(`i:${ik}`);

                    let payload;
                    try {
                        const bt = String(row.borrower_type ?? 'group').toLowerCase();
                        const borrower_type = bt === 'individual' ? 'individual' : 'group';
                        let group_id = null;
                        let center_id = null;
                        if (borrower_type === 'group') {
                            const centerName = String(row.center_name ?? '').trim().toLowerCase();
                            const groupName = String(row.group_name ?? '').trim().toLowerCase();
                            if (!centerName || !centersMap.has(centerName)) {
                                throw new Error(
                                    `centre '${row.center_name || ''}' not found — use Reference_Centres names exactly`,
                                );
                            }
                            center_id = centersMap.get(centerName);
                            const match = groups.find(
                                (g) => g.center_id === center_id && g.name.toLowerCase() === groupName,
                            );
                            if (!groupName || !match) {
                                throw new Error(`group '${row.group_name || ''}' not found in that centre`);
                            }
                            group_id = match.id;
                        }

                        if (phoneNumberNeedsDataReview(String(row.phone_number ?? ''))) {
                            throw new Error(
                                'Phone looks like a system-only value — use a real 10-digit number in the file',
                            );
                        }
                        const phoneImp = validatePhoneNumberTenDigits(String(row.phone_number ?? ''));
                        if (!phoneImp.ok) throw new Error(phoneImp.error);
                        if (!String(row.address ?? '').trim()) throw new Error('address required');
                        if (!String(row.business_name ?? '').trim()) throw new Error('business_name required');
                        if (!String(row.business_location ?? '').trim()) throw new Error('business_location required');

                        let idNum = String(row.identification_number ?? '');
                        if (isNationalIdIdentificationType(row.identification_type)) {
                            const nida = validateNidaIdentificationNumber(idNum);
                            if (!nida.ok) throw new Error(nida.error);
                            idNum = nida.value;
                        } else if (isVotersIdIdentificationType(row.identification_type)) {
                            const vid = validateVotersIdentificationNumber(idNum);
                            if (!vid.ok) throw new Error(vid.error);
                            idNum = vid.value;
                        } else if (isDriversLicenseIdentificationType(row.identification_type)) {
                            const dl = validateDriversLicenseIdentificationNumber(idNum);
                            if (!dl.ok) throw new Error(dl.error);
                            idNum = dl.value;
                        } else if (String(row.identification_type ?? '').toLowerCase() === 'passport') {
                            idNum = String(idNum).trim();
                            if (!idNum) throw new Error('passport number required');
                        }

                        if (identificationNumberNeedsDataReview(idNum)) {
                            throw new Error(
                                'ID looks like a system-only value — use the real document number in the file',
                            );
                        }

                        payload = {
                            first_name: normalizePersonNameLettersOnly(String(row.first_name ?? '')).trim(),
                            surname: normalizePersonNameLettersOnly(String(row.surname ?? '')).trim(),
                            gender: row.gender,
                            phone_number: phoneImp.value,
                            address: String(row.address ?? '').trim(),
                            business_name: String(row.business_name ?? '').trim(),
                            business_location: String(row.business_location ?? '').trim(),
                            identification_type: row.identification_type,
                            identification_number: idNum,
                            borrower_type,
                            group_id,
                            center_id,
                            loan_officer_id: user.id,
                            branch_id: branchForInsert,
                            status: 'eligible',
                            borrower_id: `B-${Date.now().toString().slice(-6)}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
                        };
                    } catch (err) {
                        skippedInvalid += 1;
                        detailLines.push(`Row ${rowNum}: ${err.message}`);
                        continue;
                    }

                    const dup = await fetchDuplicateBorrower(payload.phone_number, payload.identification_number, null);
                    if (dup) {
                        skippedDuplicate += 1;
                        detailLines.push(`Row ${rowNum}: already exists (${dup.borrower_id})`);
                        continue;
                    }

                    const nameSim = await fetchSimilarBorrowerName(
                        payload.first_name,
                        payload.surname,
                        null,
                    );
                    if (nameSim) {
                        skippedNameSimilar += 1;
                        detailLines.push(
                            `Row ${rowNum}: name very similar to ${nameSim.borrower_id} (${nameSim.first_name} ${nameSim.surname})`,
                        );
                        continue;
                    }

                    const { error: insErr } = await supabase.from('borrowers').insert([payload]);
                    if (insErr) {
                        if (
                            insErr.message?.includes('idx_borrowers_phone_norm_unique') ||
                            insErr.message?.includes('idx_borrowers_ident_norm_unique') ||
                            insErr.message?.includes('idx_borrowers_phone_norm_unique_canonical') ||
                            insErr.message?.includes('idx_borrowers_ident_norm_unique_canonical')
                        ) {
                            skippedDuplicate += 1;
                            detailLines.push(`Row ${rowNum}: duplicate phone/ID in database`);
                        } else {
                            skippedInvalid += 1;
                            detailLines.push(`Row ${rowNum}: ${insErr.message}`);
                        }
                    } else {
                        imported += 1;
                    }
                }

                const summary = `Imported: ${imported}. Skipped (duplicate): ${skippedDuplicate}. Skipped (similar name): ${skippedNameSimilar}. Skipped (invalid): ${skippedInvalid}.`;
                if (imported === 0 && skippedDuplicate === 0 && skippedInvalid === 0) {
                    toast({ title: 'Warning', description: 'No borrower rows found in the file.', variant: 'default' });
                } else {
                    toast({
                        title: 'Import finished',
                        description: summary + (detailLines.length ? ` Details (first 5): ${detailLines.slice(0, 5).join('; ')}` : ''),
                        variant: imported === 0 && skippedDuplicate + skippedInvalid > 0 ? 'destructive' : 'default',
                    });
                    fetchData();
                }
            } catch (err) {
                toast({ title: 'Import Error', description: err.message, variant: 'destructive' });
            } finally {
                setIsImporting(false);
                event.target.value = null;
            }
        };
        reader.readAsArrayBuffer(file);
    };

    const getGroupName = (groupId) => groups.find(g => g.id === groupId)?.name || 'N/A';
    
    const getLoanStatusBadge = (status) => {
      const statusMap = {
        'eligible': 'success',
        'active_loan': 'warning',
        'defaulted': 'destructive',
        'paid_up': 'default',
      };
      return statusMap[status] || 'default';
    };

    const getStatusText = (status) => {
        const statusTextMap = {
            'eligible': 'Eligible',
            'active_loan': 'Active Loan',
            'defaulted': 'Defaulted',
            'paid_up': 'Paid Up',
        };
        return statusTextMap[status] || status;
    }


    if (loading) return <DashboardLayout title="Borrower Management"><div className="flex justify-center items-center h-full">Loading...</div></DashboardLayout>;

    return (
        <DashboardLayout title="Borrower Management">
            <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button
                            variant="outline"
                            onClick={handleDownloadTemplate}
                            disabled={borrowerTemplateDownloadBlocked}
                            title={borrowerTemplateDownloadTitle}
                        >
                            <Download className="mr-2 h-4 w-4" /> Template
                        </Button>
                        <Button onClick={() => importFileRef.current.click()} disabled={isImporting}>
                            {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />} Import
                        </Button>
                        <input type="file" ref={importFileRef} className="hidden" accept=".csv, .xlsx" onChange={handleImport} />
                        <Dialog open={dialogOpen} onOpenChange={(isOpen) => { if (!isOpen) { setEditingBorrower(null); setFormData(defaultFormState); } setDialogOpen(isOpen); }}>
                            <DialogTrigger asChild>
                                <Button onClick={() => { setFormData(defaultFormState); setEditingBorrower(null); }}><PlusCircle className="mr-2 h-4 w-4" /> Register</Button>
                            </DialogTrigger>
                            <DialogContent
                                className={cn(
                                    'flex h-[min(90dvh,40rem)] w-[min(100vw-1rem,42rem)] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0',
                                    'sm:h-[min(90dvh,44rem)] sm:max-w-2xl',
                                )}
                            >
                                <DialogHeader className="shrink-0 space-y-1 border-b border-border/60 bg-muted/30 px-4 py-4 text-left sm:px-5">
                                    <DialogTitle className="pr-8 text-lg font-semibold tracking-tight sm:text-xl">
                                        {editingBorrower ? 'Edit borrower' : 'New borrower'}
                                    </DialogTitle>
                                    <DialogDescription className="sr-only">
                                        {editingBorrower
                                            ? 'Update borrower details. All visible fields are required when shown.'
                                            : 'Register a new borrower. All visible fields are required when shown.'}
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
                                    <div className="space-y-5 sm:space-y-6">
                                        <section
                                            className="rounded-xl border border-border/80 bg-card p-4 shadow-sm sm:p-5"
                                            aria-labelledby="borrower-section-personal"
                                        >
                                            <div
                                                id="borrower-section-personal"
                                                className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground"
                                            >
                                                <User className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                                                Personal
                                            </div>
                                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-x-4 sm:gap-y-4">
                                                <div className="space-y-2 sm:min-w-0">
                                                    <Label className="text-sm">
                                                        First name <FieldRequired />
                                                    </Label>
                                                    <Input
                                                        className="h-10 w-full"
                                                        value={formData.first_name}
                                                        onChange={(e) =>
                                                            setFormData({
                                                                ...formData,
                                                                first_name: normalizePersonNameLettersOnly(
                                                                    e.target.value,
                                                                ),
                                                            })
                                                        }
                                                        autoComplete="given-name"
                                                    />
                                                </div>
                                                <div className="space-y-2 sm:min-w-0">
                                                    <Label className="text-sm">
                                                        Surname <FieldRequired />
                                                    </Label>
                                                    <Input
                                                        className="h-10 w-full"
                                                        value={formData.surname}
                                                        onChange={(e) =>
                                                            setFormData({
                                                                ...formData,
                                                                surname: normalizePersonNameLettersOnly(e.target.value),
                                                            })
                                                        }
                                                        autoComplete="family-name"
                                                    />
                                                </div>
                                                <div className="space-y-2 sm:min-w-0">
                                                    <Label className="text-sm">
                                                        Gender <FieldRequired />
                                                    </Label>
                                                    <Select
                                                        value={formData.gender}
                                                        onValueChange={(v) => setFormData({ ...formData, gender: v })}
                                                    >
                                                        <SelectTrigger className="h-10 w-full">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="male">Male</SelectItem>
                                                            <SelectItem value="female">Female</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                        </section>

                                        <section
                                            className="rounded-xl border border-border/80 bg-card p-4 shadow-sm sm:p-5"
                                            aria-labelledby="borrower-section-contact"
                                        >
                                            <div
                                                id="borrower-section-contact"
                                                className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground"
                                            >
                                                <Phone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                                                Contact &amp; ID
                                            </div>
                                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-x-4 sm:gap-y-4">
                                                <div className="space-y-2 sm:min-w-0 sm:col-span-2">
                                                    <Label className="text-sm">
                                                        Mobile <FieldRequired />
                                                    </Label>
                                                    <Input
                                                        className="h-10 w-full font-mono text-base tracking-wide sm:text-sm"
                                                        placeholder={`${PHONE_DIGIT_LENGTH} digits`}
                                                        value={formData.phone_number}
                                                        onChange={(e) =>
                                                            setFormData({
                                                                ...formData,
                                                                phone_number: normalizePhoneDigitsMax10(e.target.value),
                                                            })
                                                        }
                                                        inputMode="numeric"
                                                        maxLength={PHONE_DIGIT_LENGTH}
                                                        autoComplete="tel"
                                                    />
                                                </div>
                                                <div className="space-y-2 sm:min-w-0">
                                                    <Label className="text-sm">
                                                        ID type <FieldRequired />
                                                    </Label>
                                                    <Select
                                                        value={formData.identification_type}
                                                        onValueChange={(v) =>
                                                            setFormData((prev) => ({
                                                                ...prev,
                                                                identification_type: v,
                                                                ...(v === 'voters_id' && prev.identification_type !== 'voters_id'
                                                                    ? { identification_number: 'T' }
                                                                    : {}),
                                                            }))
                                                        }
                                                    >
                                                        <SelectTrigger className="h-10 w-full">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="national_id">National ID</SelectItem>
                                                            <SelectItem value="passport">Passport</SelectItem>
                                                            <SelectItem value="drivers_license">Driver&apos;s License</SelectItem>
                                                            <SelectItem value="voters_id">Voter&apos;s ID</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2 sm:min-w-0">
                                                    <Label className="text-sm">
                                                        {identificationNumberLabel} <FieldRequired />
                                                    </Label>
                                                    <Input
                                                        className={cn(
                                                            'h-10 w-full',
                                                            formData.identification_type === 'voters_id' && 'font-semibold',
                                                        )}
                                                        inputMode={
                                                            formData.identification_type === 'national_id' ||
                                                            formData.identification_type === 'drivers_license'
                                                                ? 'numeric'
                                                                : undefined
                                                        }
                                                        maxLength={
                                                            formData.identification_type === 'national_id'
                                                                ? NIDA_DIGIT_LENGTH
                                                                : formData.identification_type === 'voters_id'
                                                                  ? VOTERS_ID_MAX_INPUT_LENGTH
                                                                  : formData.identification_type === 'drivers_license'
                                                                    ? DRIVER_LICENSE_DIGIT_LENGTH
                                                                    : undefined
                                                        }
                                                        value={formData.identification_number}
                                                        onChange={(e) => {
                                                            let v = e.target.value;
                                                            if (formData.identification_type === 'national_id') {
                                                                v = normalizeNidaDigits(e.target.value).slice(
                                                                    0,
                                                                    NIDA_DIGIT_LENGTH,
                                                                );
                                                            } else if (formData.identification_type === 'voters_id') {
                                                                v = normalizeVotersIdInput(e.target.value);
                                                            } else if (formData.identification_type === 'drivers_license') {
                                                                v = normalizeDriversLicenseDigits(e.target.value);
                                                            }
                                                            setFormData({ ...formData, identification_number: v });
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        </section>

                                        <section
                                            className="rounded-xl border border-border/80 bg-card p-4 shadow-sm sm:p-5"
                                            aria-labelledby="borrower-section-address"
                                        >
                                            <div
                                                id="borrower-section-address"
                                                className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground"
                                            >
                                                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                                                Address
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-sm">
                                                    Residential address <FieldRequired />
                                                </Label>
                                                <Input
                                                    className="h-10 w-full min-w-0"
                                                    value={formData.address}
                                                    onChange={(e) =>
                                                        setFormData({ ...formData, address: e.target.value })
                                                    }
                                                    autoComplete="street-address"
                                                />
                                            </div>
                                        </section>

                                        <section
                                            className="rounded-xl border border-border/80 bg-card p-4 shadow-sm sm:p-5"
                                            aria-labelledby="borrower-section-business"
                                        >
                                            <div
                                                id="borrower-section-business"
                                                className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground"
                                            >
                                                <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                                                Business
                                            </div>
                                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-x-4 sm:gap-y-4">
                                                <div className="space-y-2 sm:min-w-0">
                                                    <Label className="text-sm">
                                                        Business name <FieldRequired />
                                                    </Label>
                                                    <Input
                                                        className="h-10 w-full"
                                                        value={formData.business_name}
                                                        onChange={(e) =>
                                                            setFormData({ ...formData, business_name: e.target.value })
                                                        }
                                                    />
                                                </div>
                                                <div className="space-y-2 sm:min-w-0">
                                                    <Label className="text-sm">
                                                        Business location <FieldRequired />
                                                    </Label>
                                                    <Input
                                                        className="h-10 w-full"
                                                        value={formData.business_location}
                                                        onChange={(e) =>
                                                            setFormData({
                                                                ...formData,
                                                                business_location: e.target.value,
                                                            })
                                                        }
                                                    />
                                                </div>
                                            </div>
                                        </section>

                                        <section
                                            className="rounded-xl border border-border/80 bg-card p-4 shadow-sm sm:p-5"
                                            aria-labelledby="borrower-section-type"
                                        >
                                            <div
                                                id="borrower-section-type"
                                                className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground"
                                            >
                                                <Users2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                                                Membership
                                            </div>
                                            <div className="space-y-4">
                                                <div className="space-y-2">
                                                    <Label className="text-sm">
                                                        Type <FieldRequired />
                                                    </Label>
                                                    <Select
                                                        value={formData.borrower_type}
                                                        onValueChange={(v) =>
                                                            setFormData({
                                                                ...formData,
                                                                borrower_type: v,
                                                                group_id: null,
                                                                center_id: null,
                                                            })
                                                        }
                                                    >
                                                        <SelectTrigger className="h-10 w-full">
                                                            <SelectValue placeholder="Select" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="individual">Individual</SelectItem>
                                                            <SelectItem value="group">Group</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                {formData.borrower_type === 'group' && (
                                                    <div className="grid grid-cols-1 gap-4 border-t border-border/60 pt-4 sm:grid-cols-2 sm:gap-x-4">
                                                        <div className="space-y-2 sm:min-w-0 sm:col-span-2 sm:max-w-md">
                                                            <Label className="text-sm">
                                                                Centre <FieldRequired />
                                                            </Label>
                                                            <Select
                                                                value={formData.center_id ?? undefined}
                                                                onValueChange={(v) =>
                                                                    setFormData({ ...formData, center_id: v, group_id: null })
                                                                }
                                                            >
                                                                <SelectTrigger className="h-10 w-full">
                                                                    <SelectValue placeholder="Select centre" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {centers.map((c) => (
                                                                        <SelectItem key={c.id} value={c.id}>
                                                                            {c.name}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                            {centers.length === 0 && (
                                                                <p className="text-xs text-muted-foreground sm:text-sm">
                                                                    Add a centre in Centers &amp; Groups first.
                                                                </p>
                                                            )}
                                                        </div>
                                                        <div className="space-y-2 sm:min-w-0 sm:col-span-2 sm:max-w-md">
                                                            <Label className="text-sm">
                                                                Group <FieldRequired />
                                                            </Label>
                                                            <Select
                                                                value={formData.group_id ?? undefined}
                                                                onValueChange={(v) =>
                                                                    setFormData({ ...formData, group_id: v })
                                                                }
                                                                disabled={
                                                                    !formData.center_id ||
                                                                    groupsInSelectedCenter.length === 0
                                                                }
                                                            >
                                                                <SelectTrigger className="h-10 w-full">
                                                                    <SelectValue
                                                                        placeholder={
                                                                            formData.center_id
                                                                                ? 'Select group'
                                                                                : 'Select centre first'
                                                                        }
                                                                    />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {groupsInSelectedCenter.map((g) => (
                                                                        <SelectItem key={g.id} value={g.id}>
                                                                            {g.name}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </section>
                                    </div>
                                </div>
                                <div className="flex shrink-0 flex-col gap-2 border-t border-border/60 bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:flex-row sm:justify-end sm:px-5">
                                    <Button
                                        className="h-11 w-full min-h-[2.75rem] sm:h-10 sm:min-h-0 sm:w-auto sm:min-w-[8rem]"
                                        onClick={handleSave}
                                        disabled={isSaving}
                                    >
                                        {isSaving ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                                            </>
                                        ) : editingBorrower ? (
                                            'Save'
                                        ) : (
                                            'Register'
                                        )}
                                    </Button>
                                </div>
                            </DialogContent>
                        </Dialog>

                        <AlertDialog
                            open={similarNameDialogOpen}
                            onOpenChange={(open) => {
                                setSimilarNameDialogOpen(open);
                                if (!open) setSimilarNameMatch(null);
                            }}
                        >
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Very similar name on file</AlertDialogTitle>
                                    <AlertDialogDescription asChild>
                                        <div className="space-y-2 text-left text-sm text-muted-foreground">
                                            <p>Another main borrower has a very similar name:</p>
                                            <p className="font-medium text-foreground">
                                                {similarNameMatch?.first_name} {similarNameMatch?.surname}{' '}
                                                <span className="font-mono text-sm">
                                                    ({similarNameMatch?.borrower_id})
                                                </span>
                                            </p>
                                            {similarNameMatch?.name_similarity != null && (
                                                <p className="text-xs text-muted-foreground">
                                                    Name similarity: {Number(similarNameMatch.name_similarity).toFixed(2)}
                                                </p>
                                            )}
                                            <p>Continue only if you are sure this is a <strong>different person</strong>.</p>
                                        </div>
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Back</AlertDialogCancel>
                                    <AlertDialogAction
                                        onClick={() => {
                                            setSimilarNameDialogOpen(false);
                                            handleSave(true);
                                        }}
                                    >
                                        Register as new person
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>

                        <Dialog
                            open={transferOpen}
                            onOpenChange={(o) => {
                                setTransferOpen(o);
                                if (!o) {
                                    setTransferBorrowerIds([]);
                                    setTransferCenterId('');
                                    setTransferGroupId('');
                                }
                            }}
                        >
                            <DialogContent className="sm:max-w-md">
                                <DialogHeader>
                                    <DialogTitle>Transfer centre / group</DialogTitle>
                                    <DialogDescription>
                                        Move {transferBorrowerIds.length === 1 ? 'this group borrower' : 'these group borrowers'}{' '}
                                        to another centre (or another group in your portfolio). The borrower
                                        {transferBorrowerIds.length === 1 ? ' stays' : 's stay'} assigned to you as loan
                                        officer.
                                    </DialogDescription>
                                </DialogHeader>
                                {transferBorrowerIds.length === 1 ? (
                                    (() => {
                                        const b = borrowers.find((x) => x.id === transferBorrowerIds[0]);
                                        if (!b) return null;
                                        const cur = resolveBorrowerCenterId(b);
                                        return (
                                            <p className="text-sm text-foreground">
                                                <span className="font-semibold">
                                                    {b.first_name} {b.surname}
                                                </span>{' '}
                                                <span className="font-mono text-xs">({b.borrower_id})</span>
                                                <span className="text-muted-foreground"> — current centre: </span>
                                                <span className="font-medium">{getCenterName(cur)}</span>
                                            </p>
                                        );
                                    })()
                                ) : transferBorrowerIds.length > 1 ? (
                                    <p className="text-sm text-foreground">
                                        <span className="font-semibold">{transferBorrowerIds.length} group borrowers</span>{' '}
                                        will all be moved to the same destination centre and group.
                                    </p>
                                ) : null}
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="transfer-centre">Centre</Label>
                                        <Select
                                            value={transferCenterId || undefined}
                                            onValueChange={setTransferCenterId}
                                        >
                                            <SelectTrigger id="transfer-centre" className="w-full">
                                                <SelectValue placeholder="Select centre" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {centers.map((c) => (
                                                    <SelectItem key={c.id} value={String(c.id)}>
                                                        {c.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="transfer-group">Group</Label>
                                        <Select
                                            value={transferGroupId || undefined}
                                            onValueChange={setTransferGroupId}
                                            disabled={!transferCenterId}
                                        >
                                            <SelectTrigger
                                                id="transfer-group"
                                                className="w-full disabled:cursor-not-allowed disabled:opacity-60"
                                                title={!transferCenterId ? 'Select a centre first' : undefined}
                                            >
                                                <SelectValue
                                                    placeholder={
                                                        !transferCenterId ? 'Select centre first' : 'Select group'
                                                    }
                                                />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {groupsInTransferCenter.map((g) => (
                                                    <SelectItem key={g.id} value={String(g.id)}>
                                                        {g.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        {transferCenterId && groupsInTransferCenter.length === 0 && (
                                            <p className="text-xs text-destructive">
                                                No groups in this centre. Add a group in Centres & Groups first.
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <DialogFooter className="gap-2 sm:gap-0">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => setTransferOpen(false)}
                                        disabled={transferSaving}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        type="button"
                                        onClick={handleTransferSave}
                                        disabled={transferSaving || !transferCenterId || !transferGroupId}
                                    >
                                        {transferSaving ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                Saving…
                                            </>
                                        ) : (
                                            'Save transfer'
                                        )}
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>

                        <AlertDialog open={!!deleteTargetId} onOpenChange={(o) => !o && setDeleteTargetId(null)}>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Delete borrower?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This will delete the borrower and related records. This action cannot be undone.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                        onClick={() => {
                                            if (deleteTargetId) handleDelete(deleteTargetId);
                                            setDeleteTargetId(null);
                                        }}
                                    >
                                        Delete
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <StatCard title="Total Borrowers" value={stats.total} icon={Users} color="text-primary" />
                    <StatCard title="Active Loans" value={stats.active} icon={UserCheck} color="text-yellow-600" />
                    <StatCard title="Eligible for Loan" value={stats.eligible} icon={UserPlusIcon} color="text-green-600" />
                    <StatCard title="Defaulted" value={stats.defaulted} icon={UserX} color="text-red-600" />
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-4">
                            <CardTitle>My Borrowers</CardTitle>
                            <div className="flex w-full flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-end">
                                <div className="min-w-0 flex-1 lg:min-w-[12rem]">
                                    <Input
                                        placeholder="Search ID, name, phone, NIDA…"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full"
                                    />
                                </div>
                                <Select
                                    value={centerFilter}
                                    onValueChange={setCenterFilter}
                                >
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
                                                centerFilter === 'all'
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
                                <Select value={statusFilter} onValueChange={setStatusFilter}>
                                    <SelectTrigger className="w-full min-w-0 sm:min-w-[10rem] lg:w-[11rem]">
                                        <SelectValue placeholder="Status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All statuses</SelectItem>
                                        <SelectItem value="eligible">Eligible</SelectItem>
                                        <SelectItem value="active_loan">Active Loan</SelectItem>
                                        <SelectItem value="defaulted">Defaulted</SelectItem>
                                        <SelectItem value="paid_up">Paid Up</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Select value={idReviewFilter} onValueChange={setIdReviewFilter}>
                                    <SelectTrigger className="w-full min-w-0 sm:min-w-[10rem] lg:w-[13rem]">
                                        <SelectValue placeholder="Data flags" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All (row flags)</SelectItem>
                                        <SelectItem value="needs_review">Legacy tag (red)</SelectItem>
                                        <SelectItem value="is_duplicate">Duplicate (amber)</SelectItem>
                                        <SelectItem value="ok">No flags</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {idReviewCount > 0 && (
                            <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                                <div>
                                    <span className="font-medium">{idReviewCount} borrower(s)</span> have a temporary
                                    phone or ID tag from old cleanup. Rows are{' '}
                                    <span className="font-medium">highlighted in red</span> — open{' '}
                                    <strong>Edit</strong> and enter the real phone and document number, then save.
                                </div>
                            </div>
                        )}
                        {duplicateRowCount > 0 && (
                            <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                                <div>
                                    <span className="font-medium">{duplicateRowCount} record(s)</span> are stored as
                                    <span className="font-medium"> duplicate history</span> (same person as another
                                    row). They are <span className="font-medium">highlighted in amber</span> — for new
                                    loans and products, use the <strong>main</strong> borrower. New registrations
                                    with the same phone or ID are still blocked.
                                </div>
                            </div>
                        )}
                       {selectedBorrowers.size > 0 && (
                            <div className="bg-primary/10 border-l-4 border-primary p-4 mb-4 rounded-r-lg flex justify-between items-center">
                                <p className="font-medium text-foreground">{selectedBorrowers.size} borrower(s) selected.</p>
                                <div className="flex flex-wrap gap-2">
                                    <Button onClick={handleMarkAsEligible} variant="secondary">
                                        <CheckCircle className="mr-2 h-4 w-4"/>
                                        Mark as Eligible
                                    </Button>
                                    <Button onClick={openTransferBulk} variant="secondary">
                                        <ArrowRightLeft className="mr-2 h-4 w-4"/>
                                        Transfer
                                    </Button>
                                    <Button onClick={handleGenerateLoanTemplate}>
                                        <FileSpreadsheet className="mr-2 h-4 w-4"/>
                                        Prepare Loans
                                    </Button>
                                </div>
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
                                            disabled={paginatedBorrowers.length === 0}
                                            aria-label="Select all on this page"
                                        />
                                    </TableHead>
                                    <TableHead className="border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                        Borrower ID
                                    </TableHead>
                                    <TableHead className="min-w-[8rem] border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                        Name
                                    </TableHead>
                                    <TableHead className="min-w-[7rem] border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                        ID number
                                    </TableHead>
                                    <TableHead className="border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                        Phone
                                    </TableHead>
                                    <TableHead className="border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                        Group
                                    </TableHead>
                                    <TableHead className="border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                        Loan status
                                    </TableHead>
                                    <TableHead className="min-w-[10.5rem] border border-slate-300 bg-slate-100 px-2 py-2 text-left text-xs font-bold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                        Actions
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {paginatedBorrowers.map(b => {
                                    const idTagged = identificationNumberNeedsDataReview(b.identification_number);
                                    const phoneTagged = phoneNumberNeedsDataReview(b.phone_number);
                                    const needsDataFix = idTagged || phoneTagged;
                                    const isDup = borrowerRowIsDuplicateRecord(b);
                                    const dupCanon = b.duplicate_of_borrower_id
                                        ? duplicateCanonicalById[b.duplicate_of_borrower_id]
                                        : null;
                                    const dupMatchLine = isDup && dupCanon ? duplicateRowMatchSummary(b, dupCanon) : '';
                                    return (
                                    <TableRow
                                        key={b.id}
                                        data-state={selectedBorrowers.has(b.id) && "selected"}
                                        className={cn(
                                            'border-slate-200 dark:border-slate-700',
                                            needsDataFix && 'bg-destructive/[0.08]',
                                            isDup && !needsDataFix && 'bg-amber-500/[0.07]',
                                        )}
                                    >
                                        <TableCell className="border border-slate-300 px-1 py-1.5 dark:border-slate-600">
                                           <Checkbox
                                                checked={selectedBorrowers.has(b.id)}
                                                onCheckedChange={(checked) => handleSelectBorrower(b.id, checked)}
                                           />
                                        </TableCell>
                                        <TableCell className={cn('border border-slate-300 font-mono text-xs dark:border-slate-600', needsDataFix && 'text-destructive')}>{b.borrower_id}</TableCell>
                                        <TableCell className="border border-slate-300 align-top dark:border-slate-600">
                                            <div className="flex flex-col gap-1">
                                            <span className={cn(needsDataFix && 'text-destructive font-medium')}>
                                                {b.first_name} {b.surname}
                                            </span>
                                            {needsDataFix && (
                                                <Badge variant="destructive" className="w-fit text-[0.65rem]">
                                                    {idTagged && phoneTagged
                                                        ? 'Fix ID & phone'
                                                        : idTagged
                                                          ? 'Fix ID'
                                                          : 'Fix phone'}
                                                </Badge>
                                            )}
                                            {isDup && (
                                                <div className="flex min-w-0 flex-col gap-0.5">
                                                    <Badge
                                                        variant="outline"
                                                        className="w-fit shrink-0 border-amber-600/60 text-[0.65rem] text-amber-900 dark:text-amber-100"
                                                    >
                                                        {dupCanon
                                                            ? `Duplicate of ${dupCanon.borrower_id}`
                                                            : 'Duplicate record'}
                                                    </Badge>
                                                    {dupMatchLine && (
                                                        <span className="text-[0.65rem] text-amber-900/90 dark:text-amber-100/90" title="Match vs main record">
                                                            {dupMatchLine}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="border border-slate-300 align-top dark:border-slate-600">
                                            <div className="flex flex-col gap-1">
                                                <span
                                                    className={cn(
                                                        'font-mono text-xs break-all',
                                                        idTagged ? 'text-destructive' : 'text-foreground',
                                                    )}
                                                >
                                                    {b.identification_number || '—'}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell
                                            className={cn(
                                                'border border-slate-300 font-mono text-xs dark:border-slate-600',
                                                phoneTagged && 'text-destructive',
                                            )}
                                        >
                                            {b.phone_number}
                                        </TableCell>
                                        <TableCell className="border border-slate-300 dark:border-slate-600">{b.borrower_type === 'group' ? getGroupName(b.group_id) : 'Individual'}</TableCell>
                                        <TableCell className="border border-slate-300 dark:border-slate-600"><Badge variant={getLoanStatusBadge(b.status)}>{getStatusText(b.status)}</Badge></TableCell>
                                        <TableCell className="border border-slate-300 p-1.5 dark:border-slate-600">
                                            <div className="flex flex-nowrap items-center justify-end gap-1">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="icon"
                                                    className="h-8 w-8 shrink-0 rounded-md"
                                                    onClick={() => navigate(`/officer/borrowers/${b.id}`)}
                                                    title="View"
                                                    aria-label="View borrower"
                                                >
                                                    <Eye className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="icon"
                                                    className="h-8 w-8 shrink-0 rounded-md"
                                                    onClick={() => handleEdit(b)}
                                                    title="Edit"
                                                    aria-label="Edit borrower"
                                                >
                                                    <Edit className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="icon"
                                                    className="h-8 w-8 shrink-0 rounded-md"
                                                    onClick={() => openTransferFromBorrower(b)}
                                                    disabled={b.borrower_type !== 'group' || !!b.duplicate_of_borrower_id}
                                                    title={
                                                        b.borrower_type !== 'group'
                                                            ? 'Transfer applies to group borrowers only'
                                                            : b.duplicate_of_borrower_id
                                                              ? 'Use the main borrower record to transfer'
                                                              : 'Transfer centre / group'
                                                    }
                                                    aria-label="Transfer centre or group"
                                                >
                                                    <ArrowRightLeft className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="destructive"
                                                    size="icon"
                                                    className="h-8 w-8 shrink-0 rounded-md"
                                                    onClick={() => setDeleteTargetId(b.id)}
                                                    title="Delete"
                                                    aria-label="Delete borrower"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );})}
                            </TableBody>
                        </Table>
                        </div>
                        <div className="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-sm text-muted-foreground">
                                {filteredBorrowers.length === 0
                                    ? 'Showing 0 of 0'
                                    : (() => {
                                          const from = (currentPage - 1) * BORROWER_PAGE_SIZE + 1;
                                          const to = Math.min(currentPage * BORROWER_PAGE_SIZE, filteredBorrowers.length);
                                          return `Showing ${from}–${to} of ${filteredBorrowers.length}`;
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

export default BorrowerManagement;