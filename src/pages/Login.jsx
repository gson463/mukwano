import React, { useState, useEffect, useMemo } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { DEFAULT_ORG_NAME, fetchSystemConfig, getBrandLogoUrl } from '@/lib/systemConfig';
import { SystemBrandLogo } from '@/components/SystemBrandLogo';
import {
  Loader2,
  Lock,
  Mail,
  Eye,
  EyeOff,
  ArrowRight,
  CheckCircle2,
  Shield,
  UserCog,
  RefreshCw,
  LockKeyhole,
  MessageCircle,
} from 'lucide-react';

const MotionButton = motion(Button);

const emailLooksValid = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());

const HERO_POINTS = [
  'Borrowers, loans, centers & groups mapped to your branches',
  'Disbursements, repayments & installment schedules in one flow',
  'Arrears, defaulters & reports—role-based, secure access',
];

const INSIGHT_SLIDES = [
  {
    title: 'Collections & recovery in view',
    description: 'Monitor repayments, arrears, and officer activity as work happens.',
  },
  {
    title: 'Portfolio health at a glance',
    description: 'Outstanding principal, interest, and delinquency without jumping between screens.',
  },
  {
    title: 'Loans tied to real schedules',
    description: 'Disbursements, installment plans, and posted repayments stay aligned for each loan.',
  },
  {
    title: 'Built for your role',
    description: 'Admins, branch managers, and loan officers each see their scope—nothing else.',
  },
  {
    title: 'Reports & drill-downs',
    description: 'Dashboard metrics, shared reports, and exports to support reviews and audits.',
  },
];

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [insightIndex, setInsightIndex] = useState(0);
  const { signIn, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [systemConfig, setSystemConfig] = useState({ name: DEFAULT_ORG_NAME, logoUrl: null });
  const reduceMotion = useReducedMotion();
  const useMotion = !reduceMotion;

  const brandLogoSrc = useMemo(() => getBrandLogoUrl(systemConfig.logoUrl), [systemConfig.logoUrl]);

  const formVariants = useMemo(
    () => ({
      hidden: { opacity: 0 },
      show: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.08 } },
    }),
    [],
  );

  const fieldVariants = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 420, damping: 30 } },
  };

  useEffect(() => {
    const run = async () => {
      try {
        const next = await fetchSystemConfig();
        setSystemConfig(next);
        const saved = localStorage.getItem('mukwano_login_email');
        if (saved) {
          setEmail(saved);
          setRememberMe(true);
        }
      } catch (err) {
        console.error('Failed to fetch system config:', err);
      }
    };
    run();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const intervalMs = useMotion ? 6000 : 10000;
    const id = setInterval(
      () => setInsightIndex((i) => (i + 1) % INSIGHT_SLIDES.length),
      intervalMs,
    );
    return () => clearInterval(id);
  }, [useMotion]);

  useEffect(() => {
    if (!authLoading && user) {
      const role = user.user_metadata?.role;
      if (role) {
        switch (role) {
          case 'admin':
            navigate('/admin/dashboard');
            break;
          case 'manager':
            navigate('/manager/dashboard');
            break;
          case 'officer':
            navigate('/officer/dashboard');
            break;
          default:
            console.warn('User has no recognized role:', role);
            navigate('/');
        }
      } else {
        navigate('/');
      }
    }
  }, [user, authLoading, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (rememberMe) {
      localStorage.setItem('mukwano_login_email', email.trim());
    } else {
      localStorage.removeItem('mukwano_login_email');
    }
    setIsSubmitting(true);
    try {
      const { error } = await signIn(email, password);
      if (error) {
        console.error('Login error:', error);
        toast({
          variant: 'destructive',
          title: 'Sign in failed',
          description:
            error.message === 'Invalid login credentials'
              ? 'Invalid email or password.'
              : error.message || 'An error occurred during sign in.',
        });
      }
    } catch (err) {
      console.error('Unexpected login error:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'An unexpected error occurred. Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgot = () => {
    toast({
      title: 'Reset password',
      description: 'Contact your system administrator to reset your password.',
    });
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-100 text-muted-foreground">
        <Loader2 className="h-10 w-10 animate-spin text-primary" aria-hidden />
        <p className="text-sm font-medium">Preparing your workspace…</p>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>Sign in — {systemConfig.name}</title>
        <meta name="description" content={`Sign in to ${systemConfig.name}`} />
      </Helmet>

      <div className="min-h-screen bg-slate-100 lg:grid lg:grid-cols-2">
        <main className="order-1 flex flex-col justify-center px-4 py-10 sm:px-8 lg:order-2 lg:px-12 xl:px-20">
          <div className="mx-auto w-full max-w-md">
            <div className="mb-6 flex flex-col items-center justify-end gap-2 sm:flex-row sm:justify-end">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200/80 bg-white/90 px-3 py-1.5 text-xs font-medium text-emerald-800 shadow-sm backdrop-blur">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                System online
                <span className="text-muted-foreground">·</span>
                <time dateTime={format(now, 'yyyy-MM-dd')}>{format(now, 'EEE, d MMM yyyy')}</time>
              </div>
            </div>

            <div className="relative rounded-2xl border border-slate-200/80 bg-white/95 p-6 shadow-[0_24px_64px_-16px_rgba(15,23,42,0.18)] backdrop-blur-sm sm:p-8">
              <div className="mb-6 flex flex-col items-center text-center">
                <div
                  className={cn(
                    'mb-4 flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-gradient-to-br from-slate-50 to-white shadow-md',
                    'ring-2 ring-primary/15',
                  )}
                >
                  <img
                    src={brandLogoSrc}
                    alt="Mukwano Financial Services logo"
                    className="h-14 w-14 object-contain p-0.5"
                  />
                </div>
                <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-primary">
                  Secure access
                </p>
                <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                  Sign in to your account
                </h1>
                <p className="mt-1 text-sm text-slate-500">Use the email your administrator gave you.</p>
              </div>

              <motion.form
                onSubmit={handleSubmit}
                className="space-y-4"
                variants={useMotion ? formVariants : undefined}
                initial={useMotion ? 'hidden' : false}
                animate="show"
              >
                <motion.div className="space-y-2" variants={useMotion ? fieldVariants : undefined}>
                  <Label htmlFor="email" className="text-slate-700">
                    Email address
                  </Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-11 border-slate-200 bg-slate-50/90 pl-10 pr-10 focus-visible:border-primary"
                      required
                    />
                    {emailLooksValid(email) && (
                      <CheckCircle2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" aria-hidden />
                    )}
                  </div>
                </motion.div>

                <motion.div className="space-y-2" variants={useMotion ? fieldVariants : undefined}>
                  <Label htmlFor="password" className="text-slate-700">
                    Password
                  </Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-11 border-slate-200 bg-slate-50/90 pl-10 pr-10 focus-visible:border-primary"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((p) => !p)}
                      className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-slate-400 hover:text-slate-700"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </motion.div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="remember"
                      checked={rememberMe}
                      onCheckedChange={(c) => setRememberMe(!!c)}
                    />
                    <label htmlFor="remember" className="text-sm text-slate-600">
                      Remember me
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={handleForgot}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>

                <MotionButton
                  type="submit"
                  variant="ghost"
                  disabled={isSubmitting}
                  className="group relative h-12 w-full overflow-hidden rounded-xl border-0 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-800 text-base font-semibold !text-white shadow-lg hover:!bg-gradient-to-r hover:from-emerald-500 hover:via-teal-500 hover:to-emerald-700 hover:!text-white"
                  whileHover={useMotion && !isSubmitting ? { y: -1, scale: 1.005 } : undefined}
                  whileTap={useMotion && !isSubmitting ? { scale: 0.99 } : undefined}
                >
                  {useMotion && !isSubmitting && (
                    <span
                      className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
                      aria-hidden
                    />
                  )}
                  {isSubmitting ? (
                    <span className="relative z-10 inline-flex items-center">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Signing in…
                    </span>
                  ) : (
                    <span className="relative z-10 inline-flex items-center justify-center gap-2">
                      Sign in
                      <ArrowRight className="h-4 w-4" />
                    </span>
                  )}
                </MotionButton>

                <p className="flex items-center justify-center gap-1.5 text-center text-xs text-slate-500">
                  <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  Your session is protected. Never share your password.
                </p>
              </motion.form>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-4 text-[0.7rem] font-medium uppercase tracking-wide text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-emerald-600" />
                Encrypted
              </span>
              <span className="inline-flex items-center gap-1.5">
                <UserCog className="h-3.5 w-3.5 text-emerald-600" />
                Role-based
              </span>
              <span className="inline-flex items-center gap-1.5">
                <RefreshCw className="h-3.5 w-3.5 text-emerald-600" />
                Live sync
              </span>
            </div>

            <div className="mt-6 flex items-start gap-3 rounded-xl border border-slate-200/90 bg-white/80 p-3 shadow-sm">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <MessageCircle className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">Need help?</p>
                <p className="text-xs text-slate-600">
                  Contact your branch administrator or IT support for access issues.
                </p>
              </div>
            </div>

            <p className="mt-6 text-center text-xs text-slate-400">
              © {new Date().getFullYear()} {systemConfig.name}
            </p>
          </div>
        </main>

        <aside
          className="relative order-2 flex min-h-[44vh] flex-col justify-between overflow-hidden bg-gradient-to-br from-[#0a1628] via-[#0c2818] to-[#1a0f1a] px-6 py-8 text-slate-100 sm:px-10 sm:py-10 lg:order-1 lg:min-h-screen lg:px-10 lg:py-9"
          aria-label="Product information"
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.15]"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='32' height='32' viewBox='0 0 32 32' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='1' cy='1' r='0.6' fill='white'/%3E%3C/svg%3E")`,
            }}
          />
          <div className="pointer-events-none absolute -right-20 top-1/3 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />
          <div className="pointer-events-none absolute -left-16 bottom-20 h-56 w-56 rounded-full bg-rose-600/20 blur-3xl" />
          <div
            className="pointer-events-none absolute bottom-0 right-0 h-64 w-48 rounded-tl-[3rem] border border-white/5 bg-white/[0.03]"
            style={{ boxShadow: '0 0 80px rgba(16, 185, 129, 0.08) inset' }}
          />

          <div className="relative z-10">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="rounded-lg bg-white/95 p-1.5 shadow-md">
                  <SystemBrandLogo logoUrl={systemConfig.logoUrl} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold tracking-tight text-white sm:text-base">
                    {systemConfig.name}
                  </p>
                  <p className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-emerald-300/90">
                    Microfinance suite
                  </p>
                </div>
              </div>
              <div className="shrink-0 text-right text-[0.65rem] tabular-nums text-slate-300/95 sm:text-xs">
                <p className="font-mono text-sm font-medium text-white sm:text-base">
                  {format(now, 'HH:mm:ss')}
                </p>
                <p className="text-slate-400">{format(now, 'EEE, d MMM')}</p>
              </div>
            </div>

            <p className="mt-8 text-[0.65rem] font-bold uppercase tracking-[0.22em] text-emerald-400/80">
              Operations
            </p>
            <h2 className="mt-2 max-w-md text-2xl font-bold leading-tight text-white sm:text-3xl">
              One platform for every <span className="text-emerald-400">microfinance</span> workflow.
            </h2>
            <ul className="mt-6 space-y-3">
              {HERO_POINTS.map((line) => (
                <li key={line} className="flex gap-2.5 text-sm text-slate-200/90">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  {line}
                </li>
              ))}
            </ul>
          </div>

          <div
            className="relative z-10 my-6 min-h-[5.5rem] overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-md"
            aria-live="polite"
            aria-atomic="true"
          >
            <AnimatePresence initial={false} mode="wait">
              <motion.div
                key={insightIndex}
                initial={useMotion ? { opacity: 0, y: 8 } : false}
                animate={{ opacity: 1, y: 0 }}
                exit={useMotion ? { opacity: 0, y: -6 } : undefined}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              >
                <p className="text-sm font-semibold text-white">
                  {INSIGHT_SLIDES[insightIndex].title}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-300/85">
                  {INSIGHT_SLIDES[insightIndex].description}
                </p>
              </motion.div>
            </AnimatePresence>
            <div
              className="mt-3 flex justify-center gap-1.5"
              aria-hidden
            >
              {INSIGHT_SLIDES.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-1 w-1 rounded-full transition-colors duration-300',
                    i === insightIndex ? 'w-3 bg-emerald-400' : 'bg-white/20',
                  )}
                />
              ))}
            </div>
          </div>

          <div className="relative z-10 flex flex-wrap gap-2">
            {[
              { t: 'Portfolio', s: 'Loans' },
              { t: 'Live', s: 'Sync' },
              { t: 'Secure', s: 'Access' },
            ].map(({ t, s }) => (
              <div
                key={t + s}
                className="flex min-w-0 flex-1 basis-[7rem] flex-col rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-center shadow-sm backdrop-blur-sm"
              >
                <span className="text-xs font-bold text-white/95">{t}</span>
                <span className="text-[0.6rem] font-semibold uppercase tracking-wider text-emerald-300/80">
                  {s}
                </span>
              </div>
            ))}
          </div>

          <p className="relative z-10 text-[0.65rem] text-slate-500">Authorized staff only.</p>
        </aside>
      </div>
    </>
  );
}
