import { format, parseISO, startOfDay, endOfDay, isSameDay, startOfMonth, endOfMonth } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { getManagerBranchId } from '@/lib/managerBranch';

const EAT = 'Africa/Nairobi';

function filterLoansByCenterGroup(loans, centerId, groupId) {
  if (!loans?.length) return [];
  return loans.filter((loan) => {
    const b = loan.borrowers;
    if (!b) return true;
    if (groupId && groupId !== 'all' && b.group_id !== groupId) return false;
    if (centerId && centerId !== 'all') {
      const c = b.center_id || b.groups?.center_id;
      return c === centerId;
    }
    return true;
  });
}

function filterBorrowersRaw(rows, centerId, groupId) {
  if (!rows?.length) return [];
  return rows.filter((b) => {
    if (groupId && groupId !== 'all' && b.group_id !== groupId) return false;
    if (centerId && centerId !== 'all') {
      const c = b.center_id || b.groups?.center_id;
      return c === centerId;
    }
    return true;
  });
}

const TITLE = {
  borrowers: 'Borrowers registered in period',
  'active-loans': 'Active loans',
  portfolio: 'Active loans (portfolio)',
  'principal-disbursed': 'Principal disbursed in period',
  'principal-collected': 'Principal collected in period',
  'interest-collected': 'Interest collected in period',
  'outstanding-principal': 'Outstanding principal (active loans)',
  'outstanding-interest': 'Outstanding interest (active loans)',
  'defaulted-principal': 'Defaulted loans (principal balance)',
  'defaulted-interest': 'Defaulted loans (interest balance)',
  'expected-today': 'Installments due today',
  'disbursed-this-month': 'Loans disbursed this month',
  'loan-officers': 'Loan officers in your branch',
};

/**
 * @returns {Promise<{ pageTitle: string, columns: { key: string, label: string }[], rows: Record<string, unknown>[] }>}
 */
