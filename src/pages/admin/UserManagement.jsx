import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { motion } from 'framer-motion';
import { PlusCircle, Edit, Trash2, RotateCw, ShieldAlert, Eye, Loader2 } from 'lucide-react';
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
import { adminCentersForSelect, adminGroupsForSelect } from '@/lib/adminHierarchyFilters';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import {
  saveAdminImpersonationBackupSilent,
  clearAdminImpersonationBackup,
  readAdminImpersonationBackup,
  hasStoredAdminImpersonationBackup,
  notifyImpersonationChange,
  impersonationDashboardPath,
} from '@/lib/adminImpersonation';

const UserManagement = () => {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [centers, setCenters] = useState([]);
  const [groups, setGroups] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({ full_name: '', email: '', password: '', role: '', branch_id: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [centerFilter, setCenterFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [impersonatingId, setImpersonatingId] = useState(null);
  const { toast } = useToast();

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

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return users.filter((u) => {
      const matchText =
        !q ||
        (u.full_name && u.full_name.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q));
      const matchRole = roleFilter === 'all' || u.role === roleFilter;
      const matchBranch =
        branchFilter === 'all' ||
        (branchFilter === 'none' && !u.branch_id) ||
        (u.branch_id && u.branch_id === branchFilter);
      const center = centerFilter !== 'all' ? centers.find((c) => c.id === centerFilter) : null;
      const group = groupFilter !== 'all' ? groups.find((g) => g.id === groupFilter) : null;
      const matchCenter =
        centerFilter === 'all' ||
        (center && u.role === 'admin') ||
        (center && u.id === center?.loan_officer_id) ||
        (center && u.role === 'manager' && u.branch_id === center.branch_id);
      const matchGroup =
        groupFilter === 'all' ||
        (group && u.role === 'admin') ||
        (group && u.id === group?.loan_officer_id) ||
        (group &&
          u.role === 'manager' &&
          centers.find((c) => c.id === group.center_id)?.branch_id === u.branch_id);
      return matchText && matchRole && matchBranch && matchCenter && matchGroup;
    });
  }, [users, userSearch, roleFilter, branchFilter, centerFilter, groupFilter, centers, groups]);

  const totalPages = useMemo(
    () => getTotalPages(filteredUsers.length, DEFAULT_TABLE_PAGE_SIZE),
    [filteredUsers.length],
  );

  const paginatedUsers = useMemo(
    () => slicePage(filteredUsers, currentPage, DEFAULT_TABLE_PAGE_SIZE),
    [filteredUsers, currentPage],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [userSearch, roleFilter, branchFilter, centerFilter, groupFilter]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    const { data: usersData, error: usersError } = await supabase
      .from('users')
      .select('*, branches(name)');
      
    if (usersError) {
      toast({ title: 'Error', description: 'Could not fetch users.', variant: 'destructive' });
    } else {
      setUsers(usersData);
    }
    
    const { data: branchesData, error: branchesError } = await supabase
      .from('branches')
      .select('id, name');

    if (branchesError) {
      toast({ title: 'Error', description: 'Could not fetch branches.', variant: 'destructive' });
    } else {
      setBranches(branchesData);
    }

    const { data: centersData, error: centersError } = await supabase
      .from('centers')
      .select('id, name, branch_id, loan_officer_id');
    if (centersError) {
      toast({ title: 'Error', description: 'Could not fetch centers.', variant: 'destructive' });
    } else {
      setCenters(centersData || []);
    }
    const { data: groupsData, error: groupsError } = await supabase.from('groups').select('*');
    if (groupsError) {
      toast({ title: 'Error', description: 'Could not fetch groups.', variant: 'destructive' });
    } else {
      setGroups(groupsData || []);
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const restoreAdminSessionFromSilentBackup = async () => {
    const b = readAdminImpersonationBackup();
    if (b?.access_token && b?.refresh_token) {
      const { error } = await supabase.auth.setSession({
        access_token: b.access_token,
        refresh_token: b.refresh_token,
      });
      if (error) console.error(error);
    }
    clearAdminImpersonationBackup();
  };

  const handleImpersonate = async (row) => {
    if (hasStoredAdminImpersonationBackup()) {
      toast({
        title: 'Already impersonating',
        description: 'End impersonation using the amber banner first.',
        variant: 'destructive',
      });
      return;
    }

    setImpersonatingId(row.id);
    try {
      await supabase.auth.refreshSession();
      const {
        data: { session: freshSession },
        error: sessErr,
      } = await supabase.auth.getSession();
      if (sessErr || !freshSession?.access_token || !freshSession?.refresh_token) {
        toast({ title: 'Session error', description: 'Sign in again and retry.', variant: 'destructive' });
        return;
      }
      if (row.id === freshSession.user?.id) {
        toast({ title: 'Cannot impersonate yourself', variant: 'destructive' });
        return;
      }

      saveAdminImpersonationBackupSilent(freshSession);

      const { data, error: invokeError } = await supabase.functions.invoke('impersonate-start', {
        body: { user_id: row.id },
      });

      const token_hash = typeof data?.token_hash === 'string' ? data.token_hash : null;

      if (invokeError || !token_hash) {
        let serverMsg = invokeError?.message || 'Edge function failed.';
        if (invokeError?.context && typeof invokeError.context.json === 'function') {
          try {
            const errBody = await invokeError.context.json();
            if (errBody?.error && typeof errBody.error === 'string') serverMsg = errBody.error;
          } catch {
            /* ignore */
          }
        }
        await restoreAdminSessionFromSilentBackup();
        toast({
          title: 'Impersonation failed',
          description: `${serverMsg} Deploy the impersonate-start Edge Function if missing (supabase/functions/impersonate-start).`,
          variant: 'destructive',
        });
        return;
      }

      // Supabase JS requires only token_hash + type when verifying hashed magic-link tokens.
      let { error: voErr } = await supabase.auth.verifyOtp({
        token_hash,
        type: 'magiclink',
      });
      if (voErr) {
        ({ error: voErr } = await supabase.auth.verifyOtp({
          token_hash,
          type: 'email',
        }));
      }
      if (voErr) {
        await restoreAdminSessionFromSilentBackup();
        toast({
          title: 'Could not switch user',
          description: voErr.message || 'Token verification failed.',
          variant: 'destructive',
        });
        return;
      }

      notifyImpersonationChange();
      const impersonatedRole = (data?.target_role || row.role || '').toString().trim().toLowerCase();
      const dest = impersonationDashboardPath(impersonatedRole);
      toast({
        title: `Viewing as ${row.full_name}`,
        description:
          impersonatedRole === 'manager' && !row.branch_id
            ? 'Use “End impersonation” to return to admin. Assign a branch if this manager has none.'
            : 'Use “End impersonation” at the top to return to admin.',
      });
      navigate(dest, { replace: true });
    } finally {
      setImpersonatingId(null);
    }
  };

  const handleOpenDialog = (user = null) => {
    if (user) {
      setEditingUser(user);
      setFormData({ 
        full_name: user.full_name, 
        email: user.email, 
        password: '', // Reset password field
        role: user.role, 
        branch_id: user.branch_id || '' 
      });
    } else { // For creating a new user
      setEditingUser(null);
      setFormData({ full_name: '', email: '', password: '', role: '', branch_id: '' });
    }
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    let error;

    if (editingUser) {
        if (!formData.password) {
            toast({ title: 'Error', description: 'Please enter a new password to reset.', variant: 'destructive' });
            setIsSaving(false);
            return;
        }
        const { error: invokeError } = await supabase.functions.invoke('update-user', {
            body: {
                userId: editingUser.id,
                password: formData.password
            },
        });
        error = invokeError;

    } else { // Creating a new user
        if (!formData.full_name || !formData.email || !formData.role ) {
          toast({ title: 'Error', description: 'Please fill name, email and role.', variant: 'destructive' });
           setIsSaving(false);
          return;
        }
        if (formData.role !== 'admin' && !formData.branch_id) {
          toast({ title: 'Error', description: 'Please assign a branch for non-admin users.', variant: 'destructive' });
           setIsSaving(false);
          return;
        }
        if (!formData.password) {
            toast({ title: 'Error', description: 'Password is required for new users.', variant: 'destructive' });
             setIsSaving(false);
            return;
        }
       const { error: invokeError } = await supabase.functions.invoke('create-user', {
        body: formData,
      });
      error = invokeError;
    }

    if (error) {
        const errorData = await error.context.json();
        toast({ title: `Error ${editingUser ? 'updating' : 'creating'} user`, description: errorData.error, variant: 'destructive' });
    } else {
        toast({ title: 'Success', description: `User ${editingUser ? 'updated' : 'created'} successfully.` });
        setDialogOpen(false);
        fetchData();
    }

    setIsSaving(false);
  };

  const handleDelete = async (userId) => {
    const { error } = await supabase.functions.invoke('delete-user', {
        body: { userId }
    });
    
    if (error) {
      const errorData = await error.context.json();
      toast({ title: 'Error', description: `Failed to delete user: ${errorData.error}`, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'User deleted successfully.' });
      fetchData();
    }
  };

  const handleDeleteAllOtherUsers = async () => {
    const { data, error } = await supabase.functions.invoke('delete-all-other-users');

    if (error) {
        toast({
            title: 'Error Deleting Users',
            description: error.message || 'An unexpected error occurred.',
            variant: 'destructive',
        });
    } else {
        toast({
            title: 'Action Successful',
            description: `${data.deleted_count} users have been deleted.`,
        });
        fetchData(); // Refresh the user list
    }
    setDeleteConfirmation('');
  };


  const getRoleBadgeVariant = (role) => {
    switch (role) {
      case 'admin': return 'destructive';
      case 'manager': return 'success';
      case 'officer': return 'warning';
      default: return 'secondary';
    }
  };
  
  const isEditDisabled = (user) => {
    return user.role === 'admin';
  };
  
  const isCreateFlow = !editingUser;

  return (
    <DashboardLayout title="User Management">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="mb-6 flex flex-wrap items-center justify-end gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">
                  <Trash2 className="mr-2 h-4 w-4" /> Delete All Other Users
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center">
                    <ShieldAlert className="text-red-500 mr-2 h-6 w-6" />
                    EXTREME DANGER: Are you absolutely sure?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This is a highly destructive and irreversible action. It will permanently delete ALL users except for <strong>admin@mukwanoloans.com</strong>. All associated data for the deleted users (loans, borrowers, etc.) will also be removed by database triggers.
                    <br /><br />
                    To confirm, please type <strong>DELETE</strong> in the box below.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Input
                    id="delete-confirm"
                    value={deleteConfirmation}
                    onChange={(e) => setDeleteConfirmation(e.target.value)}
                    placeholder='Type DELETE to confirm'
                    className="mt-4"
                />
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeleteAllOtherUsers}
                    disabled={deleteConfirmation !== 'DELETE'}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    Yes, Delete All Other Users
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => handleOpenDialog()}>
                  <PlusCircle className="mr-2 h-4 w-4" /> Add User
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingUser ? `Edit User: ${editingUser.full_name}` : 'Add New User'}</DialogTitle>
                  {editingUser && <CardDescription>You can only reset the password for this user.</CardDescription>}
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="full_name">Full Name</Label>
                    <Input id="full_name" value={formData.full_name} onChange={(e) => setFormData({ ...formData, full_name: e.target.value })} disabled={!isCreateFlow}/>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} disabled={!isCreateFlow} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input id="password" type="password" placeholder={editingUser ? 'Enter new password to reset' : ''} value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="role">Role</Label>
                    <Select value={formData.role} onValueChange={(value) => setFormData({ ...formData, role: value, branch_id: value === 'admin' ? '' : formData.branch_id })} disabled={!isCreateFlow}>
                      <SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="manager">Manager</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {formData.role && formData.role !== 'admin' && (
                    <div className="space-y-2">
                      <Label htmlFor="branch">Assign Branch</Label>
                      <Select value={formData.branch_id} onValueChange={(value) => setFormData({ ...formData, branch_id: value })} disabled={!isCreateFlow}>
                        <SelectTrigger><SelectValue placeholder="Select a branch" /></SelectTrigger>
                        <SelectContent>
                          {branches.map(branch => (
                            <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <Button onClick={handleSave} className="w-full" disabled={isSaving}>
                    {isSaving ? <><RotateCw className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : (editingUser ? 'Reset Password' : 'Create User')}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4">
              <div>
                <CardTitle>All Users</CardTitle>
                <CardDescription>Search and filter the user directory.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  placeholder="Search name or email…"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="min-w-[200px] flex-1 md:max-w-sm"
                />
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger className="w-full sm:w-[160px]">
                    <SelectValue placeholder="Role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All roles</SelectItem>
                    <SelectItem value="admin">admin</SelectItem>
                    <SelectItem value="manager">manager</SelectItem>
                    <SelectItem value="officer">officer</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={branchFilter} onValueChange={setBranchFilter}>
                  <SelectTrigger className="w-full sm:w-[200px]">
                    <SelectValue placeholder="Branch" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All branches</SelectItem>
                    <SelectItem value="none">No branch (e.g. admin)</SelectItem>
                    {branches.map((br) => (
                      <SelectItem key={br.id} value={br.id}>
                        {br.name}
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
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center items-center py-10">
                <RotateCw className="h-6 w-6 animate-spin text-gray-500" />
                <span className="ml-2">Loading Users...</span>
              </div>
            ) : (
              <>
              <div className={excelTableWrapperClassName}>
                <Table className={excelTableClassName}>
                  <TableHeader>
                    <TableRow className={excelTableRowClassName}>
                      <TableHead className={excelThClassName()}>Name</TableHead>
                      <TableHead className={excelThClassName()}>Email</TableHead>
                      <TableHead className={excelThClassName()}>Role</TableHead>
                      <TableHead className={excelThClassName()}>Branch</TableHead>
                      <TableHead className={excelThClassName()}>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                  {filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className={excelEmptyStateCellClassName}>
                        No users match the filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedUsers.map((user) => (
                    <TableRow key={user.id} className={excelTableRowClassName}>
                      <TableCell className={excelTdClassName('font-medium')}>{user.full_name}</TableCell>
                      <TableCell className={excelTdClassName()}>{user.email}</TableCell>
                      <TableCell className={excelTdClassName()}><Badge variant={getRoleBadgeVariant(user.role)}>{user.role}</Badge></TableCell>
                      <TableCell className={excelTdClassName()}>{user.branches?.name || 'N/A'}</TableCell>
                      <TableCell className={excelTdClassName('space-x-2')}>
                        <Button
                          variant="outline"
                          size="icon"
                          title="View as this user"
                          disabled={
                            impersonatingId != null ||
                            user.id === session?.user?.id ||
                            hasStoredAdminImpersonationBackup()
                          }
                          onClick={() => handleImpersonate(user)}
                        >
                          {impersonatingId === user.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                        <Button variant="outline" size="icon" onClick={() => handleOpenDialog(user)} disabled={isEditDisabled(user)}><Edit className="h-4 w-4" /></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="icon" disabled={user.role === 'admin'}><Trash2 className="h-4 w-4" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This action cannot be undone. This will permanently delete the user.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(user.id)}>Delete</AlertDialogAction>
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
                totalCount={filteredUsers.length}
                pageSize={DEFAULT_TABLE_PAGE_SIZE}
              />
              </>
            )}
            {!isLoading && users.length === 0 && (
              <div className="text-center py-10 text-gray-500">
                No users found. Start by adding a new user.
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </DashboardLayout>
  );
};

export default UserManagement;