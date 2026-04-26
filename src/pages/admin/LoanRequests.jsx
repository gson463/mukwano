import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { CheckCircle, RotateCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/customSupabaseClient';
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

const AdminLoanRequests = () => {
  const { toast } = useToast();
  const [requests, setRequests] = useState([]);
  const [branches, setBranches] = useState([]);
  const [centers, setCenters] = useState([]);
  const [groups, setGroups] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [centerFilter, setCenterFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);

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

  const filteredRequests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return requests.filter((loan) => {
      const b = loan.borrowers;
      const officerUser = loan.users;
      const branchMatch =
        branchFilter === 'all' ||
        officerUser?.branch_id === branchFilter ||
        b?.branch_id === branchFilter;
      const centerId = b ? resolveBorrowerCenterId(b, groups) : null;
      const centerMatch = centerFilter === 'all' || centerId === centerFilter;
      const groupMatch = groupFilter === 'all' || b?.group_id === groupFilter;
      if (!branchMatch || !centerMatch || !groupMatch) return false;
      if (!q) return true;
      const loanId = (loan.loan_id || '').toString().toLowerCase();
      const borrower = b
        ? `${b.first_name} ${b.surname}`.toLowerCase()
        : '';
      const officer = officerUser ? (officerUser.full_name || '').toLowerCase() : '';
      return (
        loanId.includes(q) ||
        borrower.includes(q) ||
        officer.includes(q) ||
        String(loan.principal).includes(q)
      );
    });
  }, [requests, searchQuery, branchFilter, centerFilter, groupFilter, groups]);

  const totalPages = useMemo(
    () => getTotalPages(filteredRequests.length, DEFAULT_TABLE_PAGE_SIZE),
    [filteredRequests.length],
  );

  const paginatedRequests = useMemo(
    () => slicePage(filteredRequests, currentPage, DEFAULT_TABLE_PAGE_SIZE),
    [filteredRequests, currentPage],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, branchFilter, centerFilter, groupFilter]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    const [loansRes, branchesRes, centersRes, groupsRes] = await Promise.all([
      supabase
        .from('loans')
        .select(
          `
        *,
        borrowers (first_name, surname, group_id, center_id, branch_id),
        users (full_name, branch_id)
      `,
        )
        .eq('status', 'delete_approved_manager'),
      supabase.from('branches').select('id, name'),
      supabase.from('centers').select('id, name, branch_id'),
      supabase.from('groups').select('*'),
    ]);

    if (loansRes.error) {
      toast({ title: 'Error', description: 'Could not fetch loan deletion requests.', variant: 'destructive' });
    } else {
      setRequests(loansRes.data || []);
    }
    if (!branchesRes.error) setBranches(branchesRes.data || []);
    if (!centersRes.error) setCenters(centersRes.data || []);
    if (!groupsRes.error) setGroups(groupsRes.data || []);
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleFinalApprove = async (loanId) => {
    const { error } = await supabase.from('loans').delete().eq('id', loanId);
    if (error) {
      toast({ title: 'Error', description: `Failed to delete loan: ${error.message}`, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Loan has been permanently deleted.' });
      fetchData();
    }
  };

  return (
    <DashboardLayout title="Loan Deletion Requests">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4">
              <div>
                <CardTitle>Pending Final Approval ({filteredRequests.length})</CardTitle>
                <CardDescription>These loans have been approved for deletion by a Branch Manager.</CardDescription>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <Input
                  placeholder="Search: loan ID, borrower, officer, principal…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="min-w-[200px] max-w-md flex-1"
                  disabled={isLoading}
                />
                <Select value={branchFilter} onValueChange={setBranchFilter} disabled={isLoading}>
                  <SelectTrigger className="w-full min-w-[10rem] max-w-[14rem]">
                    <SelectValue placeholder="Branch" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All branches</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={centerFilter} onValueChange={setCenterFilter} disabled={isLoading}>
                  <SelectTrigger className="w-full min-w-[10rem] max-w-[14rem]">
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
                <Select value={groupFilter} onValueChange={setGroupFilter} disabled={isLoading}>
                  <SelectTrigger className="w-full min-w-[10rem] max-w-[14rem]">
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
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center items-center py-10">
                <RotateCw className="h-6 w-6 animate-spin text-gray-500" />
                <span className="ml-2">Loading Requests...</span>
              </div>
            ) : (
              <>
              <div className={excelTableWrapperClassName}>
                <Table className={excelTableClassName}>
                  <TableHeader>
                    <TableRow className={excelTableRowClassName}>
                      <TableHead className={excelThClassName()}>Loan ID</TableHead>
                      <TableHead className={excelThClassName()}>Borrower</TableHead>
                      <TableHead className={excelThClassName()}>Loan Officer</TableHead>
                      <TableHead className={excelThClassName()}>Principal</TableHead>
                      <TableHead className={excelThClassName()}>Status</TableHead>
                      <TableHead className={excelThClassName()}>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className={excelEmptyStateCellClassName}>
                          No pending requests found.
                        </TableCell>
                      </TableRow>
                    ) : filteredRequests.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className={excelEmptyStateCellClassName}>
                          No requests match the search.
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedRequests.map((loan) => (
                        <TableRow key={loan.id} className={excelTableRowClassName}>
                          <TableCell className={excelTdClassName()}>{loan.loan_id}</TableCell>
                          <TableCell className={excelTdClassName()}>
                            {loan.borrowers
                              ? `${loan.borrowers.first_name} ${loan.borrowers.surname}`
                              : 'N/A'}
                          </TableCell>
                          <TableCell className={excelTdClassName()}>
                            {loan.users ? loan.users.full_name : 'N/A'}
                          </TableCell>
                          <TableCell className={excelTdClassName()}>
                            TZS {loan.principal.toLocaleString()}
                          </TableCell>
                          <TableCell className={excelTdClassName()}>
                            <Badge variant="warning">Manager Approved</Badge>
                          </TableCell>
                          <TableCell className={excelTdClassName()}>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="sm">
                                  <CheckCircle className="mr-2 h-4 w-4" /> Finalize Deletion
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This action is irreversible. The loan and all its associated data will be permanently deleted from the system.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleFinalApprove(loan.id)}>Yes, Delete Permanently</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
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
                totalCount={filteredRequests.length}
                pageSize={DEFAULT_TABLE_PAGE_SIZE}
                disabled={requests.length === 0}
              />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default AdminLoanRequests;