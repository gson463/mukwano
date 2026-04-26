import React, { useState, useEffect, useMemo, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { FileText, Loader2, PlusCircle, Search, ChevronLeft, ChevronRight, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { format as formatDate } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const EXPENSES_PAGE_SIZE = 10;
const EXPENSE_TYPES = [
    { value: 'all', label: 'All types' },
    { value: 'transport', label: 'Transport' },
    { value: 'office', label: 'Office supplies' },
    { value: 'communication', label: 'Communication' },
    { value: 'other', label: 'Other' },
];

const StatCard = ({ title, value, icon: Icon }) => (
    <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            <Icon className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
            <div className="text-2xl font-bold">{value}</div>
        </CardContent>
    </Card>
);

const ExpenseManagement = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [expenses, setExpenses] = useState([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [currency, setCurrency] = useState('TZS');
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [typeFilter, setTypeFilter] = useState('all');
    const [currentPage, setCurrentPage] = useState(1);
    const [formData, setFormData] = useState({
        expense_type: 'transport',
        amount: '',
        description: '',
        expense_date: formatDate(new Date(), 'yyyy-MM-dd'),
    });

    const fetchExpenses = useCallback(async () => {
        if (!user) return;
        setLoading(true);

        const { data: configData } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
        setCurrency(configData?.value || 'TZS');

        const { data, error } = await supabase
            .from('expenses')
            .select('*')
            .eq('officer_id', user.id)
            .order('expense_date', { ascending: false });

        if (error) {
            toast({ title: 'Error fetching expenses', description: error.message, variant: 'destructive' });
        } else {
            setExpenses(data || []);
        }
        setLoading(false);
    }, [user, toast]);

    useEffect(() => {
        fetchExpenses();
    }, [fetchExpenses]);

    const handleSubmitExpense = async (e) => {
        e.preventDefault();
        if (!formData.expense_type || !formData.amount || !formData.description || !formData.expense_date) {
            toast({ title: 'Error', description: 'Please fill all fields.', variant: 'destructive' });
            return;
        }

        const newExpense = {
            ...formData,
            amount: parseFloat(formData.amount),
            officer_id: user.id,
        };

        const { error } = await supabase.from('expenses').insert(newExpense);

        if (error) {
            toast({ title: 'Error', description: `Failed to submit expense. ${error.message}`, variant: 'destructive' });
        } else {
            toast({ title: 'Success', description: 'Expense submitted successfully.' });
            fetchExpenses();
            setDialogOpen(false);
        }
    };

    const filteredExpenses = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return expenses
            .filter((e) => {
                if (typeFilter !== 'all' && e.expense_type !== typeFilter) {
                    return false;
                }
                if (!q) {
                    return true;
                }
                const amt = e.amount != null ? String(e.amount) : '';
                return (
                    (e.expense_type && e.expense_type.toLowerCase().includes(q)) ||
                    (e.description && e.description.toLowerCase().includes(q)) ||
                    amt.toLowerCase().includes(q) ||
                    (e.expense_date && e.expense_date.toLowerCase().includes(q))
                );
            })
            .sort(
                (a, b) =>
                    new Date(b.expense_date).getTime() - new Date(a.expense_date).getTime(),
            );
    }, [expenses, searchQuery, typeFilter]);

    const totalPages = Math.max(1, Math.ceil(filteredExpenses.length / EXPENSES_PAGE_SIZE) || 1);

    const paginatedExpenses = useMemo(() => {
        const start = (currentPage - 1) * EXPENSES_PAGE_SIZE;
        return filteredExpenses.slice(start, start + EXPENSES_PAGE_SIZE);
    }, [filteredExpenses, currentPage]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, typeFilter]);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const stats = useMemo(() => {
        const totalAmount = filteredExpenses.reduce(
            (sum, e) => sum + (Number(e.amount) || 0),
            0,
        );
        return { count: filteredExpenses.length, totalAmount };
    }, [filteredExpenses]);

    if (loading) {
        return (
            <DashboardLayout title="Expense Management">
                <div className="flex h-64 items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin" />
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout title="Expense Management">
            <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                    <StatCard title="Expenses (filtered count)" value={stats.count} icon={FileText} />
                    <StatCard
                        title="Total amount (filtered)"
                        value={`${currency} ${stats.totalAmount.toLocaleString()}`}
                        icon={Wallet}
                    />
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-4">
                            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                                <div>
                                    <CardTitle>My expenses</CardTitle>
                                    <CardDescription>
                                        Recorded expenses for your account. Filters apply to the list and the totals
                                        above.
                                    </CardDescription>
                                </div>
                                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                                    <DialogTrigger asChild>
                                        <Button
                                            onClick={() =>
                                                setFormData({
                                                    expense_type: 'transport',
                                                    amount: '',
                                                    description: '',
                                                    expense_date: formatDate(new Date(), 'yyyy-MM-dd'),
                                                })
                                            }
                                        >
                                            <PlusCircle className="mr-2 h-4 w-4" /> Submit expense
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>Submit new expense</DialogTitle>
                                        </DialogHeader>
                                        <form onSubmit={handleSubmitExpense} className="space-y-4 py-4">
                                            <Select
                                                value={formData.expense_type}
                                                onValueChange={(value) => setFormData({ ...formData, expense_type: value })}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select expense type" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="transport">Transport</SelectItem>
                                                    <SelectItem value="office">Office supplies</SelectItem>
                                                    <SelectItem value="communication">Communication</SelectItem>
                                                    <SelectItem value="other">Other</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <Input
                                                type="number"
                                                placeholder={`Amount (${currency})`}
                                                value={formData.amount}
                                                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                                                required
                                            />
                                            <Input
                                                type="date"
                                                value={formData.expense_date}
                                                onChange={(e) =>
                                                    setFormData({ ...formData, expense_date: e.target.value })
                                                }
                                                required
                                            />
                                            <Textarea
                                                placeholder="Description"
                                                value={formData.description}
                                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                                required
                                            />
                                            <Button type="submit" className="w-full">
                                                Submit
                                            </Button>
                                        </form>
                                    </DialogContent>
                                </Dialog>
                            </div>
                            <div className="flex w-full flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-end">
                                <div className="min-w-0 flex-1 lg:min-w-[12rem]">
                                    <div className="relative">
                                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            placeholder="Search description, type, amount, date…"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="w-full pl-8"
                                        />
                                    </div>
                                </div>
                                <Select value={typeFilter} onValueChange={setTypeFilter}>
                                    <SelectTrigger className="w-full min-w-0 sm:min-w-[10rem] lg:w-[12rem]">
                                        <SelectValue placeholder="Type" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {EXPENSE_TYPES.map((t) => (
                                            <SelectItem key={t.value} value={t.value}>
                                                {t.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto rounded-md border border-slate-300 bg-white shadow-sm dark:border-slate-600 dark:bg-card">
                            <Table className="border-collapse border-0 text-sm">
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="min-w-[8rem] border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Date
                                        </TableHead>
                                        <TableHead className="border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Type
                                        </TableHead>
                                        <TableHead className="border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Amount
                                        </TableHead>
                                        <TableHead className="min-w-[10rem] border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100">
                                            Description
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {paginatedExpenses.length > 0 ? (
                                        paginatedExpenses.map((e) => (
                                            <TableRow
                                                key={e.id}
                                                className="border-slate-200 dark:border-slate-700"
                                            >
                                                <TableCell className="border border-slate-300 tabular-nums dark:border-slate-600">
                                                    {formatDate(new Date(e.expense_date), 'PPP')}
                                                </TableCell>
                                                <TableCell className="border border-slate-300 dark:border-slate-600">
                                                    <Badge variant="secondary" className="capitalize">
                                                        {e.expense_type}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="border border-slate-300 font-medium tabular-nums dark:border-slate-600">
                                                    {currency} {Number(e.amount).toLocaleString()}
                                                </TableCell>
                                                <TableCell className="max-w-md border border-slate-300 text-muted-foreground dark:border-slate-600">
                                                    {e.description}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell
                                                colSpan={4}
                                                className="border border-slate-300 py-10 text-center text-muted-foreground dark:border-slate-600"
                                            >
                                                {expenses.length === 0
                                                    ? 'No expenses yet.'
                                                    : 'No expenses match the current filters.'}
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                        <div className="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-sm text-muted-foreground">
                                {filteredExpenses.length === 0
                                    ? 'Showing 0 of 0'
                                    : (() => {
                                          const from = (currentPage - 1) * EXPENSES_PAGE_SIZE + 1;
                                          const to = Math.min(
                                              currentPage * EXPENSES_PAGE_SIZE,
                                              filteredExpenses.length,
                                          );
                                          return `Showing ${from}–${to} of ${filteredExpenses.length}`;
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

export default ExpenseManagement;
