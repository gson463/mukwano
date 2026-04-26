import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { PlusCircle, Edit, Trash2, RotateCw } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { supabase } from '@/lib/customSupabaseClient';
import { motion } from 'framer-motion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

const tanzanianHolidays2025 = [
    { name: "New Year's Day", date: "2025-01-01" },
    { name: "Zanzibar Revolution Day", date: "2025-01-12" },
    { name: "Eid al-Fitr (Approximate)", date: "2025-03-31" },
    { name: "Good Friday", date: "2025-04-18" },
    { name: "Easter Monday", date: "2025-04-21" },
    { name: "Union Day", date: "2025-04-26" },
    { name: "Labour Day", date: "2025-05-01" },
    { name: "Eid al-Adha (Approximate)", date: "2025-06-07" },
    { name: "Saba Saba Day", date: "2025-07-07" },
    { name: "Nane Nane Day", date: "2025-08-08" },
    { name: "The Prophet's Birthday (Mawlid)", date: "2025-09-05" },
    { name: "Nyerere Day", date: "2025-10-14" },
    { name: "Independence Day", date: "2025-12-09" },
    { name: "Christmas Day", date: "2025-12-25" },
    { name: "Boxing Day", date: "2025-12-26" },
];

const HolidayManagement = () => {
  const { toast } = useToast();
  const [holidays, setHolidays] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentHoliday, setCurrentHoliday] = useState({ id: null, name: '', date: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingBulk, setIsAddingBulk] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [yearFilter, setYearFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);

  const fetchHolidays = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase.from('holidays').select('*').order('date', { ascending: true });
    if (error) {
      toast({ title: 'Error', description: 'Could not fetch holidays.', variant: 'destructive' });
    } else {
      setHolidays(data);
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchHolidays();
  }, [fetchHolidays]);

  const handleAdd = () => {
    setIsEditing(false);
    setCurrentHoliday({ id: null, name: '', date: '' });
    setDialogOpen(true);
  };

  const handleEdit = (holiday) => {
    setIsEditing(true);
    setCurrentHoliday(holiday);
    setDialogOpen(true);
  };

  const handleDelete = async (holidayId) => {
    const { error } = await supabase.from('holidays').delete().eq('id', holidayId);
    if (error) {
      toast({ title: 'Error', description: `Failed to delete holiday: ${error.message}`, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Holiday deleted successfully.' });
      fetchHolidays();
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!currentHoliday.name || !currentHoliday.date) {
      toast({ title: 'Error', description: 'Please fill all fields.', variant: 'destructive' });
      return;
    }
    setIsSaving(true);

    let result;
    if (isEditing) {
      result = await supabase.from('holidays').update({ name: currentHoliday.name, date: currentHoliday.date }).eq('id', currentHoliday.id);
    } else {
      result = await supabase.from('holidays').insert([{ name: currentHoliday.name, date: currentHoliday.date }]);
    }

    if (result.error) {
      toast({ title: 'Error', description: `Failed to save holiday: ${result.error.message}`, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: `Holiday ${isEditing ? 'updated' : 'added'} successfully.` });
      setDialogOpen(false);
      fetchHolidays();
    }
    setIsSaving(false);
  };
  
  const yearOptions = useMemo(() => {
    const years = new Set(
      holidays.map((h) => (h.date && h.date.length >= 4 ? h.date.slice(0, 4) : null)).filter(Boolean),
    );
    return [...years].sort();
  }, [holidays]);

  const filteredHolidays = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return holidays.filter((h) => {
      const y = h.date && h.date.length >= 4 ? h.date.slice(0, 4) : '';
      if (yearFilter !== 'all' && y !== yearFilter) return false;
      if (!q) return true;
      const name = (h.name || '').toLowerCase();
      const dateStr = h.date || '';
      const pretty = h.date
        ? format(parseISO(h.date), 'MMMM dd, yyyy').toLowerCase()
        : '';
      return (
        name.includes(q) ||
        dateStr.includes(q) ||
        pretty.includes(q) ||
        y.includes(q)
      );
    });
  }, [holidays, searchQuery, yearFilter]);

  const totalPages = useMemo(
    () => getTotalPages(filteredHolidays.length, DEFAULT_TABLE_PAGE_SIZE),
    [filteredHolidays.length],
  );

  const paginatedHolidays = useMemo(
    () => slicePage(filteredHolidays, currentPage, DEFAULT_TABLE_PAGE_SIZE),
    [filteredHolidays, currentPage],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, yearFilter]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const handleAddTanzanianHolidays = async () => {
    setIsAddingBulk(true);
    const existingDates = new Set(holidays.map(h => h.date));
    const holidaysToAdd = tanzanianHolidays2025.filter(h => !existingDates.has(h.date));
    
    if(holidaysToAdd.length === 0) {
      toast({ title: 'Up to Date', description: 'All 2025 Tanzanian holidays are already in the system.' });
      setIsAddingBulk(false);
      return;
    }
    
    const { error } = await supabase.from('holidays').insert(holidaysToAdd);
    
    if (error) {
      toast({ title: 'Error', description: `Failed to add holidays: ${error.message}`, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: `${holidaysToAdd.length} Tanzanian holidays for 2025 added successfully!` });
      fetchHolidays();
    }
    setIsAddingBulk(false);
  };

  return (
    <DashboardLayout title="Holiday Management">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="mb-6 flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" onClick={handleAddTanzanianHolidays} disabled={isAddingBulk}>
              {isAddingBulk ? <><RotateCw className="mr-2 h-4 w-4 animate-spin" /> Adding...</> : <><PlusCircle className="mr-2 h-4 w-4" /> Add Tanzanian Holidays (2025)</>}
            </Button>
            <Button onClick={handleAdd}>
              <PlusCircle className="mr-2 h-4 w-4" /> Add Custom Holiday
            </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4">
              <div>
                <CardTitle>Holiday List ({filteredHolidays.length})</CardTitle>
                <CardDescription>A list of all public holidays recognized by the system.</CardDescription>
              </div>
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1">
                  <Label htmlFor="holiday-search">Search</Label>
                  <Input
                    id="holiday-search"
                    placeholder="Name, date, year…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="min-w-[200px] max-w-md"
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Year</Label>
                  <Select value={yearFilter} onValueChange={setYearFilter}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="Year" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All years</SelectItem>
                      {yearOptions.map((y) => (
                        <SelectItem key={y} value={y}>
                          {y}
                        </SelectItem>
                      ))}
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
                <span className="ml-2">Loading Holidays...</span>
              </div>
            ) : (
              <>
              <div className={excelTableWrapperClassName}>
                <Table className={excelTableClassName}>
                  <TableHeader>
                    <TableRow className={excelTableRowClassName}>
                      <TableHead className={excelThClassName()}>Holiday Name</TableHead>
                      <TableHead className={excelThClassName()}>Date</TableHead>
                      <TableHead className={excelThClassName()}>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {holidays.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className={excelEmptyStateCellClassName}>
                          No holidays found. Start by adding a new holiday.
                        </TableCell>
                      </TableRow>
                    ) : filteredHolidays.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className={excelEmptyStateCellClassName}>
                          No holidays match the search or year.
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedHolidays.map((holiday) => (
                        <TableRow key={holiday.id} className={excelTableRowClassName}>
                          <TableCell className={excelTdClassName()}>{holiday.name}</TableCell>
                          <TableCell className={excelTdClassName()}>
                            {format(parseISO(holiday.date), 'MMMM dd, yyyy')}
                          </TableCell>
                          <TableCell className={excelTdClassName('flex gap-2')}>
                            <Button variant="ghost" size="icon" onClick={() => handleEdit(holiday)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <Trash2 className="h-4 w-4 text-red-500" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will permanently delete the holiday. This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDelete(holiday.id)}>Delete</AlertDialogAction>
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
                totalCount={filteredHolidays.length}
                pageSize={DEFAULT_TABLE_PAGE_SIZE}
                disabled={holidays.length === 0}
              />
              </>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit' : 'Add'} Holiday</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 py-4">
            <div>
              <Label htmlFor="name">Holiday Name</Label>
              <Input
                id="name"
                value={currentHoliday.name}
                onChange={(e) => setCurrentHoliday({ ...currentHoliday, name: e.target.value })}
                placeholder="e.g., Nyerere Day"
              />
            </div>
            <div>
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={currentHoliday.date}
                onChange={(e) => setCurrentHoliday({ ...currentHoliday, date: e.target.value })}
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? <><RotateCw className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : 'Save Holiday'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default HolidayManagement;