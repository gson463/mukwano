import React, { useState, useEffect, useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Home,
  Users,
  Briefcase,
  DollarSign,
  Settings,
  LogOut,
  Building,
  UserPlus,
  BookOpen,
  GitBranch,
  ArrowLeftRight,
  Calendar,
  Users2,
  FileText,
  UserCog,
  AlertTriangle,
  FileX,
  BarChart3,
  Menu,
  ChevronLeft,
  ChevronRight,
  X,
  Archive,
  ScrollText,
  ClipboardList,
} from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Helmet } from 'react-helmet';
import { cn } from '@/lib/utils';
import { DEFAULT_ORG_NAME, fetchSystemConfig } from '@/lib/systemConfig';
import { SystemBrandLogo } from '@/components/SystemBrandLogo';
import { motion, AnimatePresence } from 'framer-motion';

const reportLinks = [{ to: '/reports', icon: BarChart3, text: 'Reports' }];

/** Admin — primary nav (FCL-style "Menu" group; excludes system settings) */
const adminMainLinks = [
  { to: '/admin/dashboard', icon: Home, text: 'Dashboard' },
  { to: '/admin/branches', icon: GitBranch, text: 'Branches' },
  { to: '/admin/users', icon: Users, text: 'Users' },
  { to: '/admin/borrowers', icon: Users2, text: 'Borrowers' },
  { to: '/admin/loans', icon: Briefcase, text: 'Loans' },
  { to: '/admin/reassignment', icon: ArrowLeftRight, text: 'Officer transfer' },
  { to: '/admin/loan-products', icon: Briefcase, text: 'Loan Products' },
  { to: '/admin/data-history', icon: Archive, text: 'History & audit' },
  { to: '/admin/loan-requests', icon: FileText, text: 'Loan Requests' },
  { to: '/admin/repayment-management', icon: DollarSign, text: 'Repayments' },
  { to: '/arrears', icon: AlertTriangle, text: 'Arrears' },
  { to: '/defaulters', icon: FileX, text: 'Defaulters' },
  { to: '/admin/holidays', icon: Calendar, text: 'Holidays' },
];

const adminSystemLinks = [
  { to: '/admin/settings', icon: Settings, text: 'System Settings' },
  { to: '/admin/audit-logs', icon: ScrollText, text: 'Activity log' },
];

const managerLinks = [
  { to: '/manager/dashboard', icon: Home, text: 'Dashboard' },
  { to: '/manager/loan-officers', icon: UserPlus, text: 'Loan Officers' },
  { to: '/manager/loans', icon: Briefcase, text: 'Loans' },
  { to: '/manager/loan-requests', icon: FileText, text: 'Loan Requests' },
  { to: '/manager/repayment-management', icon: DollarSign, text: 'Repayments' },
  { to: '/arrears', icon: AlertTriangle, text: 'Arrears' },
  { to: '/defaulters', icon: FileX, text: 'Defaulters' },
];

const officerLinks = [
  { to: '/officer/dashboard', icon: Home, text: 'Dashboard' },
  { to: '/officer/centers-groups', icon: Building, text: 'Centers & Groups' },
  { to: '/officer/attendance', icon: ClipboardList, text: 'Attendance' },
  { to: '/officer/borrowers', icon: Users, text: 'Borrowers' },
  { to: '/officer/loans', icon: Briefcase, text: 'Loans' },
  { to: '/officer/group-repayment', icon: Users2, text: 'Group Repayment' },
  { to: '/officer/repayment-management', icon: DollarSign, text: 'Repayments' },
  { to: '/arrears', icon: AlertTriangle, text: 'Arrears' },
  { to: '/defaulters', icon: FileX, text: 'Defaulters' },
  { to: '/officer/expenses', icon: BookOpen, text: 'Expenses' },
];

const SidebarLink = ({ to, icon: Icon, text, collapsed }) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      cn(
        'mb-1 flex items-center rounded-lg py-3 text-sm font-medium transition-all duration-200',
        collapsed ? 'justify-center px-2' : 'px-4',
        isActive
          ? 'bg-green-700 text-white shadow-md'
          : 'text-gray-300 hover:bg-green-800 hover:text-white',
      )
    }
    title={collapsed ? text : undefined}
  >
    <Icon className={cn('h-5 w-5 flex-shrink-0', collapsed ? 'mr-0' : 'mr-3')} />
    {!collapsed && <span>{text}</span>}
  </NavLink>
);

const NavSection = ({ label, children, collapsed }) => (
  <div>
    {!collapsed && (
      <p className="mb-1.5 px-4 text-[0.65rem] font-bold uppercase tracking-[0.18em] text-green-500/80">
        {label}
      </p>
    )}
    {children}
  </div>
);

