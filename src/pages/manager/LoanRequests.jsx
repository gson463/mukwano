import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { CheckCircle, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { generateSchedule } from '@/utils/loanUtils';
import { toZonedTime, format as formatTZ } from 'date-fns-tz';
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
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const EAT_TIMEZONE = 'Africa/Nairobi';


const LoanRequests = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [requests, setRequests] = useState([]);
  const [loanProducts, setLoanProducts] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [currency, setCurrency] = useState('TZS');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);

  const branchId = user?.user_metadata?.branch_id;

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const { data: config } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
    if (config) setCurrency(config.value);

    const { data: productsData, error: productsError } = await supabase.from('loan_products').select('*');
    if (productsError) {
      toast({ title: "Error", description: productsError.message, variant: "destructive" });
    } else {
      setLoanProducts(productsData || []);
    }
    
    const { data: holidaysData, error: holidaysError } = await supabase.from('holidays').select('*');
    if (holidaysError) {
        toast({ title: 'Error fetching holidays', description: holidaysError.message, variant: 'destructive' });
    } else {
        setHolidays(holidaysData || []);
    }

    const { data: requestsData, error: requestsError } = await supabase
      .from('loans')
      .select(`*, borrowers(first_name, surname), officer:users!officer_id(full_name, branch_id)`)
      .in('status', ['delete_requested', 'edit_requested']);

    if (requestsError) {
      toast({ title: "Error", description: requestsError.message, variant: "destructive" });
    } else {
      setRequests(requestsData || []);
    }
    setLoading(false);
  }, [user, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const branchRequests = useMemo(() => {
    if (!branchId) return [];
    return (requests || []).filter((l) => l.officer?.branch_id === branchId);
  }, [requests, branchId]);

  const filteredRequests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return branchRequests.filter((loan) => {
      if (typeFilter === 'delete_requested' && loan.status !== 'delete_requested') return false;
      if (typeFilter === 'edit_requested' && loan.status !== 'edit_requested') return false;
      if (!q) return true;
      const loanId = (loan.loan_id || '').toString().toLowerCase();
      const borrower = loan.borrowers
        ? `${loan.borrowers.first_name} ${loan.borrowers.surname}`.toLowerCase()
        : '';
      const off = loan.officer ? (loan.officer.full_name || '').toLowerCase() : '';
      return (
        loanId.includes(q) ||
        borrower.includes(q) ||
        off.includes(q) ||
        String(loan.principal).includes(q)
      );
    });
  }, [branchRequests, searchQuery, typeFilter]);

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
  }, [searchQuery, typeFilter, branchId]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const handleApproveDeletion = async (loanId) => {
    const { error } = await supabase.from('loans').update({ status: 'delete_approved_manager' }).eq('id', loanId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      fetchData();
      toast({ title: 'Success', description: 'Deletion request approved and sent to Admin for final review.' });
    }
  };

  const handleApproveEdit = async (loan) => {
    const { edit_request } = loan;
    const product = loanProducts.find(p => p.id === edit_request.productId);
    
    if (!product) {
        toast({ title: 'Error', description: 'Loan product for the edit not found.', variant: 'destructive' });
        return;
    }

    const principal = parseFloat(edit_request.principal);
    const interest = principal * (parseFloat(product.interest_rate) / 100);
    const totalPayable = principal + interest;
    
    // Recalculate balance based on what was paid
    const paidAmount = loan.total_payable - loan.balance;
    const newBalance = Math.max(0, totalPayable - paidAmount);
    
    // Recalculate outstanding interest
    const originalInterest = loan.total_payable - loan.principal;
    const paidTowardsOriginalPrincipal = Math.max(0, paidAmount - originalInterest);
    const paidTowardsOriginalInterest = paidAmount - paidTowardsOriginalPrincipal;
    const newOutstandingInterest = Math.max(0, interest - paidTowardsOriginalInterest);

    const formattedRepaymentStartDate = formatTZ(toZonedTime(edit_request.repaymentStartDate, EAT_TIMEZONE), 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE });

    const schedule =
        Array.isArray(edit_request.newSchedule) && edit_request.newSchedule.length > 0
            ? edit_request.newSchedule
            : generateSchedule(
                  principal,
                  parseFloat(product.interest_rate),
                  totalPayable,
                  product.loan_period,
                  product.loan_period_unit,
                  product.repayment_frequency,
                  formattedRepaymentStartDate,
                  holidays,
              );

    const updatedLoan = {
      product_id: edit_request.productId,
      disbursement_date: formatTZ(toZonedTime(edit_request.disbursementDate, EAT_TIMEZONE), 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE }),
      repayment_start_date: formattedRepaymentStartDate,
      principal: principal,
      interest_rate: product.interest_rate,
      repayment_frequency: product.repayment_frequency,
      period: product.loan_period,
      period_unit: product.loan_period_unit,
      total_payable: totalPayable,
      balance: newBalance,
      outstanding_interest: newOutstandingInterest,
      status: 'active',
      schedule,
      edit_request: null,
    };
    
    const { error } = await supabase.from('loans').update(updatedLoan).eq('id', loan.id);
    if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
        const { error: recalcErr } = await supabase.rpc('recalculate_loan_schedule', { p_loan_id: loan.id });
        const { error: statusErr } = await supabase.rpc('update_all_loan_statuses');
        if (recalcErr || statusErr) {
            console.error(recalcErr || statusErr);
            toast({
                title: 'Loan updated',
                description:
                    'Changes were saved but synchronizing the repayment schedule failed. Use View schedule on the loan or try again.',
                variant: 'destructive',
            });
        } else {
            toast({ title: 'Success', description: 'Loan edit approved and schedule updated.' });
        }
        fetchData();
    }
  };

  const handleRejectRequest = async (loanId) => {
    const { error } = await supabase.from('loans').update({ status: 'active', edit_request: null }).eq('id', loanId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      fetchData();
      toast({ title: 'Rejected', description: 'The request has been rejected.' });
    }
  };

  const renderRequestDetails = (loan) => {
    if (loan.status === 'edit_requested' && loan.edit_request) {
      const { edit_request } = loan;
      const newProduct = loanProducts.find(p => p.id === edit_request.productId);
      return (
        <div className="text-xs text-gray-500 space-y-1 mt-1">
          <p><strong>New Principal:</strong> {currency} {Number(edit_request.principal).toLocaleString()}</p>
          <p><strong>New Product:</strong> {newProduct?.name}</p>
          <p><strong>New Disbursement:</strong> {edit_request.disbursementDate}</p>
          <p><strong>New Repayment Start:</strong> {edit_request.repaymentStartDate}</p>
        </div>
      );
    }
    return null;
  };
  
  if (loading) return <DashboardLayout title="Loan Requests"><div className="flex items-center justify-center h-full">Loading Requests...</div></DashboardLayout>;

  return (
    <DashboardLayout title="Loan Requests">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4">
              <div>
                <CardTitle>Pending your approval ({filteredRequests.length})</CardTitle>
                <CardDescription>
                  Requests from loan officers in your branch: deletion or edit before you forward to admin (where required).
                </CardDescription>
              </div>
              {!branchId && (
                <p className="text-sm text-destructive">Your account has no branch assigned; no requests can be listed.</p>
              )}
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[200px] flex-1 max-w-md space-y-1">
                  <span className="text-sm text-muted-foreground">Search</span>
                  <Input
                    placeholder="Loan ID, borrower, officer, amount…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    disabled={loading || !branchId}
                  />
                </div>
                <div className="w-full min-w-[11rem] max-w-xs space-y-1">
                  <span className="text-sm text-muted-foreground">Request type</span>
                  <Select value={typeFilter} onValueChange={setTypeFilter} disabled={loading || !branchId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="delete_requested">Delete</SelectItem>
                      <SelectItem value="edit_requested">Edit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className={excelTableWrapperClassName}>
            <Table className={excelTableClassName}>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className={excelThClassName('font-mono')}>Loan ID</TableHead>
                  <TableHead className={excelThClassName('min-w-[7rem]')}>Borrower</TableHead>
                  <TableHead className={excelThClassName()}>Loan officer</TableHead>
                  <TableHead className={excelThClassName()}>Request type</TableHead>
                  <TableHead className={excelThClassName('min-w-[12rem]')}>Details</TableHead>
                  <TableHead className={excelThClassName('min-w-[10rem] text-right')}>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!branchId ? (
                  <TableRow>
                    <TableCell colSpan={6} className={excelEmptyStateCellClassName}>
                      Assign a branch to your user to see requests from your officers.
                    </TableCell>
                  </TableRow>
                ) : branchRequests.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className={excelEmptyStateCellClassName}>
                      No pending requests from your branch officers.
                    </TableCell>
                  </TableRow>
                ) : filteredRequests.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className={excelEmptyStateCellClassName}>
                      No requests match the search or type filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedRequests.map((loan) => (
                  <TableRow key={loan.id} className={excelTableRowClassName}>
                    <TableCell className={excelTdClassName('font-mono text-xs')}>{loan.loan_id}</TableCell>
                    <TableCell className={excelTdClassName()}>
                      {loan.borrowers ? `${loan.borrowers.first_name} ${loan.borrowers.surname}` : 'N/A'}
                    </TableCell>
                    <TableCell className={excelTdClassName()}>{loan.officer?.full_name ?? 'N/A'}</TableCell>
                    <TableCell className={excelTdClassName()}>
                      <Badge variant={loan.status === 'edit_requested' ? 'warning' : 'destructive'}>
                        {loan.status.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className={excelTdClassName()}>
                      <p>{currency} {Number(loan.principal).toLocaleString()}</p>
                      {renderRequestDetails(loan)}
                    </TableCell>
                    <TableCell className={excelTdClassName('p-1.5 text-right')}>
                      <div className="flex flex-nowrap items-center justify-end gap-1">
                      {loan.status === 'delete_requested' && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button size="sm" variant="outline"><CheckCircle className="mr-2 h-4 w-4" /> Approve</Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>Approve Deletion Request?</AlertDialogTitle><AlertDialogDescription>This forwards the request to Admin for final approval.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleApproveDeletion(loan.id)}>Yes, Approve</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                       {loan.status === 'edit_requested' && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button size="sm" variant="outline"><CheckCircle className="mr-2 h-4 w-4" /> Approve</Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>Approve Loan Edit?</AlertDialogTitle><AlertDialogDescription>This will apply the requested changes to the loan.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleApproveEdit(loan)}>Yes, Approve</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                      <AlertDialog>
                        <AlertDialogTrigger asChild><Button size="sm" variant="destructive"><XCircle className="mr-2 h-4 w-4" /> Reject</Button></AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader><AlertDialogTitle>Reject Request?</AlertDialogTitle><AlertDialogDescription>This will reject the request and revert the loan status.</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleRejectRequest(loan.id)}>Yes, Reject</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
                )}
              </TableBody>
            </Table>
            </div>
            {branchId && (
              <TablePaginationBar
                currentPage={currentPage}
                setCurrentPage={setCurrentPage}
                totalCount={filteredRequests.length}
                pageSize={DEFAULT_TABLE_PAGE_SIZE}
                disabled={loading}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default LoanRequests;