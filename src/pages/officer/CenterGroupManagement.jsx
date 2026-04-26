import React, { useState, useEffect, useRef, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { PlusCircle, Edit, Trash2, Download, Upload, Users, Loader2 } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import * as XLSX from 'xlsx';

const CenterGroupManagement = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [centers, setCenters] = useState([]);
    const [groups, setGroups] = useState([]);
    const [centerDialogOpen, setCenterDialogOpen] = useState(false);
    const [groupDialogOpen, setGroupDialogOpen] = useState(false);
    const [editingCenter, setEditingCenter] = useState(null);
    const [editingGroup, setEditingGroup] = useState(null);
    const [centerFormData, setCenterFormData] = useState({ name: '', location: '' });
    const [groupFormData, setGroupFormData] = useState({ name: '', center_id: '' });
    const [loading, setLoading] = useState(true);
    const importFileRef = useRef(null);
    const [activeTab, setActiveTab] = useState('centers');
    const [groupMemberCounts, setGroupMemberCounts] = useState({});

    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const { data: centersData, error: centersError } = await supabase.from('centers').select('*').eq('loan_officer_id', user.id);
            if (centersError) throw centersError;
            setCenters(centersData || []);

            const { data: groupsData, error: groupsError } = await supabase.from('groups').select('*').eq('loan_officer_id', user.id);
            if (groupsError) throw groupsError;
            setGroups(groupsData || []);
            
            // Fetch member counts for each group
            if (groupsData && groupsData.length > 0) {
                const groupIds = groupsData.map(g => g.id);
                const { data: counts, error: countError } = await supabase
                    .from('borrowers')
                    .select('group_id')
                    .in('group_id', groupIds);
                if (countError) throw countError;

                const memberCounts = counts.reduce((acc, { group_id }) => {
                    acc[group_id] = (acc[group_id] || 0) + 1;
                    return acc;
                }, {});
                setGroupMemberCounts(memberCounts);
            }
        } catch (error) {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [user, toast]);
    
    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleCenterSave = async () => {
        if (!centerFormData.name || !centerFormData.location) {
            toast({ title: 'Error', description: 'Please fill all fields for the center.', variant: 'destructive' });
            return;
        }

        let result;
        if (editingCenter) {
            result = await supabase.from('centers').update({ ...centerFormData }).eq('id', editingCenter.id);
        } else {
            result = await supabase.from('centers').insert({ ...centerFormData, loan_officer_id: user.id, branch_id: user.user_metadata.branch_id });
        }
        
        if (result.error) {
            toast({ title: 'Error', description: result.error.message, variant: 'destructive' });
        } else {
            fetchData();
            setCenterDialogOpen(false);
            setEditingCenter(null);
            setCenterFormData({ name: '', location: '' });
            toast({ title: 'Success', description: `Center ${editingCenter ? 'updated' : 'created'}.` });
        }
    };

    const handleGroupSave = async () => {
        if (!groupFormData.name || !groupFormData.center_id) {
            toast({ title: 'Error', description: 'Please fill all fields for the group.', variant: 'destructive' });
            return;
        }
        
        let result;
        if (editingGroup) {
            result = await supabase.from('groups').update({ ...groupFormData }).eq('id', editingGroup.id);
        } else {
            result = await supabase.from('groups').insert({ ...groupFormData, loan_officer_id: user.id });
        }
        
        if (result.error) {
             toast({ title: 'Error', description: result.error.message, variant: 'destructive' });
        } else {
            fetchData();
            setGroupDialogOpen(false);
            setEditingGroup(null);
            setGroupFormData({ name: '', center_id: '' });
            toast({ title: 'Success', description: `Group ${editingGroup ? 'updated' : 'created'}.` });
        }
    };
    
    const handleDelete = async (id, type) => {
        const tableName = type === 'center' ? 'centers' : 'groups';
        const { error } = await supabase.from(tableName).delete().eq('id', id);
        
        if (error) {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        } else {
            fetchData();
            toast({ title: 'Success', description: `${type.charAt(0).toUpperCase() + type.slice(1)} deleted.` });
        }
    };

    const handleDownloadTemplate = () => {
        let templateData, fileName;
        if (activeTab === 'centers') {
            templateData = [{ name: 'Kijitonyama Center', location: 'Dar es Salaam' }];
            fileName = 'Centers_Import_Template.xlsx';
        } else {
            const centerExample = centers.length > 0 ? centers[0].name : 'Kijitonyama Center';
            templateData = [{ name: 'Upendo Group', centerName: centerExample }];
            fileName = 'Groups_Import_Template.xlsx';
        }
        const worksheet = XLSX.utils.json_to_sheet(templateData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Template");
        XLSX.writeFile(workbook, fileName);
    };

    const handleImport = (event) => {
        toast({ title: 'In Progress', description: 'Import feature is being updated for database integration.' });
        event.target.value = null;
    };
    
    const getCenterName = (centerId) => centers.find(c => c.id === centerId)?.name || 'N/A';
    
    const tableHead = (extra = '') =>
        `border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100 ${extra}`.trim();
    const tableCell = 'border border-slate-300 px-2 py-1.5 dark:border-slate-600';

    if (loading) {
        return (
            <DashboardLayout title="Centers & Groups">
                <div className="flex h-64 items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout title="Centers & Groups">
            <Tabs defaultValue="centers" onValueChange={setActiveTab} className="space-y-4">
                <div className="flex justify-between items-center mb-4">
                    <TabsList>
                        <TabsTrigger value="centers">Centers</TabsTrigger>
                        <TabsTrigger value="groups">Groups</TabsTrigger>
                    </TabsList>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={handleDownloadTemplate}><Download className="mr-2 h-4 w-4" /> Template</Button>
                        <Button onClick={() => importFileRef.current.click()}><Upload className="mr-2 h-4 w-4" /> Import</Button>
                        <input type="file" ref={importFileRef} className="hidden" accept=".csv, .xlsx" onChange={handleImport} />
                        <Dialog open={centerDialogOpen} onOpenChange={setCenterDialogOpen}>
                            <DialogTrigger asChild><Button onClick={() => { setEditingCenter(null); setCenterFormData({ name: '', location: '' }); }}><PlusCircle className="mr-2 h-4 w-4" /> Add Center</Button></DialogTrigger>
                             <DialogContent>
                                <DialogHeader><DialogTitle>{editingCenter ? 'Edit' : 'New'} Center</DialogTitle></DialogHeader>
                                <div className="space-y-4 py-4">
                                    <Input placeholder="Center Name" value={centerFormData.name} onChange={e => setCenterFormData({ ...centerFormData, name: e.target.value })} />
                                    <Input placeholder="Location" value={centerFormData.location} onChange={e => setCenterFormData({ ...centerFormData, location: e.target.value })} />
                                    <Button onClick={handleCenterSave} className="w-full">{editingCenter ? 'Save Changes' : 'Create Center'}</Button>
                                </div>
                            </DialogContent>
                        </Dialog>
                        <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
                            <DialogTrigger asChild><Button onClick={() => { setEditingGroup(null); setGroupFormData({ name: '', center_id: '' }); }}><PlusCircle className="mr-2 h-4 w-4" /> Add Group</Button></DialogTrigger>
                            <DialogContent>
                                <DialogHeader><DialogTitle>{editingGroup ? 'Edit' : 'New'} Group</DialogTitle></DialogHeader>
                                 <div className="space-y-4 py-4">
                                     <Input placeholder="Group Name" value={groupFormData.name} onChange={e => setGroupFormData({ ...groupFormData, name: e.target.value })} />
                                     <Select value={groupFormData.center_id} onValueChange={(v) => setGroupFormData({ ...groupFormData, center_id: v })}>
                                        <SelectTrigger className="w-full"><SelectValue placeholder="Select Center" /></SelectTrigger>
                                        <SelectContent>
                                            {centers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                        </SelectContent>
                                     </Select>
                                     <Button onClick={handleGroupSave} className="w-full">{editingGroup ? 'Save Changes' : 'Create Group'}</Button>
                                 </div>
                             </DialogContent>
                        </Dialog>
                    </div>
                </div>

                <TabsContent value="centers">
                    <Card>
                        <CardHeader>
                            <CardTitle>My centers</CardTitle>
                            <CardDescription>Centers assigned to you as loan officer.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto rounded-md border border-slate-300 bg-white shadow-sm dark:border-slate-600 dark:bg-card">
                                <Table className="border-collapse border-0 text-sm">
                                    <TableHeader>
                                        <TableRow className="hover:bg-transparent">
                                            <TableHead className={tableHead('min-w-[8rem]')}>Name</TableHead>
                                            <TableHead className={tableHead('min-w-[8rem]')}>Location</TableHead>
                                            <TableHead className={tableHead('w-[1%] min-w-[7rem] text-right')}>Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {centers.length > 0 ? (
                                            centers.map((c) => (
                                                <TableRow
                                                    key={c.id}
                                                    className="border-slate-200 dark:border-slate-700"
                                                >
                                                    <TableCell className={`${tableCell} font-medium`}>{c.name}</TableCell>
                                                    <TableCell className={tableCell}>{c.location}</TableCell>
                                                    <TableCell className={`${tableCell} p-1.5 text-right`}>
                                                        <div className="inline-flex flex-wrap items-center justify-end gap-1">
                                                            <Button
                                                                variant="outline"
                                                                size="icon"
                                                                className="h-8 w-8"
                                                                onClick={() => {
                                                                    setEditingCenter(c);
                                                                    setCenterFormData({ name: c.name, location: c.location });
                                                                    setCenterDialogOpen(true);
                                                                }}
                                                            >
                                                                <Edit className="h-4 w-4" />
                                                            </Button>
                                                            <AlertDialog>
                                                                <AlertDialogTrigger asChild>
                                                                    <Button variant="destructive" size="icon" className="h-8 w-8">
                                                                        <Trash2 className="h-4 w-4" />
                                                                    </Button>
                                                                </AlertDialogTrigger>
                                                                <AlertDialogContent>
                                                                    <AlertDialogHeader>
                                                                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                                                        <AlertDialogDescription>
                                                                            This will delete the center.
                                                                        </AlertDialogDescription>
                                                                    </AlertDialogHeader>
                                                                    <AlertDialogFooter>
                                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                        <AlertDialogAction onClick={() => handleDelete(c.id, 'center')}>
                                                                            Delete
                                                                        </AlertDialogAction>
                                                                    </AlertDialogFooter>
                                                                </AlertDialogContent>
                                                            </AlertDialog>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        ) : (
                                            <TableRow>
                                                <TableCell
                                                    colSpan={3}
                                                    className="border border-slate-300 py-10 text-center text-muted-foreground dark:border-slate-600"
                                                >
                                                    No centers yet. Add a center to get started.
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
                <TabsContent value="groups">
                    <Card>
                        <CardHeader>
                            <CardTitle>My groups</CardTitle>
                            <CardDescription>Groups linked to your centers.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto rounded-md border border-slate-300 bg-white shadow-sm dark:border-slate-600 dark:bg-card">
                                <Table className="border-collapse border-0 text-sm">
                                    <TableHeader>
                                        <TableRow className="hover:bg-transparent">
                                            <TableHead className={tableHead('min-w-[7rem]')}>Name</TableHead>
                                            <TableHead className={tableHead('min-w-[7rem]')}>Center</TableHead>
                                            <TableHead className={tableHead('min-w-[5rem] tabular-nums')}>Members</TableHead>
                                            <TableHead className={tableHead('w-[1%] min-w-[7rem] text-right')}>Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {groups.length > 0 ? (
                                            groups.map((g) => (
                                                <TableRow
                                                    key={g.id}
                                                    className="border-slate-200 dark:border-slate-700"
                                                >
                                                    <TableCell className={`${tableCell} font-medium`}>{g.name}</TableCell>
                                                    <TableCell className={tableCell}>{getCenterName(g.center_id)}</TableCell>
                                                    <TableCell className={`${tableCell} tabular-nums`}>
                                                        <span className="inline-flex items-center gap-1.5">
                                                            <Users className="h-4 w-4 text-muted-foreground" />
                                                            {groupMemberCounts[g.id] || 0}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className={`${tableCell} p-1.5 text-right`}>
                                                        <div className="inline-flex flex-wrap items-center justify-end gap-1">
                                                            <Button
                                                                variant="outline"
                                                                size="icon"
                                                                className="h-8 w-8"
                                                                onClick={() => {
                                                                    setEditingGroup(g);
                                                                    setGroupFormData({ name: g.name, center_id: g.center_id });
                                                                    setGroupDialogOpen(true);
                                                                }}
                                                            >
                                                                <Edit className="h-4 w-4" />
                                                            </Button>
                                                            <AlertDialog>
                                                                <AlertDialogTrigger asChild>
                                                                    <Button variant="destructive" size="icon" className="h-8 w-8">
                                                                        <Trash2 className="h-4 w-4" />
                                                                    </Button>
                                                                </AlertDialogTrigger>
                                                                <AlertDialogContent>
                                                                    <AlertDialogHeader>
                                                                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                                                        <AlertDialogDescription>
                                                                            This will delete the group.
                                                                        </AlertDialogDescription>
                                                                    </AlertDialogHeader>
                                                                    <AlertDialogFooter>
                                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                        <AlertDialogAction onClick={() => handleDelete(g.id, 'group')}>
                                                                            Delete
                                                                        </AlertDialogAction>
                                                                    </AlertDialogFooter>
                                                                </AlertDialogContent>
                                                            </AlertDialog>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        ) : (
                                            <TableRow>
                                                <TableCell
                                                    colSpan={4}
                                                    className="border border-slate-300 py-10 text-center text-muted-foreground dark:border-slate-600"
                                                >
                                                    No groups yet. Add a group to get started.
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </DashboardLayout>
    );
};

export default CenterGroupManagement;