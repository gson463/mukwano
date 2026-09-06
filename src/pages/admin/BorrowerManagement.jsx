import React, { useState, useEffect, useMemo, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Edit, Loader2 } from 'lucide-react';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
    shouldIncludeBorrowerByStatusAndSearch,
    borrowerMatchesGeneralSearch,
    BORROWER_ADMIN_LIST_SELECT,
    fetchNonActiveBorrowersByNameOrId,
    fetchBorrowersWithOpenLoans,
} from '@/lib/borrowerListFilters';

const AdminBorrowerManagement = () => {
    const { toast } = useToast();
    const [borrowers, setBorrowers] = useState([]);
    const [searchExtraBorrowers, setSearchExtraBorrowers] = useState([]);
    const [branches, setBranches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('active_loan');
    const [branchFilter, setBranchFilter] = useState('all');
    const [centerFilter, setCenterFilter] = useState('all');
    const [groupFilter, setGroupFilter] = useState('all');
    const [centers, setCenters] = useState([]);
    const [groups, setGroups] = useState([]);
    const [editingBorrower, setEditingBorrower] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [openLoanBorrowers, centersRes, groupsRes, branchesRes] = await Promise.all([
                fetchBorrowersWithOpenLoans(supabase, { select: BORROWER_ADMIN_LIST_SELECT }),
                supabase.from('centers').select('id, name, branch_id'),
                supabase.from('groups').select('id, name, center_id'),
                supabase.from('branches').select('id, name').order('name'),
            ]);

            setBorrowers(openLoanBorrowers || []);

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
            if (branchesRes.error) {
                toast({ title: 'Error fetching branches', description: branchesRes.error.message, variant: 'destructive' });
            } else {
                setBranches(branchesRes.data || []);
            }
        } catch (error) {
            toast({
                title: 'Error fetching borrowers',
                description: error?.message || 'Failed to load borrowers with active loans',
                variant: 'destructive',
            });
            setBorrowers([]);
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        const q = searchQuery.trim();
        const statusNeedsLoad =
            statusFilter === 'eligible' ||
            statusFilter === 'defaulted' ||
            statusFilter === 'paid_up';

        let cancelled = false;

        const load = async () => {
            try {
                const excludeIds = new Set(borrowers.map((b) => b.id));
                const bySearch =
                    q.length >= 2
                        ? await fetchNonActiveBorrowersByNameOrId(supabase, {
                              searchQuery: q,
                              select: BORROWER_ADMIN_LIST_SELECT,
                              excludeBorrowerIds: excludeIds,
                          })
                        : [];

                let byStatus = [];
                if (statusNeedsLoad) {
                    const { data, error } = await supabase
                        .from('borrowers')
                        .select(BORROWER_ADMIN_LIST_SELECT)
                        .eq('status', statusFilter)
                        .order('first_name')
                        .limit(500);
                    if (error) throw error;
                    byStatus = data || [];
                }

                const map = new Map();
                for (const b of [...bySearch, ...byStatus]) {
                    if (b?.id) map.set(b.id, b);
                }
                if (!cancelled) setSearchExtraBorrowers([...map.values()]);
            } catch (e) {
                console.error(e);
                if (!cancelled) setSearchExtraBorrowers([]);
            }
        };

        const t = setTimeout(load, q.length >= 2 ? 300 : 0);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [searchQuery, statusFilter, borrowers]);

    const allBorrowersForFilters = useMemo(() => {
        const byId = new Map();
        for (const b of borrowers) byId.set(b.id, b);
        for (const b of searchExtraBorrowers) byId.set(b.id, b);
        return [...byId.values()];
    }, [borrowers, searchExtraBorrowers]);

    const branchOptions = useMemo(() => {
        return (branches || [])
            .map((b) => [b.id, b.name])
            .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    }, [branches]);

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

    const filteredBorrowers = useMemo(() => {
        return allBorrowersForFilters.filter((b) => {
            if (!shouldIncludeBorrowerByStatusAndSearch(b, { searchQuery, statusFilter })) {
                return false;
            }
            const matchesSearch = borrowerMatchesGeneralSearch(b, searchQuery, [
                b.users?.full_name,
                b.branches?.name,
                b.groups?.name,
            ]);
            const matchesBranch =
                branchFilter === 'all' || (b.branches?.id && b.branches.id === branchFilter);
            const cId = resolveBorrowerCenterId(b, groups);
            const matchesCenter = centerFilter === 'all' || cId === centerFilter;
            const matchesGroup = groupFilter === 'all' || b.group_id === groupFilter;
            return matchesSearch && matchesBranch && matchesCenter && matchesGroup;
        });
    }, [
        allBorrowersForFilters,
        groups,
        searchQuery,
        statusFilter,
        branchFilter,
        centerFilter,
        groupFilter,
    ]);

    const totalPages = useMemo(
        () => getTotalPages(filteredBorrowers.length, DEFAULT_TABLE_PAGE_SIZE),
        [filteredBorrowers.length],
    );

    const paginatedBorrowers = useMemo(
        () => slicePage(filteredBorrowers, currentPage, DEFAULT_TABLE_PAGE_SIZE),
        [filteredBorrowers, currentPage],
    );

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, statusFilter, branchFilter, centerFilter, groupFilter]);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const handleEditStatus = (borrower) => {
        setEditingBorrower(borrower);
    };

    const handleUpdateStatus = async (newStatus) => {
        if (!editingBorrower) return;
        setIsSaving(true);
        
        const { error } = await supabase
            .from('borrowers')
            .update({ status: newStatus })
            .eq('id', editingBorrower.id);

        setIsSaving(false);
        if (error) {
            toast({ title: 'Error updating status', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Success', description: 'Borrower status updated.' });
            setEditingBorrower(null);
            fetchData();
        }
    };
    
    const getLoanStatusBadge = (status) => {
        const statusMap = {
            'eligible': 'success',
            'active': 'primary',
            'active_loan': 'warning',
            'defaulted': 'destructive',
            'paid_up': 'default',
        };
        return statusMap[status] || 'secondary';
    };

    const getStatusText = (status) => {
        const statusTextMap = {
            'eligible': 'Eligible',
            'active': 'Active',
            'active_loan': 'Active Loan',
            'defaulted': 'Defaulted',
            'paid_up': 'Paid Up',
        };
        return statusTextMap[status] || status;
    };
    
    if (loading) return <DashboardLayout title="All Borrowers"><div className="flex justify-center items-center h-full">Loading...</div></DashboardLayout>;

    return (
        <DashboardLayout title="All Borrowers">
            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-4">
                        <CardTitle>Borrowers with Active Loans ({filteredBorrowers.length})</CardTitle>
                        <div className="flex flex-wrap items-center gap-2">
                            <Input
                                placeholder="Search name or borrower ID (eligible / paid-up appear here)…"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="min-w-[200px] flex-1 md:max-w-md"
                            />
                            <Select value={branchFilter} onValueChange={setBranchFilter}>
                                <SelectTrigger className="w-full sm:w-[200px]">
                                    <SelectValue placeholder="Branch" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All branches</SelectItem>
                                    {branchOptions.map(([id, name]) => (
                                        <SelectItem key={id} value={id}>
                                            {name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={centerFilter} onValueChange={setCenterFilter}>
                                <SelectTrigger className="w-full sm:w-[200px]">
                                    <SelectValue placeholder="Center" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All centers</SelectItem>
                                    {centersInSelect.map((c) => (
                                        <SelectItem key={c.id} value={c.id}>
                                            {c.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={groupFilter} onValueChange={setGroupFilter}>
                                <SelectTrigger className="w-full sm:w-[200px]">
                                    <SelectValue placeholder="Group" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All groups</SelectItem>
                                    {groupsInSelect.map((g) => (
                                        <SelectItem key={g.id} value={g.id}>
                                            {g.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger className="w-full sm:w-[200px]">
                                    <SelectValue placeholder="Status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="active_loan">With active loan</SelectItem>
                                    <SelectItem value="eligible">Eligible</SelectItem>
                                    <SelectItem value="defaulted">Defaulted</SelectItem>
                                    <SelectItem value="paid_up">Paid Up</SelectItem>
                                    <SelectItem value="all">All (search for non-active)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className={excelTableWrapperClassName}>
                        <Table className={excelTableClassName}>
                            <TableHeader>
                                <TableRow className={excelTableRowClassName}>
                                    <TableHead className={excelThClassName()}>Borrower ID</TableHead>
                                    <TableHead className={excelThClassName()}>Name</TableHead>
                                    <TableHead className={excelThClassName()}>Branch</TableHead>
                                    <TableHead className={excelThClassName()}>Loan officer</TableHead>
                                    <TableHead className={excelThClassName()}>Status</TableHead>
                                    <TableHead className={excelThClassName()}>Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredBorrowers.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className={excelEmptyStateCellClassName}>
                                            No borrowers match the filters.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    paginatedBorrowers.map(b => (
                                        <TableRow key={b.id} className={excelTableRowClassName}>
                                            <TableCell className={excelTdClassName()}>{b.borrower_id}</TableCell>
                                            <TableCell className={excelTdClassName()}>
                                                {b.first_name} {b.surname}
                                            </TableCell>
                                            <TableCell className={excelTdClassName()}>{b.branches?.name || 'N/A'}</TableCell>
                                            <TableCell className={excelTdClassName()}>{b.users?.full_name || 'N/A'}</TableCell>
                                            <TableCell className={excelTdClassName()}>
                                                <Badge variant={getLoanStatusBadge(b.status)}>{getStatusText(b.status)}</Badge>
                                            </TableCell>
                                            <TableCell className={excelTdClassName()}>
                                                <Button variant="outline" size="icon" onClick={() => handleEditStatus(b)}>
                                                    <Edit className="h-4 w-4" />
                                                </Button>
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
                        totalCount={filteredBorrowers.length}
                        pageSize={DEFAULT_TABLE_PAGE_SIZE}
                    />
                </CardContent>
            </Card>

            <Dialog open={!!editingBorrower} onOpenChange={(isOpen) => !isOpen && setEditingBorrower(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Update Borrower Status</DialogTitle>
                        <DialogDescription>
                            Manually change the status for {editingBorrower?.first_name} {editingBorrower?.surname}. Use with caution.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="status-select" className="text-right">Status</Label>
                            <Select
                                id="status-select"
                                defaultValue={editingBorrower?.status}
                                onValueChange={(newStatus) => handleUpdateStatus(newStatus)}
                            >
                                <SelectTrigger className="col-span-3">
                                    <SelectValue placeholder="Select a status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="eligible">Eligible</SelectItem>
                                    <SelectItem value="active">Active</SelectItem>
                                    <SelectItem value="active_loan">Active Loan</SelectItem>
                                    <SelectItem value="defaulted">Defaulted</SelectItem>
                                    <SelectItem value="paid_up">Paid Up</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                     {isSaving && <div className="flex justify-center items-center"><Loader2 className="h-6 w-6 animate-spin"/></div>}
                </DialogContent>
            </Dialog>

        </DashboardLayout>
    );
};

export default AdminBorrowerManagement;