export async function loadMetricData({
  role,
  metric,
  fromStr,
  toStr,
  centerId,
  groupId,
  officerId = 'all',
  user,
  supabase,
  toast,
}) {
  const fromD = fromStr ? parseISO(fromStr) : startOfMonth(new Date());
  const toD = toStr ? parseISO(toStr) : new Date();
  const fromIso = startOfDay(fromD).toISOString();
  const toIso = endOfDay(toD).toISOString();
  const fromDate = format(fromD, 'yyyy-MM-dd');
  const toDate = format(toD, 'yyyy-MM-dd');
  const todayStr = format(toZonedTime(new Date(), EAT), 'yyyy-MM-dd', {
    timeZone: EAT,
  });

  const branchId =
    role === 'manager'
      ? (await getManagerBranchId(user))
      : (user.user_metadata?.branch_id ?? null);
  const userId = user.id;

  let officerIds = [userId];
  if (role === 'manager' && branchId) {
    const { data: officers } = await supabase
      .from('users')
      .select('id')
      .eq('branch_id', branchId)
      .eq('role', 'officer');
    officerIds = (officers || []).map((o) => o.id);
    if (!officerIds.length) officerIds = ['00000000-0000-0000-0000-000000000000'];
  }
  if (role === 'manager' && officerId && officerId !== 'all') {
    officerIds = [officerId];
  }

  const pageTitle = TITLE[metric] || 'Dashboard detail';

  try {
    if (metric === 'borrowers') {
      let q = supabase
        .from('borrowers')
        .select('id, first_name, surname, borrower_id, phone_number, status, created_at, branch_id, center_id, group_id, branches(name), groups(name, center_id)')
        .gte('created_at', fromIso)
        .lte('created_at', toIso)
        .order('created_at', { ascending: false });

      if (role === 'officer') {
        q = q.eq('loan_officer_id', userId);
      } else if (role === 'manager' && branchId) {
        q = q.eq('branch_id', branchId);
        if (officerId && officerId !== 'all') {
          q = q.eq('loan_officer_id', officerId);
        }
      } else if (role === 'admin') {
        q = q.limit(2000);
      }

      const { data, error } = await q;
      if (error) throw error;
      const filtered = filterBorrowersRaw(data || [], centerId, groupId);
      return {
        pageTitle: TITLE.borrowers,
        columns: [
          { key: 'name', label: 'Borrower name' },
          { key: 'branch', label: 'Branch' },
          { key: 'status', label: 'Status' },
          { key: 'borrower_id', label: 'Borrower ID' },
          { key: 'uuid', label: 'Borrower UUID' },
          { key: 'created_at', label: 'Created at' },
          { key: 'phone', label: 'Phone' },
        ],
        rows: filtered.map((b) => ({
          name: [b.first_name, b.surname].filter(Boolean).join(' '),
          branch: b.branches?.name || '—',
          status: b.status || '—',
          borrower_id: b.borrower_id || '—',
          uuid: b.id,
          created_at: b.created_at
            ? format(parseISO(b.created_at), 'yyyy-MM-dd HH:mm')
            : '—',
          phone: b.phone_number || '—',
        })),
      };
    }

    if (
      ['active-loans', 'portfolio', 'outstanding-principal', 'outstanding-interest'].includes(
        metric,
      )
    ) {
      let q = supabase
        .from('loans')
        .select(
          'id, loan_id, status, principal, balance, disbursement_date, borrowers!inner ( first_name, surname, group_id, center_id, phone_number, groups ( name, center_id ) )',
        )
        .eq('status', 'active');
      if (role === 'officer') q = q.eq('officer_id', userId);
      else if (role === 'manager' && officerIds.length)
        q = q.in('officer_id', officerIds);
      else if (role === 'admin') q = q.limit(3000);

      const { data, error } = await q;
      if (error) throw error;
      const list = filterLoansByCenterGroup(data || [], centerId, groupId);
      return {
        pageTitle: TITLE[metric],
        columns: [
          { key: 'loan_id', label: 'Loan ID' },
          { key: 'borrower', label: 'Borrower' },
          { key: 'status', label: 'Status' },
          { key: 'principal', label: 'Principal' },
          { key: 'balance', label: 'Balance' },
          { key: 'disbursed', label: 'Disbursement date' },
        ],
        rows: list.map((l) => ({
          loan_id: l.loan_id,
          borrower: l.borrowers
            ? [l.borrowers.first_name, l.borrowers.surname]
                .filter(Boolean)
                .join(' ')
            : '—',
          status: l.status,
          principal: Number(l.principal || 0).toLocaleString(),
          balance: Number(l.balance || 0).toLocaleString(),
          disbursed: l.disbursement_date || '—',
        })),
      };
    }

    if (metric === 'principal-disbursed' || metric === 'disbursed-this-month') {
      let f = fromDate;
      let t = toDate;
      if (metric === 'disbursed-this-month') {
        f = format(startOfMonth(toD), 'yyyy-MM-dd');
        t = format(endOfMonth(toD), 'yyyy-MM-dd');
      }
      let q = supabase
        .from('loans')
        .select(
          'id, loan_id, principal, balance, disbursement_date, status, borrowers!inner ( first_name, surname, group_id, center_id, groups ( name, center_id ) )',
        )
        .gte('disbursement_date', f)
        .lte('disbursement_date', t)
        .order('disbursement_date', { ascending: false });
      if (role === 'officer') q = q.eq('officer_id', userId);
      else if (role === 'manager' && officerIds.length)
        q = q.in('officer_id', officerIds);
      else if (role === 'admin') q = q.limit(5000);
      const { data, error } = await q;
      if (error) throw error;
      const list = filterLoansByCenterGroup(data || [], centerId, groupId);
      return {
        pageTitle: TITLE[metric],
        columns: [
          { key: 'loan_id', label: 'Loan ID' },
          { key: 'borrower', label: 'Borrower' },
          { key: 'principal', label: 'Principal' },
          { key: 'disbursed', label: 'Disbursement date' },
          { key: 'status', label: 'Status' },
        ],
        rows: list.map((l) => ({
          loan_id: l.loan_id,
          borrower: l.borrowers
            ? [l.borrowers.first_name, l.borrowers.surname]
                .filter(Boolean)
                .join(' ')
            : '—',
          principal: Number(l.principal || 0).toLocaleString(),
          disbursed: l.disbursement_date || '—',
          status: l.status,
        })),
      };
    }

    if (metric === 'principal-collected' || metric === 'interest-collected') {
      let q = supabase
        .from('repayments')
        .select(
          'id, amount, principal_paid, interest_paid, actual_payment_date, loan_id, loans!inner ( loan_id, borrowers!inner ( first_name, surname, group_id, center_id, groups ( name, center_id ) ) )',
        )
        .gte('actual_payment_date', fromDate)
        .lte('actual_payment_date', toDate)
        .order('actual_payment_date', { ascending: false });
      if (role === 'officer') q = q.eq('officer_id', userId);
      else if (role === 'manager' && officerIds.length)
        q = q.in('officer_id', officerIds);
      else if (role === 'admin') q = q.limit(10000);
      const { data, error } = await q;
      if (error) throw error;
      const list = (data || []).filter((r) => {
        const b = r.loans?.borrowers;
        if (!b) return true;
        if (groupId && groupId !== 'all' && b.group_id !== groupId) return false;
        if (centerId && centerId !== 'all') {
          const c = b.center_id || b.groups?.center_id;
          return c === centerId;
        }
        return true;
      });
      return {
        pageTitle: TITLE[metric],
        columns:
          metric === 'principal-collected'
            ? [
                { key: 'pay_date', label: 'Payment date' },
                { key: 'loan_id', label: 'Loan ID' },
                { key: 'borrower', label: 'Borrower' },
                { key: 'principal_paid', label: 'Principal' },
              ]
            : [
                { key: 'pay_date', label: 'Payment date' },
                { key: 'loan_id', label: 'Loan ID' },
                { key: 'borrower', label: 'Borrower' },
                { key: 'interest_paid', label: 'Interest' },
              ],
        rows: list.map((r) => ({
          pay_date: r.actual_payment_date,
          loan_id: r.loans?.loan_id,
          borrower: r.loans?.borrowers
            ? [r.loans.borrowers.first_name, r.loans.borrowers.surname]
                .filter(Boolean)
                .join(' ')
            : '—',
          principal_paid: Number(r.principal_paid || 0).toLocaleString(),
          interest_paid: Number(r.interest_paid || 0).toLocaleString(),
        })),
      };
    }

    if (metric === 'defaulted-principal' || metric === 'defaulted-interest') {
      let q = supabase
        .from('loans')
        .select(
          'id, loan_id, principal, balance, status, borrowers!inner ( first_name, surname, group_id, center_id, groups ( name, center_id ) )',
        )
        .eq('status', 'defaulted');
      if (role === 'officer') q = q.eq('officer_id', userId);
      else if (role === 'manager' && officerIds.length)
        q = q.in('officer_id', officerIds);
      else if (role === 'admin') q = q.limit(3000);
      const { data, error } = await q;
      if (error) throw error;
      const list = filterLoansByCenterGroup(data || [], centerId, groupId);
      return {
        pageTitle: TITLE[metric],
        columns: [
          { key: 'loan_id', label: 'Loan ID' },
          { key: 'borrower', label: 'Borrower' },
          { key: 'principal', label: 'Principal' },
          { key: 'balance', label: 'Balance' },
        ],
        rows: list.map((l) => ({
          loan_id: l.loan_id,
          borrower: l.borrowers
            ? [l.borrowers.first_name, l.borrowers.surname]
                .filter(Boolean)
                .join(' ')
            : '—',
          principal: Number(l.principal || 0).toLocaleString(),
          balance: Number(l.balance || 0).toLocaleString(),
        })),
      };
    }

    if (metric === 'expected-today') {
      let q = supabase
        .from('loans')
        .select(
          'id, loan_id, schedule, status, borrowers!inner ( first_name, surname, group_id, center_id, groups ( name, center_id ) )',
        )
        .eq('status', 'active');
      if (role === 'officer') q = q.eq('officer_id', userId);
      else if (role === 'manager' && officerIds.length)
        q = q.in('officer_id', officerIds);
      else if (role === 'admin') q = q.limit(2000);
      const { data, error } = await q;
      if (error) throw error;
      const all = filterLoansByCenterGroup(data || [], centerId, groupId);
      const rows = [];
      for (const l of all) {
        if (!l.schedule || !Array.isArray(l.schedule)) continue;
        for (const inst of l.schedule) {
          if (inst.paid) continue;
          if (!inst.dueDate) continue;
          const due = parseISO(
            String(inst.dueDate).length <= 10
              ? `${inst.dueDate}T12:00:00`
              : inst.dueDate,
          );
          const dueEat = toZonedTime(due, EAT);
          const nowEat = toZonedTime(parseISO(`${todayStr}T12:00:00`), EAT);
          if (!isSameDay(dueEat, nowEat)) continue;
          const amt = Number(
            inst.totalDue ?? inst.amount ?? inst.total ?? 0,
          );
          if (amt <= 0) continue;
          rows.push({
            loan_id: l.loan_id,
            borrower: l.borrowers
              ? [l.borrowers.first_name, l.borrowers.surname]
                  .filter(Boolean)
                  .join(' ')
              : '—',
            amount: amt.toLocaleString(),
          });
          break;
        }
      }
      return {
        pageTitle: TITLE['expected-today'],
        columns: [
          { key: 'loan_id', label: 'Loan ID' },
          { key: 'borrower', label: 'Borrower' },
          { key: 'amount', label: 'Expected amount' },
        ],
        rows,
      };
    }

    if (metric === 'loan-officers' && role === 'manager' && branchId) {
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, email')
        .eq('role', 'officer')
        .eq('branch_id', branchId)
        .order('full_name');
      if (error) throw error;
      return {
        pageTitle: TITLE['loan-officers'],
        columns: [
          { key: 'full_name', label: 'Name' },
          { key: 'email', label: 'Email' },
          { key: 'id', label: 'User ID' },
        ],
        rows: (data || []).map((u) => ({
          full_name: u.full_name,
          email: u.email,
          id: u.id,
        })),
      };
    }
  } catch (e) {
    console.error(e);
    if (toast) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  }

  return { pageTitle, columns: [], rows: [] };
}

export function getDashboardBasePath(role) {
  if (role === 'admin') return '/admin/dashboard';
  if (role === 'manager') return '/manager/dashboard';
  return '/officer/dashboard';
}