const DashboardLayout = ({ children, title, description = 'Microfinance Management System' }) => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [systemConfig, setSystemConfig] = useState({ name: DEFAULT_ORG_NAME, logoUrl: null });

  const loadSystemConfig = useCallback(async () => {
    const next = await fetchSystemConfig();
    setSystemConfig(next);
  }, []);

  useEffect(() => {
    document.documentElement.classList.remove('dark');
    try {
      localStorage.removeItem('theme');
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadSystemConfig();
  }, [loadSystemConfig]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
    toast({
      title: 'Signed Out',
      description: 'You have been successfully signed out.',
    });
  };

  let menuLinks = [];
  let systemLinks = null;
  if (user) {
    switch (user.user_metadata?.role) {
      case 'admin':
        menuLinks = adminMainLinks;
        systemLinks = adminSystemLinks;
        break;
      case 'manager':
        menuLinks = managerLinks;
        break;
      case 'officer':
        menuLinks = officerLinks;
        break;
      default:
        menuLinks = [];
    }
  }

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);
  const toggleCollapse = () => setIsCollapsed(!isCollapsed);

  return (
    <>
      <Helmet>
        <title>{`${title} | ${systemConfig.name}`}</title>
        <meta name="description" content={description} />
      </Helmet>

      <div className="flex h-screen overflow-hidden bg-gray-100">
        <AnimatePresence>
          {isSidebarOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            />
          )}
        </AnimatePresence>

        <motion.aside
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex flex-col bg-green-900 text-white shadow-xl transition-all duration-300 ease-in-out lg:static lg:shadow-none',
            isCollapsed ? 'w-20' : 'w-72',
            'lg:translate-x-0',
            isSidebarOpen ? 'w-72 translate-x-0' : '-translate-x-full lg:translate-x-0',
          )}
        >
          <div
            className={cn(
              'relative z-10 box-border flex h-20 shrink-0 items-center border-b-2 border-green-700 bg-white p-4',
              isCollapsed ? 'justify-center' : 'justify-between',
            )}
          >
            {!isCollapsed ? (
              <div className="flex min-w-0 items-center gap-3 overflow-hidden">
                <SystemBrandLogo logoUrl={systemConfig.logoUrl} />
                <span className="truncate text-lg font-bold text-green-900">{systemConfig.name}</span>
              </div>
            ) : (
              <SystemBrandLogo logoUrl={systemConfig.logoUrl} imageClassName="!h-8 !w-8 !p-0.5" />
            )}
            <button
              type="button"
              onClick={toggleSidebar}
              className="p-2 text-gray-500 hover:text-gray-700 lg:hidden"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          <nav className="scrollbar-hide flex-1 space-y-1 overflow-y-auto px-3 py-4">
            <NavSection label="Menu" collapsed={isCollapsed}>
              {menuLinks.map((link) => (
                <SidebarLink key={link.to} {...link} collapsed={isCollapsed} />
              ))}
            </NavSection>
            <div className="my-4 border-t border-green-700/50" />
            <NavSection label="Reports" collapsed={isCollapsed}>
              {reportLinks.map((link) => (
                <SidebarLink key={link.to} {...link} collapsed={isCollapsed} />
              ))}
            </NavSection>
            {systemLinks && systemLinks.length > 0 && (
              <>
                <div className="my-4 border-t border-green-700/50" />
                <NavSection label="System" collapsed={isCollapsed}>
                  {systemLinks.map((link) => (
                    <SidebarLink key={link.to} {...link} collapsed={isCollapsed} />
                  ))}
                </NavSection>
              </>
            )}
          </nav>

          <div className="space-y-2 bg-green-950/30 p-3">
            <Button
              type="button"
              onClick={toggleCollapse}
              variant="ghost"
              className={cn(
                'hidden w-full text-green-300 hover:bg-green-800 hover:text-white lg:flex',
                isCollapsed ? 'justify-center px-0' : 'justify-start',
              )}
              title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isCollapsed ? (
                <ChevronRight className="h-5 w-5" />
              ) : (
                <>
                  <ChevronLeft className="mr-3 h-5 w-5" />
                  <span>Collapse</span>
                </>
              )}
            </Button>

            <Button
              type="button"
              onClick={handleSignOut}
              variant="ghost"
              className={cn(
                'w-full text-red-300 hover:bg-red-900/30 hover:text-red-200',
                isCollapsed ? 'justify-center px-0' : 'justify-start',
              )}
              title="Sign out"
            >
              <LogOut className={cn('h-5 w-5', isCollapsed ? 'mr-0' : 'mr-3')} />
              {!isCollapsed && <span>Sign out</span>}
            </Button>
          </div>
        </motion.aside>

        <div className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden bg-white">
          <header className="z-30 box-border flex h-20 w-full shrink-0 border-b-2 border-green-700 bg-white">
            <div className="flex h-full w-full items-center justify-between gap-2 px-3 sm:px-4 lg:px-6">
              <div className="flex min-h-0 min-w-0 flex-1 items-center gap-2 sm:gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={toggleSidebar}
                  className="-ml-1 h-9 w-9 shrink-0 lg:hidden"
                  aria-label="Open menu"
                >
                  <Menu className="h-5 w-5 text-gray-700" />
                </Button>
                <div className="min-w-0 pr-1">
                  <h1 className="truncate text-sm font-bold leading-tight text-gray-900 sm:text-base lg:text-lg">
                    {title}
                  </h1>
                  <p className="mt-0.5 line-clamp-1 text-xs text-gray-500 sm:text-sm">{description}</p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
                <span
                  className="hidden max-w-[10rem] truncate rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1 text-center text-xs font-semibold text-gray-800 md:inline-block"
                  title={systemConfig.name}
                >
                  {systemConfig.name}
                </span>
                <NavLink
                  to="/profile"
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-800 shadow-sm transition hover:bg-gray-50 sm:gap-2 sm:px-3"
                >
                  <UserCog className="h-4 w-4" />
                  <span>Profile</span>
                </NavLink>
              </div>
            </div>
          </header>

          <main className="relative min-w-0 flex-1 overflow-y-auto overflow-x-auto bg-gray-50/50 p-4 sm:p-6 lg:p-8 [scrollbar-gutter:stable]">
            <div className="mx-auto min-w-0 w-full max-w-7xl">{children}</div>
          </main>
        </div>
      </div>
    </>
  );
};

export default DashboardLayout;
