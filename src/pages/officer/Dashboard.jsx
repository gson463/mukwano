import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Users, Briefcase, DollarSign, AlertTriangle, TrendingUp, PiggyBank, Landmark, Banknote, CalendarClock, CalendarCheck, FilePlus, Loader2, Wallet, Coins as HandCoins, Activity, Target, Flag } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/lib/customSupabaseClient';
import {
  countNearingInDisbursalAndWindow,
  healthyBookShareInPeriod,
  sumScheduledDueInDateRange,
} from '@/lib/officerProgressMetrics';
import { useToast } from '@/components/ui/use-toast';

const ProgressMiniCard = ({
  title,
  subtitle,
  valueLine,
  footnote,
  progressPct,
  barClassName,
  icon: Icon,
  children,
}) => (
  <div className="flex flex-col rounded-lg border border-slate-200/90 bg-white p-4 shadow-sm">
    <div className="flex justify-between items-start gap-2">
      <div className="min-w-0 pr-1">
        <h4 className="text-sm font-semibold leading-tight text-foreground">{title}</h4>
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      </div>
      <div className="shrink-0 rounded-md border border-slate-100 bg-slate-50 p-2">
        <Icon className="h-4 w-4 text-slate-600" />
      </div>
    </div>
    <p className="text-xl font-bold tabular-nums tracking-tight text-foreground mt-3 sm:text-2xl">{valueLine}</p>
    {children || (
      <>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className={cn('h-full rounded-full transition-all', barClassName || 'bg-slate-300')}
            style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
          />
        </div>
        {footnote != null && (
          <p className="text-xs leading-snug text-muted-foreground mt-2">{footnote}</p>
        )}
      </>
    )}
  </div>
);

const StatCard = ({ title, value, icon: Icon, gradient, onClick }) => (
  <Card
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    onClick={onClick}
    onKeyDown={
      onClick
        ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClick();
            }
          }
        : undefined
    }
    className={cn(
      "border-none shadow-lg overflow-hidden relative group transition-all duration-300",
      gradient,
      onClick
        ? "cursor-pointer hover:shadow-xl hover:brightness-[1.05] focus-visible:ring-2 focus-visible:ring-white/60 outline-none"
        : "hover:shadow-xl",
    )}
  >
    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
       <Icon className="w-24 h-24 text-white transform rotate-12 translate-x-4 -translate-y-4" />
    </div>
    <CardHeader className="flex flex-row items-center justify-between pb-2 z-10 relative">
      <CardTitle className="text-sm font-medium text-white/90">{title}</CardTitle>
      <div className="p-2 rounded-lg bg-white/20 backdrop-blur-sm">
        <Icon className="h-5 w-5 text-white" />
      </div>
    </CardHeader>
    <CardContent className="z-10 relative">
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="h-1 w-full bg-black/10 mt-4 rounded-full overflow-hidden">
         <div className="h-full bg-white/30 w-2/3" /> 
      </div>
    </CardContent>
  </Card>
);

const LoanOfficerDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState('TZS');
  const [dateRange, setDateRange] = useState({
    from: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    to: new Date(),
  });
  const [stats, setStats] = useState({
    total_borrowers: 0,
    active_loans: 0,
    total_portfolio: 0,
    total_principal_disbursed: 0,
    total_repayments_collected: 0,
    principal_repayments_collected: 0,
    total_interest_collected: 0,
    total_outstanding_principal: 0,
    total_defaulted_principal: 0,
    total_outstanding_interest: 0,
    total_defaulted_interest: 0,
    total_expected_today: 0,
    total_disbursed_this_month: 0,
    past_unpaid_repayments: 0
  });
  const [progressMetrics, setProgressMetrics] = useState({
    periodCollected: 0,
    periodScheduledDue: 0,
    healthyPct: 100,
    periodPrincipalCollected: 0,
    periodPrincipalDisbursed: 0,
    nearingCount: 0,
  });

  const fetchDashboardData = useCallback(async (start, end) => {
      if (!user) return;
      setLoading(true);
      try {
          const { data: configData } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
          if (configData) setCurrency(configData.value);

          const params = {
            p_officer_id: user.id,
            p_start_date: format(start, 'yyyy-MM-dd'),
            p_end_date: format(end, 'yyyy-MM-dd'),
          };

          const { data: statsData, error: statsError } = await supabase.rpc('get_officer_stats', params);
          if (statsError) throw statsError;
          
          if (statsData && statsData.length > 0) {
              const fetchedStats = statsData[0];
              const completeStats = {
                total_borrowers: 0,
                active_loans: 0,
                total_portfolio: 0,
                total_principal_disbursed: 0,
                total_repayments_collected: 0,
                principal_repayments_collected: 0,
                total_interest_collected: 0,
                total_expected_today: 0,
                total_disbursed_this_month: 0,
                past_unpaid_repayments: 0,
                // Explicit mapping for mismatching keys from RPC
                total_outstanding_principal: fetchedStats.outstanding_principal || 0,
                total_outstanding_interest: fetchedStats.outstanding_interest || 0,
                total_defaulted_principal: fetchedStats.defaulted_principal || 0,
                total_defaulted_interest: fetchedStats.defaulted_interest || 0,
                ...fetchedStats,
              };
              setStats(completeStats);

              const fromYmd = format(start, 'yyyy-MM-dd');
              const toYmd = format(end, 'yyyy-MM-dd');

              const [repPeriodRes, liveLoansRes] = await Promise.all([
                supabase
                  .from('repayments')
                  .select('amount')
                  .eq('officer_id', user.id)
                  .gte('actual_payment_date', fromYmd)
                  .lte('actual_payment_date', toYmd),
                supabase
                  .from('loans')
                  .select('id, status, schedule, disbursement_date')
                  .eq('officer_id', user.id)
                  .in('status', ['active', 'delinquent']),
              ]);

              const liveLoans = liveLoansRes.data || [];
              const periodCollected = (repPeriodRes.data || []).reduce(
                (s, r) => s + Number(r.amount || 0),
                0,
              );
              const periodDue = sumScheduledDueInDateRange(
                liveLoans,
                fromYmd,
                toYmd,
              );
              const healthyPct = healthyBookShareInPeriod(
                liveLoans,
                fromYmd,
                toYmd,
              );
              const activeLoans = liveLoans.filter((l) => l.status === 'active');
              const nearingCount = countNearingInDisbursalAndWindow(
                activeLoans,
                { fromYmd, toYmd, windowDays: 14 },
              );

              setProgressMetrics({
                periodCollected,
                periodScheduledDue: periodDue,
                healthyPct,
                periodPrincipalCollected: Number(completeStats.principal_repayments_collected || 0),
                periodPrincipalDisbursed: Number(completeStats.total_principal_disbursed || 0),
                nearingCount,
              });
          }
      } catch (error) {
          console.error('Error fetching officer dashboard data:', error);
          toast({
              title: 'Error',
              description: 'Could not fetch your dashboard statistics.',
              variant: 'destructive',
          });
      } finally {
          setLoading(false);
      }
  }, [user, toast]);

  useEffect(() => {
    if (dateRange.from && dateRange.to) {
        fetchDashboardData(dateRange.from, dateRange.to);
    }
  }, [fetchDashboardData, dateRange]);

  const formatCurrency = (value) => {
    const number = Number(value || 0);
    return `${currency} ${number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const periodCollectionProgressPct =
    progressMetrics.periodScheduledDue > 0
      ? Math.min(
          100,
          (progressMetrics.periodCollected / progressMetrics.periodScheduledDue) * 100,
        )
      : 0;
  const periodProgressPct =
    progressMetrics.periodPrincipalDisbursed > 0
      ? Math.min(
          100,
          (progressMetrics.periodPrincipalCollected / progressMetrics.periodPrincipalDisbursed) * 100,
        )
      : 0;

  const goMetricDrill = (metricKey) => {
    const q = new URLSearchParams();
    if (dateRange?.from) q.set('from', format(dateRange.from, 'yyyy-MM-dd'));
    if (dateRange?.to) q.set('to', format(dateRange.to, 'yyyy-MM-dd'));
    navigate(`/officer/dashboard/metric/${metricKey}?${q.toString()}`);
  };

  const statCards = [
    { title: 'My Borrowers', value: stats.total_borrowers, icon: Users, gradient: 'bg-gradient-to-br from-pink-500 to-rose-600', metric: 'borrowers' },
    { title: 'Active Loans', value: stats.active_loans, icon: Briefcase, gradient: 'bg-gradient-to-br from-violet-500 to-purple-600', metric: 'active-loans' },
    { title: 'My Portfolio', value: formatCurrency(stats.total_portfolio), icon: PiggyBank, gradient: 'bg-gradient-to-br from-emerald-600 to-green-800', metric: 'portfolio' },
    { title: 'Principal Disbursed', value: formatCurrency(stats.total_principal_disbursed), icon: TrendingUp, gradient: 'bg-gradient-to-br from-emerald-400 to-emerald-600', metric: 'principal-disbursed' },
    { title: 'Principal Collected', value: formatCurrency(stats.principal_repayments_collected), icon: Banknote, gradient: 'bg-gradient-to-br from-teal-400 to-teal-600', metric: 'principal-collected' },
    { title: 'Interest Collected', value: formatCurrency(stats.total_interest_collected), icon: DollarSign, gradient: 'bg-gradient-to-br from-teal-500 to-emerald-700', metric: 'interest-collected' },
    { title: 'Outstanding Principal', value: formatCurrency(stats.total_outstanding_principal), icon: Landmark, gradient: 'bg-gradient-to-br from-indigo-400 to-indigo-600', metric: 'outstanding-principal' },
    { title: 'Outstanding Interest', value: formatCurrency(stats.total_outstanding_interest), icon: Wallet, gradient: 'bg-gradient-to-br from-purple-400 to-purple-600', metric: 'outstanding-interest' },
    { title: 'Defaulted Principal', value: formatCurrency(stats.total_defaulted_principal), icon: AlertTriangle, gradient: 'bg-gradient-to-br from-red-500 to-red-700', metric: 'defaulted-principal' },
    { title: 'Defaulted Interest', value: formatCurrency(stats.total_defaulted_interest), icon: AlertTriangle, gradient: 'bg-gradient-to-br from-rose-500 to-rose-700', metric: 'defaulted-interest' },
    { title: 'Expected Today', value: formatCurrency(stats.total_expected_today), icon: CalendarClock, gradient: 'bg-gradient-to-br from-amber-400 to-orange-500', metric: 'expected-today' },
    { title: 'Disbursed This Month', value: formatCurrency(stats.total_disbursed_this_month), icon: CalendarCheck, gradient: 'bg-gradient-to-br from-green-400 to-emerald-600', metric: 'disbursed-this-month' },
  ];

  const quickActions = [
    { title: 'New Borrower', icon: Users, description: 'Register a new borrower', path: '/officer/borrowers' },
    { title: 'Disburse Loan', icon: FilePlus, description: 'Create and disburse a new loan', path: '/officer/loans' },
    { title: 'Record Repayment', icon: HandCoins, description: 'Record a loan repayment', path: '/officer/repayment-management' },
  ];

  return (
    <DashboardLayout title="Officer Dashboard">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-white p-6 rounded-xl shadow-sm border">
          <p className="text-sm text-muted-foreground">
            {format(new Date(), 'EEEE, MMMM do, yyyy')}
          </p>
           <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={'outline'}
                  className={cn('w-full sm:w-[280px] justify-start text-left font-normal border-gray-200', !dateRange && 'text-muted-foreground')}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange?.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, 'LLL dd, y')} - {format(dateRange.to, 'LLL dd, y')}
                      </>
                    ) : (
                      format(dateRange.from, 'LLL dd, y')
                    )
                  ) : (
                    <span>Pick a date range</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={dateRange?.from}
                  selected={dateRange}
                  onSelect={setDateRange}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {loading ? (
            <div className="flex justify-center items-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-green-600" />
            </div>
        ) : (
        <>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Your progress
              </p>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <ProgressMiniCard
                  title="Period: collection vs due"
                  subtitle="Repayments in range vs scheduled installments in range"
                  valueLine={`${formatCurrency(progressMetrics.periodCollected)} / ${formatCurrency(progressMetrics.periodScheduledDue)}`}
                  progressPct={periodCollectionProgressPct}
                  barClassName="bg-slate-400"
                  icon={Wallet}
                  footnote={
                    progressMetrics.periodScheduledDue <= 0
                      ? 'No scheduled installments due in this range'
                      : `${Math.round(periodCollectionProgressPct)}% of scheduled due in this range collected`
                  }
                />
                <ProgressMiniCard
                  title="Healthy book"
                  subtitle="Among loans with a due in this range"
                  valueLine={`${Math.round(progressMetrics.healthyPct)}%`}
                  progressPct={progressMetrics.healthyPct}
                  barClassName="bg-amber-500"
                  icon={Activity}
                  footnote="Share of live loans (with an installment due in the selected range) that are not delinquent"
                />
                <ProgressMiniCard
                  title="Selected period"
                  subtitle="Collected vs principal disbursed"
                  valueLine={`${formatCurrency(progressMetrics.periodPrincipalCollected)} / ${formatCurrency(progressMetrics.periodPrincipalDisbursed)}`}
                  progressPct={periodProgressPct}
                  barClassName="bg-slate-400"
                  icon={Target}
                  footnote={
                    progressMetrics.periodPrincipalDisbursed <= 0
                      ? 'No disbursements in this range — collections still reflect your activity'
                      : 'Principal collected vs principal disbursed in the selected date range'
                  }
                />
                <ProgressMiniCard
                  title="Nearing completion"
                  subtitle="Loans nearing final payment"
                  valueLine={String(progressMetrics.nearingCount)}
                  icon={Flag}
                >
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3 w-full"
                    onClick={() => {
                      const q = new URLSearchParams({ days: '14' });
                      if (dateRange?.from) {
                        q.set('from', format(dateRange.from, 'yyyy-MM-dd'));
                      }
                      if (dateRange?.to) {
                        q.set('to', format(dateRange.to, 'yyyy-MM-dd'));
                      }
                      navigate(`/officer/loans/nearing-completion?${q.toString()}`);
                    }}
                  >
                    View all
                  </Button>
                </ProgressMiniCard>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {statCards.map((stat, index) => {
                  const { metric, ...rest } = stat;
                  return (
                    <motion.div key={stat.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
                      <StatCard {...rest} onClick={metric ? () => goMetricDrill(metric) : undefined} />
                    </motion.div>
                  );
                })}
            </div>
            
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-6 px-1 mt-8">Quick Actions</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {quickActions.map((action, index) => {
                  const Icon = action.icon;
                  return (
                      <motion.div 
                        key={action.title} 
                        initial={{ opacity: 0, scale: 0.95 }} 
                        animate={{ opacity: 1, scale: 1 }} 
                        transition={{ delay: index * 0.1, duration: 0.3 }} 
                        onClick={() => navigate(action.path)}
                      >
<Card className="h-full cursor-pointer hover:shadow-xl transition-all duration-300 group border-transparent hover:border-primary/20 bg-white relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                              <Icon className="w-32 h-32 text-primary transform rotate-12 translate-x-8 -translate-y-8" />
                        </div>
                        <CardContent className="flex flex-col items-center justify-center p-8 text-center relative z-10">
                              <div className="p-4 bg-primary/10 rounded-2xl mb-4 group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-300 shadow-sm">
                                  <Icon className="h-8 w-8 text-primary group-hover:text-primary-foreground transition-colors duration-300" />
                              </div>
                          <CardTitle className="text-lg font-semibold mb-2 text-gray-900">{action.title}</CardTitle>
                          <CardDescription className="text-sm text-gray-500 mb-6 line-clamp-2">{action.description}</CardDescription>
                              <Button variant="outline" className="w-full group-hover:bg-primary group-hover:text-primary-foreground border-primary/30 hover:border-primary transition-all">
                                  Access Tool
                              </Button>
                          </CardContent>
                      </Card>
                      </motion.div>
                  );
                  })}
              </div>
            </div>
        </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default LoanOfficerDashboard;