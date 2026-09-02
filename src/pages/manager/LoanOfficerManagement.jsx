import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from '@/components/ui/use-toast';
import { PlusCircle, Loader2, Trash2, Edit } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
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

import { getManagerBranchId } from '@/lib/managerBranch';

const LoanOfficerManagement = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [officers, setOfficers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [noBranchForManager, setNoBranchForManager] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOfficer, setEditingOfficer] = useState(null);
  const [formData, setFormData] = useState({ full_name: '', email: '', password: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const fetchOfficers = useCallback(async () => {
    if (!user) {
      setOfficers([]);
      setNoBranchForManager(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setNoBranchForManager(false);

    const branchId = await getManagerBranchId(user);
    if (!branchId) {
      setOfficers([]);
      setNoBranchForManager(true);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('role', 'officer')
      .eq('branch_id', branchId);

    if (error) {
      toast({ title: 'Error', description: 'Failed to fetch loan officers.', variant: 'destructive' });
      console.error(error);
    } else {
      setOfficers(data);
    }
    setLoading(false);
  }, [user, toast]);

  useEffect(() => {
    fetchOfficers();
  }, [fetchOfficers]);

  const filteredOfficers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return officers;
    return officers.filter(
      (o) =>
        (o.full_name && o.full_name.toLowerCase().includes(q)) ||
        (o.email && o.email.toLowerCase().includes(q)),
    );
  }, [officers, searchQuery]);

  const totalPages = useMemo(
    () => getTotalPages(filteredOfficers.length, DEFAULT_TABLE_PAGE_SIZE),
    [filteredOfficers.length],
  );

  const paginatedOfficers = useMemo(
    () => slicePage(filteredOfficers, currentPage, DEFAULT_TABLE_PAGE_SIZE),
    [filteredOfficers, currentPage],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const handleOpenDialog = (officer = null) => {
    if (officer) {
      setEditingOfficer(officer);
      setFormData({
        full_name: officer.full_name,
        email: officer.email,
        password: '', // Clear password for reset
      });
    } else {
      setEditingOfficer(null);
      setFormData({ full_name: '', email: '', password: '' });
    }
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    let error;

    if (editingOfficer) {
      if (!formData.password) {
        toast({ title: 'Error', description: 'Please enter a new password to reset.', variant: 'destructive' });
        setSaving(false);
        return;
      }
      const { error: invokeError } = await supabase.functions.invoke('update-user', {
        body: {
          userId: editingOfficer.id,
          password: formData.password,
        },
      });
      error = invokeError;
    } else { // Creating a new user
      if (!formData.full_name || !formData.email || !formData.password) {
        toast({ title: 'Error', description: 'Please fill all fields.', variant: 'destructive' });
        setSaving(false);
        return;
      }
      const branchId = await getManagerBranchId(user);
      if (!branchId) {
        toast({
          title: 'Error',
          description: 'Your account is not linked to a branch. Ask an administrator to assign you to a branch.',
          variant: 'destructive',
        });
        setSaving(false);
        return;
      }
      const { error: invokeError } = await supabase.functions.invoke('create-user', {
        body: {
          ...formData,
          role: 'officer',
          branch_id: branchId,
        },
      });
      error = invokeError;
    }

    setSaving(false);
    if (error) {
      const errorData = await error.context.json();
      toast({ title: `Error ${editingOfficer ? 'updating' : 'creating'} officer`, description: errorData.error, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: `Officer ${editingOfficer ? 'password reset' : 'registered'} successfully.` });
      setDialogOpen(false);
      fetchOfficers();
    }
  };

  const handleDelete = async (officerId) => {
    const { error } = await supabase.functions.invoke('delete-user', {
        body: { userId: officerId }
    });
    
    if (error) {
      const errorData = await error.context.json();
      toast({ title: 'Error', description: `Failed to delete officer: ${errorData.error}`, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Loan Officer deleted successfully.' });
      fetchOfficers();
    }
  };
  
  const getBadgeVariant = (isActive) => {
    return isActive ? 'success' : 'destructive';
  }

  const isCreateFlow = !editingOfficer;

  return (
    <DashboardLayout title="Loan Officer Management">
      <div className="mb-6 flex flex-wrap items-center justify-end gap-2">
        <Button onClick={() => handleOpenDialog()} disabled={noBranchForManager && !loading}>
          <PlusCircle className="mr-2 h-4 w-4" /> Register Officer
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingOfficer ? `Edit Officer: ${editingOfficer.full_name}` : 'Register New Loan Officer'}</DialogTitle>
            {editingOfficer && <CardDescription>You can only reset the password for this user.</CardDescription>}
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="officer-name">Name</Label>
              <Input id="officer-name" placeholder="John Doe" value={formData.full_name} onChange={e => setFormData({ ...formData, full_name: e.target.value })} disabled={!isCreateFlow} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="officer-email">Email</Label>
              <Input id="officer-email" type="email" placeholder="officer@example.com" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} disabled={!isCreateFlow} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="officer-password">Password</Label>
              <Input id="officer-password" type="password" placeholder={editingOfficer ? 'Enter new password to reset' : '••••••••'} value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} />
            </div>
            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingOfficer ? 'Reset Password' : 'Register Officer'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3">
            <CardTitle>Your loan officers ({filteredOfficers.length})</CardTitle>
            <Input
              placeholder="Search name or email…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-md"
              disabled={loading}
            />
          </div>
        </CardHeader>
        <CardContent>
            {loading ? <div className="text-center p-8">Loading officers...</div> :
            <>
            {noBranchForManager && (
              <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Your profile is not linked to a branch, so you cannot list or register loan officers. An administrator
                must assign you as the manager of a branch.
              </p>
            )}
            <div className={excelTableWrapperClassName}>
            <Table className={excelTableClassName}>
                <TableHeader>
                <TableRow className="hover:bg-transparent">
                    <TableHead className={excelThClassName()}>Name</TableHead>
                    <TableHead className={excelThClassName('min-w-[12rem]')}>Email</TableHead>
                    <TableHead className={excelThClassName()}>Status</TableHead>
                    <TableHead className={excelThClassName('min-w-[8rem] text-right')}>Actions</TableHead>
                </TableRow>
                </TableHeader>
                <TableBody>
                {officers.length > 0 ? (filteredOfficers.length === 0 ? (
                    <TableRow>
                        <TableCell colSpan={4} className={excelEmptyStateCellClassName}>
                          No loan officers match the search.
                        </TableCell>
                    </TableRow>
                ) : (
                    paginatedOfficers.map(officer => (
                    <TableRow key={officer.id} className={excelTableRowClassName}>
                      <TableCell className={excelTdClassName('font-medium')}>{officer.full_name}</TableCell>
                      <TableCell className={excelTdClassName()}>{officer.email}</TableCell>
                      <TableCell className={excelTdClassName()}><Badge variant={getBadgeVariant(officer.is_active)}>{officer.is_active ? 'Active' : 'Inactive'}</Badge></TableCell>
                      <TableCell className={excelTdClassName('p-1.5 text-right')}>
                        <div className="inline-flex flex-nowrap items-center justify-end gap-1">
                        <Button variant="outline" size="icon" onClick={() => handleOpenDialog(officer)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="icon">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This action cannot be undone. This will permanently delete the loan officer. Make sure they have no associated data.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(officer.id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                ))
                )) : (
                    <TableRow>
                        <TableCell colSpan={4} className={excelEmptyStateCellClassName}>No loan officers found for this branch.</TableCell>
                    </TableRow>
                )}
                </TableBody>
            </Table>
            </div>
            <TablePaginationBar
                currentPage={currentPage}
                setCurrentPage={setCurrentPage}
                totalCount={filteredOfficers.length}
                pageSize={DEFAULT_TABLE_PAGE_SIZE}
                disabled={loading}
            />
            </>
            }
        </CardContent>
      </Card>
    </DashboardLayout>
  );
};

export default LoanOfficerManagement;