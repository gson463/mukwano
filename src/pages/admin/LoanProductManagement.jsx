import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { PlusCircle, Edit, Trash2, RotateCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
import { supabase } from '@/lib/customSupabaseClient';
import { motion } from 'framer-motion';
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

const LoanProductManagement = () => {
  const [products, setProducts] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [currency, setCurrency] = useState('TZS');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [formData, setFormData] = useState({
    name: '',
    interest_rate: '',
    repayment_frequency: 'weekly',
    loan_period: '',
    loan_period_unit: 'months',
    min_amount: '',
    max_amount: '',
    status: 'active',
  });
  const { toast } = useToast();

  const fetchProducts = useCallback(async () => {
    setIsLoading(true);
    const { data: currencyRow } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', 'currency')
      .single();
    if (currencyRow?.value) {
      setCurrency(currencyRow.value);
    }
    const { data, error } = await supabase.from('loan_products').select('*').order('created_at', { ascending: false });
    if (error) {
      toast({ title: 'Error', description: 'Could not fetch loan products.', variant: 'destructive' });
    } else {
      setProducts(data);
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const handleSave = async () => {
    const { name, interest_rate, repayment_frequency, loan_period, min_amount, max_amount } = formData;
    if (!name || !interest_rate || !repayment_frequency || !loan_period || !min_amount || !max_amount) {
      toast({ title: 'Error', description: 'Please fill all fields.', variant: 'destructive' });
      return;
    }
    setIsSaving(true);

    let result;
    if (editingProduct) {
      result = await supabase.from('loan_products').update(formData).eq('id', editingProduct.id);
    } else {
      result = await supabase.from('loan_products').insert([formData]);
    }

    if (result.error) {
      toast({ title: 'Error', description: `Failed to save product: ${result.error.message}`, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: `Loan product ${editingProduct ? 'updated' : 'created'}.` });
      setDialogOpen(false);
      setEditingProduct(null);
      fetchProducts();
    }
    setIsSaving(false);
  };

  const handleEdit = (product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      interest_rate: product.interest_rate,
      repayment_frequency: product.repayment_frequency,
      loan_period: product.loan_period,
      loan_period_unit: product.loan_period_unit,
      min_amount: product.min_amount,
      max_amount: product.max_amount,
      status: product.status,
    });
    setDialogOpen(true);
  };

  const handleDelete = async (productId) => {
    const { error } = await supabase.from('loan_products').delete().eq('id', productId);
    if (error) {
      toast({ title: 'Error', description: `Failed to delete product: ${error.message}`, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Loan product deleted.' });
      fetchProducts();
    }
  };

  const getBadgeVariant = (status) => {
    if (status === 'active') return 'success';
    if (status === 'inactive') return 'secondary';
    return 'default';
  };

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      const statusOk = filterStatus === 'all' || p.status === filterStatus;
      if (!statusOk) return false;
      if (!q) return true;
      return (
        (p.name && p.name.toLowerCase().includes(q)) ||
        String(p.interest_rate ?? '').includes(q) ||
        String(p.min_amount ?? '').includes(q) ||
        String(p.max_amount ?? '').includes(q)
      );
    });
  }, [products, filterStatus, searchQuery]);

  const totalPages = useMemo(
    () => getTotalPages(filteredProducts.length, DEFAULT_TABLE_PAGE_SIZE),
    [filteredProducts.length],
  );

  const paginatedProducts = useMemo(
    () => slicePage(filteredProducts, currentPage, DEFAULT_TABLE_PAGE_SIZE),
    [filteredProducts, currentPage],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [filterStatus, searchQuery]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const resetForm = () => {
    setFormData({
      name: '',
      interest_rate: '',
      repayment_frequency: 'weekly',
      loan_period: '',
      loan_period_unit: 'months',
      min_amount: '',
      max_amount: '',
      status: 'active',
    });
  };

  return (
    <DashboardLayout title="Loan Products">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="mb-6 flex flex-wrap items-center justify-end">
          <Dialog open={dialogOpen} onOpenChange={(isOpen) => {
            if (!isOpen) {
              setEditingProduct(null);
              resetForm();
            }
            setDialogOpen(isOpen);
          }}>
            <DialogTrigger asChild>
              <Button onClick={() => { setEditingProduct(null); resetForm(); }}>
                <PlusCircle className="mr-2 h-4 w-4" /> Add Product
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editingProduct ? 'Edit' : 'New'} Loan Product</DialogTitle></DialogHeader>
              <div className="space-y-4 py-4">
                <Input placeholder="Product Name" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                <Input type="number" placeholder="Interest Rate (%)" value={formData.interest_rate} onChange={e => setFormData({ ...formData, interest_rate: e.target.value })} />
                <Select value={formData.repayment_frequency} onValueChange={value => setFormData({ ...formData, repayment_frequency: value })}>
                  <SelectTrigger><SelectValue placeholder="Repayment Frequency" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Bi-weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Input type="number" placeholder="Loan Period" value={formData.loan_period} onChange={e => setFormData({ ...formData, loan_period: e.target.value })} />
                  <Select value={formData.loan_period_unit} onValueChange={value => setFormData({ ...formData, loan_period_unit: value })}>
                    <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="days">Days</SelectItem>
                      <SelectItem value="months">Months</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Input type="number" placeholder={`Min Amount (${currency})`} value={formData.min_amount} onChange={e => setFormData({ ...formData, min_amount: e.target.value })} />
                  <Input type="number" placeholder={`Max Amount (${currency})`} value={formData.max_amount} onChange={e => setFormData({ ...formData, max_amount: e.target.value })} />
                </div>
                <Select value={formData.status} onValueChange={value => setFormData({ ...formData, status: value })}>
                  <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={handleSave} className="w-full" disabled={isSaving}>
                  {isSaving ? <><RotateCw className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : (editingProduct ? 'Save Changes' : 'Create Product')}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4">
              <div>
                <CardTitle>All Loan Products ({filteredProducts.length})</CardTitle>
                <CardDescription>A list of all loan products available in the system.</CardDescription>
              </div>
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1">
                  <Label htmlFor="product-search">Search</Label>
                  <Input
                    id="product-search"
                    placeholder="Name, rate, amounts…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="min-w-[200px] max-w-md"
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Status</Label>
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center items-center py-10">
                <RotateCw className="h-6 w-6 animate-spin text-gray-500" />
                <span className="ml-2">Loading Products...</span>
              </div>
            ) : (
              <>
              <div className={excelTableWrapperClassName}>
                <Table className={excelTableClassName}>
                  <TableHeader>
                    <TableRow className={excelTableRowClassName}>
                      <TableHead className={excelThClassName()}>Name</TableHead>
                      <TableHead className={excelThClassName()}>Interest (%)</TableHead>
                      <TableHead className={excelThClassName()}>Period</TableHead>
                      <TableHead className={excelThClassName()}>Amount Range ({currency})</TableHead>
                      <TableHead className={excelThClassName()}>Status</TableHead>
                      <TableHead className={excelThClassName()}>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className={excelEmptyStateCellClassName}>
                          No loan products found. Start by adding a new product.
                        </TableCell>
                      </TableRow>
                    ) : filteredProducts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className={excelEmptyStateCellClassName}>
                          No products match the search and status filters.
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedProducts.map((p) => (
                        <TableRow key={p.id} className={excelTableRowClassName}>
                          <TableCell className={excelTdClassName()}>{p.name}</TableCell>
                          <TableCell className={excelTdClassName()}>{p.interest_rate}%</TableCell>
                          <TableCell className={excelTdClassName('capitalize')}>
                            {p.loan_period} {p.loan_period_unit}
                          </TableCell>
                          <TableCell className={excelTdClassName()}>
                            {p.min_amount} - {p.max_amount}
                          </TableCell>
                          <TableCell className={excelTdClassName()}>
                            <Badge variant={getBadgeVariant(p.status)}>{p.status}</Badge>
                          </TableCell>
                          <TableCell className={excelTdClassName('space-x-2')}>
                            <Button variant="outline" size="icon" onClick={() => handleEdit(p)}><Edit className="h-4 w-4" /></Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="icon"><Trash2 className="h-4 w-4" /></Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will permanently delete the loan product. This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDelete(p.id)}>Delete</AlertDialogAction>
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
                totalCount={filteredProducts.length}
                pageSize={DEFAULT_TABLE_PAGE_SIZE}
                disabled={products.length === 0}
              />
              </>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </DashboardLayout>
  );
};

export default LoanProductManagement;