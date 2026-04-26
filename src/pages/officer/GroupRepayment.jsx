import React, { useState, useEffect, useMemo, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { Coins as HandCoins, Search, Ban, Loader2, Copy, ArrowDownToLine, Calendar as CalendarIcon } from 'lucide-react';
import { format as formatDate, startOfDay, isBefore, isEqual, parse } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { getTodayDateString } from '@/utils/dateValidation';
import { isNonWorkingDay } from '@/utils/holidayUtils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const EAT_TIMEZONE = 'Africa/Nairobi';

const GroupRepayment = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [currency, setCurrency] = useState('TZS');
    const [centers, setCenters] = useState([]);
    const [myGroups, setMyGroups] = useState([]);
    const [selectedCenterId, setSelectedCenterId] = useState('');
    const [selectedGroupId, setSelectedGroupId] = useState('');
    const [groupMembers, setGroupMembers] = useState([]);
    const [repaymentAmounts, setRepaymentAmounts] = useState({});
    const [centerSearchQuery, setCenterSearchQuery] = useState('');
    const [groupSearchQuery, setGroupSearchQuery] = useState('');
    const [holidays, setHolidays] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoadingGroupData, setIsLoadingGroupData] = useState(false);

    const todayYmdEAT = getTodayDateString();
    const isForbiddenDate = isNonWorkingDay(todayYmdEAT, holidays);

    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);

        const { data: configData } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
        setCurrency(configData?.value || 'TZS');

        const { data: holidaysData } = await supabase.from('holidays').select('date');
        setHolidays(holidaysData || []);

        const { data: profileRow } = await supabase.from('users').select('branch_id').eq('id', user.id).maybeSingle();
        const branchId = profileRow?.branch_id ?? null;

        let centersQuery = supabase.from('centers').select('id, name, branch_id, loan_officer_id').order('name');
        centersQuery = centersQuery.eq('loan_officer_id', user.id);
        if (branchId) {
            centersQuery = centersQuery.eq('branch_id', branchId);
        }

        const { data: centersData, error: ceError } = await centersQuery;
        if (ceError) {
            toast({ title: 'Error loading centres', description: ceError.message, variant: 'destructive' });
        } else {
            setCenters(centersData || []);
        }

        const { data: groupsData, error } = await supabase.from('groups').select('*').eq('loan_officer_id', user.id);
        if (error) {
            toast({ title: 'Error fetching groups', description: error.message, variant: 'destructive' });
        } else {
            setMyGroups(groupsData || []);
        }
        setLoading(false);
    }, [user, toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const groupsInSelectedCenter = useMemo(() => {
        if (!selectedCenterId) return [];
        return myGroups.filter((g) => g.center_id === selectedCenterId);
    }, [myGroups, selectedCenterId]);

    const filteredCenters = useMemo(() => {
        const q = centerSearchQuery.trim().toLowerCase();
        if (!q) return centers;
        return centers.filter((c) => c.name.toLowerCase().includes(q));
    }, [centers, centerSearchQuery]);

    const filteredGroups = useMemo(() => {
        const q = groupSearchQuery.trim().toLowerCase();
        if (!q) return groupsInSelectedCenter;
        return groupsInSelectedCenter.filter((g) => g.name.toLowerCase().includes(q));
    }, [groupsInSelectedCenter, groupSearchQuery]);

    useEffect(() => {
        setSelectedGroupId('');
        setGroupMembers([]);
        setRepaymentAmounts({});
        setGroupSearchQuery('');
    }, [selectedCenterId]);

    const loadGroupMemberData = useCallback(
        async (groupId) => {
            if (!groupId) {
                return;
            }
            if (isForbiddenDate) {
                setGroupMembers([]);
                return;
            }
            setIsLoadingGroupData(true);

            const { data: loans, error: loansError } = await supabase
                .from('loans')
                .select('id, loan_id, borrower_id, schedule, borrowers(id, first_name, surname, group_id)')
                .eq('officer_id', user.id)
                .in('status', ['active', 'delinquent']);

            if (loansError) {
                toast({ title: 'Error fetching loans', description: loansError.message, variant: 'destructive' });
                setIsLoadingGroupData(false);
                return;
            }

            const loansInGroup = loans.filter((l) => l.borrowers?.group_id === groupId);

            const selectedD = startOfDay(parse(getTodayDateString(), 'yyyy-MM-dd', new Date()));

            const memberPromises = loansInGroup.map(async (loan) => {
                let pastDueAmount = 0;
                let amountDueToday = 0;
                let hasAnyDueInstallment = false;

                loan.schedule?.forEach((inst) => {
                    const instDueDate = toZonedTime(new Date(inst.dueDate), EAT_TIMEZONE);
                    const instStartOfDay = startOfDay(instDueDate);

                    if (inst.status !== 'paid') {
                        const unpaidAmount = (inst.amount || 0) - (inst.paidAmount || 0);
                        if (unpaidAmount > 0.01) {
                            if (isBefore(instStartOfDay, selectedD)) {
                                pastDueAmount += unpaidAmount;
                                hasAnyDueInstallment = true;
                            } else if (isEqual(instStartOfDay, selectedD)) {
                                amountDueToday += unpaidAmount;
                                hasAnyDueInstallment = true;
                            }
                        }
                    }
                });

                if (!hasAnyDueInstallment) return null;

                return {
                    borrowerId: loan.borrower_id,
                    name: `${loan.borrowers.first_name} ${loan.borrowers.surname}`,
                    loanId: loan.id,
                    pastDueAmount,
                    amountDueToday,
                    totalDue: pastDueAmount + amountDueToday,
                };
            });

            const membersWithDueInstallments = (await Promise.all(memberPromises)).filter(
                (m) => m && m.totalDue > 0,
            );

            setGroupMembers(membersWithDueInstallments);

            const initialAmounts = {};
            membersWithDueInstallments.forEach((m) => {
                initialAmounts[m.borrowerId] = '';
            });
            setRepaymentAmounts(initialAmounts);
            setIsLoadingGroupData(false);
        },
        [user, isForbiddenDate, toast],
    );

    useEffect(() => {
        if (!selectedGroupId) {
            setGroupMembers([]);
            return;
        }
        loadGroupMemberData(selectedGroupId);
    }, [selectedGroupId, loadGroupMemberData]);

    const totals = useMemo(() => {
        return groupMembers.reduce(
            (acc, member) => {
                acc.pastDue += member.pastDueAmount;
                acc.dueToday += member.amountDueToday;
                acc.totalDue += member.totalDue;

                const paid = parseFloat(repaymentAmounts[member.borrowerId]) || 0;
                acc.totalPaid += paid;

                return acc;
            },
            { pastDue: 0, dueToday: 0, totalDue: 0, totalPaid: 0 },
        );
    }, [groupMembers, repaymentAmounts]);

    const handleAmountChange = (borrowerId, amount) => {
        setRepaymentAmounts((prev) => ({ ...prev, [borrowerId]: amount }));
    };

    const handleCopyAmount = (borrowerId, amount) => {
        setRepaymentAmounts((prev) => ({ ...prev, [borrowerId]: amount.toString() }));
        toast({
            title: 'Amount Copied',
            description: `Copied ${currency} ${amount.toLocaleString()} to payment field.`,
            duration: 1500,
        });
    };

    const handleCopyAllAmounts = () => {
        const newAmounts = { ...repaymentAmounts };
        let count = 0;
        groupMembers.forEach((member) => {
            if (member.totalDue > 0) {
                newAmounts[member.borrowerId] = member.totalDue.toString();
                count++;
            }
        });
        setRepaymentAmounts(newAmounts);
        toast({
            title: 'Bulk Copy Successful',
            description: `Copied total due for ${count} members.`,
        });
    };

    const handleSaveRepayments = async () => {
        if (isForbiddenDate) {
            toast({
                title: 'Cannot record repayments',
                description:
                    "Today (EAT) is not a working day (Sunday or public holiday), or recording is otherwise blocked. Repayments use the current business day only.",
                variant: 'destructive',
            });
            return;
        }
        setIsSaving(true);
        const actualPaymentDate = getTodayDateString();

        let successCount = 0;
        let errorCount = 0;

        const repaymentPromises = groupMembers.map(async (member) => {
            const amount = parseFloat(repaymentAmounts[member.borrowerId]);
            if (isNaN(amount) || amount <= 0) return;

            const { error } = await supabase.functions.invoke('record-repayment', {
                body: {
                    loan_id: member.loanId,
                    amount: amount,
                    officer_id: user.id,
                    actual_payment_date: actualPaymentDate,
                },
            });

            if (error) {
                console.error(`Failed to save repayment for ${member.name}:`, error);
                errorCount++;
            } else {
                successCount++;
            }
        });

        await Promise.all(repaymentPromises);

        if (successCount > 0) {
            toast({ title: 'Success', description: `Recorded ${successCount} repayments for ${formatDate(parse(getTodayDateString(), 'yyyy-MM-dd', new Date()), 'PPP')}.` });
        }
        if (errorCount > 0) {
            toast({ title: 'Errors Occurred', description: `${errorCount} repayments failed to save.`, variant: 'destructive' });
        }
        if (successCount === 0 && errorCount === 0) {
            toast({ title: 'Info', description: 'No valid repayments were entered.' });
        }

        setIsSaving(false);
        if (selectedGroupId) {
            loadGroupMemberData(selectedGroupId);
        }
    };

    const selectedGroupName = useMemo(
        () => myGroups.find((g) => g.id === selectedGroupId)?.name || '',
        [myGroups, selectedGroupId],
    );

    const selectedCenterName = useMemo(
        () => centers.find((c) => c.id === selectedCenterId)?.name || '',
        [centers, selectedCenterId],
    );

    if (loading) {
        return (
            <DashboardLayout title="Group Repayments">
                <div className="flex justify-center items-center h-64">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout title="Group Repayments">
            <TooltipProvider>
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                    <div className="space-y-6">
                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base">1. Center</CardTitle>
                                <CardDescription>Choose a center first.</CardDescription>
                                <div className="relative mt-2">
                                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Search centers..."
                                        className="pl-8"
                                        value={centerSearchQuery}
                                        onChange={(e) => setCenterSearchQuery(e.target.value)}
                                    />
                                </div>
                            </CardHeader>
                            <CardContent className="max-h-[28vh] space-y-2 overflow-y-auto pt-0">
                                {filteredCenters.length > 0 ? (
                                    filteredCenters.map((c) => (
                                        <Button
                                            key={c.id}
                                            type="button"
                                            variant={selectedCenterId === c.id ? 'default' : 'outline'}
                                            className="w-full justify-start"
                                            onClick={() => {
                                                setSelectedCenterId(c.id);
                                            }}
                                        >
                                            {c.name}
                                        </Button>
                                    ))
                                ) : (
                                    <p className="py-4 text-center text-sm text-muted-foreground">No centres found.</p>
                                )}
                            </CardContent>
                        </Card>

                        <Card className={!selectedCenterId ? 'border-dashed' : undefined}>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base">2. Group</CardTitle>
                                <CardDescription>
                                    {selectedCenterId
                                        ? 'Select a group in this center.'
                                        : 'Select a centre to list groups.'}
                                </CardDescription>
                                <div className="relative mt-2">
                                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Search groups..."
                                        className="pl-8"
                                        value={groupSearchQuery}
                                        onChange={(e) => setGroupSearchQuery(e.target.value)}
                                        disabled={!selectedCenterId}
                                    />
                                </div>
                            </CardHeader>
                            <CardContent className="max-h-[28vh] space-y-2 overflow-y-auto pt-0">
                                {selectedCenterId ? (
                                    filteredGroups.length > 0 ? (
                                        filteredGroups.map((group) => (
                                            <Button
                                                key={group.id}
                                                type="button"
                                                variant={selectedGroupId === group.id ? 'default' : 'outline'}
                                                className="w-full justify-start"
                                                onClick={() => setSelectedGroupId(group.id)}
                                            >
                                                {group.name}
                                            </Button>
                                        ))
                                    ) : (
                                        <p className="py-4 text-center text-sm text-muted-foreground">
                                            No groups in this centre{groupSearchQuery ? ' matching your search' : ''}.
                                        </p>
                                    )
                                ) : (
                                    <p className="py-6 text-center text-sm text-muted-foreground">
                                        Select a center first.
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    <div className="lg:col-span-2">
                        <Card className="min-h-[32rem]">
                            <CardHeader>
                                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                                    <div>
                                        <CardTitle>3. Record collections</CardTitle>
                                        <CardDescription className="mt-1">Select a center, then a group.</CardDescription>
                                        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                                            Repayments are posted for{' '}
                                            <span className="font-medium text-foreground">{"today's date (EAT) only"}</span>. Past
                                            and future dates are not available.
                                        </p>
                                    </div>
                                    <div
                                        className={`flex w-full shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-sm sm:w-[min(100%,20rem)] ${
                                            isForbiddenDate ? 'border-red-500 text-red-600' : 'border-border text-foreground'
                                        }`}
                                    >
                                        <CalendarIcon className="h-4 w-4 shrink-0" />
                                        <div>
                                            <p className="text-xs text-muted-foreground">Today (EAT)</p>
                                            <p className="font-medium">
                                                {formatDate(parse(todayYmdEAT, 'yyyy-MM-dd', new Date()), 'PPP')}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                {!selectedCenterId || !selectedGroupId ? (
                                    <div className="flex min-h-[16rem] flex-col items-center justify-center py-8 text-center text-muted-foreground">
                                        <p>
                                            Select a <strong>center</strong> on the left, then a <strong>group</strong> to
                                            record repayments.
                                        </p>
                                    </div>
                                ) : isForbiddenDate ? (
                                    <div className="flex flex-col items-center gap-2 py-10 text-center text-red-600">
                                        <Ban className="h-10 w-10" />
                                        <p>
                                            Today (EAT) is a Sunday or public holiday, or recording is otherwise not
                                            allowed. Repayments are for the current business day only — try again on the
                                            next working day.
                                        </p>
                                    </div>
                                ) : isLoadingGroupData ? (
                                    <div className="flex justify-center py-10">
                                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                                    </div>
                                ) : groupMembers.length > 0 ? (
                                    <>
                                        <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                                            <p className="text-sm text-muted-foreground">
                                                {selectedCenterName} · {selectedGroupName} — due amounts for{' '}
                                                {formatDate(parse(todayYmdEAT, 'yyyy-MM-dd', new Date()), 'PPP')}.
                                            </p>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={handleCopyAllAmounts}
                                                className="border-primary/30 text-primary hover:bg-primary/10"
                                            >
                                                <ArrowDownToLine className="mr-2 h-4 w-4" />
                                                Copy all total due
                                            </Button>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead>No.</TableHead>
                                                        <TableHead>Client Name</TableHead>
                                                        <TableHead>Past Due</TableHead>
                                                        <TableHead>Due Today</TableHead>
                                                        <TableHead>Total Due</TableHead>
                                                        <TableHead className="w-48">Amount Paid</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {groupMembers.map((member, index) => (
                                                        <TableRow key={member.borrowerId}>
                                                            <TableCell>{index + 1}</TableCell>
                                                            <TableCell>{member.name}</TableCell>
                                                            <TableCell>
                                                                {currency}{' '}
                                                                {member.pastDueAmount.toLocaleString(undefined, {
                                                                    minimumFractionDigits: 2,
                                                                    maximumFractionDigits: 2,
                                                                })}
                                                            </TableCell>
                                                            <TableCell>
                                                                {currency}{' '}
                                                                {member.amountDueToday.toLocaleString(undefined, {
                                                                    minimumFractionDigits: 2,
                                                                    maximumFractionDigits: 2,
                                                                })}
                                                            </TableCell>
                                                            <TableCell>
                                                                <div className="flex items-center gap-2 font-semibold">
                                                                    <span>
                                                                        {currency}{' '}
                                                                        {member.totalDue.toLocaleString(undefined, {
                                                                            minimumFractionDigits: 2,
                                                                            maximumFractionDigits: 2,
                                                                        })}
                                                                    </span>
                                                                    <Tooltip>
                                                                        <TooltipTrigger asChild>
                                                                            <Button
                                                                                variant="ghost"
                                                                                size="icon"
                                                                                className="h-6 w-6 text-gray-400 hover:text-primary"
                                                                                onClick={() => handleCopyAmount(member.borrowerId, member.totalDue)}
                                                                            >
                                                                                <Copy className="h-3 w-3" />
                                                                            </Button>
                                                                        </TooltipTrigger>
                                                                        <TooltipContent>
                                                                            <p>Copy total due</p>
                                                                        </TooltipContent>
                                                                    </Tooltip>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell>
                                                                <Input
                                                                    type="number"
                                                                    placeholder="0.00"
                                                                    value={repaymentAmounts[member.borrowerId]}
                                                                    onChange={(e) => handleAmountChange(member.borrowerId, e.target.value)}
                                                                />
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                                <TableFooter>
                                                    <TableRow>
                                                        <TableCell colSpan={2} className="font-bold text-lg">
                                                            Total
                                                        </TableCell>
                                                        <TableCell className="font-bold text-lg">
                                                            {currency}{' '}
                                                            {totals.pastDue.toLocaleString(undefined, {
                                                                minimumFractionDigits: 2,
                                                                maximumFractionDigits: 2,
                                                            })}
                                                        </TableCell>
                                                        <TableCell className="font-bold text-lg">
                                                            {currency}{' '}
                                                            {totals.dueToday.toLocaleString(undefined, {
                                                                minimumFractionDigits: 2,
                                                                maximumFractionDigits: 2,
                                                            })}
                                                        </TableCell>
                                                        <TableCell className="font-bold text-lg">
                                                            {currency}{' '}
                                                            {totals.totalDue.toLocaleString(undefined, {
                                                                minimumFractionDigits: 2,
                                                                maximumFractionDigits: 2,
                                                            })}
                                                        </TableCell>
                                                        <TableCell className="font-bold text-lg">
                                                            {currency}{' '}
                                                            {totals.totalPaid.toLocaleString(undefined, {
                                                                minimumFractionDigits: 2,
                                                                maximumFractionDigits: 2,
                                                            })}
                                                        </TableCell>
                                                    </TableRow>
                                                </TableFooter>
                                            </Table>
                                        </div>
                                        <Button onClick={handleSaveRepayments} className="mt-4" disabled={isSaving}>
                                            {isSaving ? (
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            ) : (
                                                <HandCoins className="mr-2 h-4 w-4" />
                                            )}
                                            Save all repayments
                                        </Button>
                                    </>
                                ) : (
                                    <div className="py-10 text-center text-muted-foreground">
                                        No scheduled repayments for this group for {formatDate(parse(todayYmdEAT, 'yyyy-MM-dd', new Date()), 'PPP')}.
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </TooltipProvider>
        </DashboardLayout>
    );
};

export default GroupRepayment;
