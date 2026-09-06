/** Shared list rules for Borrowers pages (officer / admin). */

import { LOAN_OPEN_STATUSES } from '@/lib/loanListQuery';

/** Loan statuses that mean the borrower still has an outstanding loan. */
export const BORROWER_OPEN_LOAN_STATUSES = LOAN_OPEN_STATUSES.filter(
	(s) => s === 'active' || s === 'delinquent' || s === 'defaulted',
);

export function borrowerMatchesIdentitySearch(borrower, searchQuery) {
	const q = String(searchQuery || '').trim().toLowerCase();
	if (!q) return false;
	const name = `${borrower?.first_name || ''} ${borrower?.surname || ''}`.toLowerCase();
	const borrowerId = String(borrower?.borrower_id || '').toLowerCase();
	return name.includes(q) || borrowerId.includes(q);
}

export function borrowerMatchesGeneralSearch(borrower, searchQuery, extraHaystacks = []) {
	const q = String(searchQuery || '').trim().toLowerCase();
	if (!q) return true;
	if (borrowerMatchesIdentitySearch(borrower, searchQuery)) return true;
	const phone = String(borrower?.phone_number || '').toLowerCase();
	const idNo = String(borrower?.identification_number || '').toLowerCase();
	if (phone.includes(q) || idNo.includes(q)) return true;
	return extraHaystacks.some((h) => h && String(h).toLowerCase().includes(q));
}

/** @deprecated legacy borrower.status values — prefer hasOpenLoan from loans. */
export const BORROWER_ACTIVE_STATUSES = ['active_loan', 'active'];
export const BORROWER_ACTIVE_LOAN_STATUS = 'active_loan';

export function isActiveBorrowerStatus(status) {
	return BORROWER_ACTIVE_STATUSES.includes(status);
}

/**
 * Default list = borrowers with an open loan (hasOpenLoan).
 * Others appear only via name/borrower-ID search or a specific status filter.
 */
export function shouldIncludeBorrowerByStatusAndSearch(borrower, { searchQuery, statusFilter }) {
	const status = borrower?.status;
	const identityHit = borrowerMatchesIdentitySearch(borrower, searchQuery);
	const hasOpenLoan = borrower?.hasOpenLoan === true;

	if (hasOpenLoan) {
		if (statusFilter === 'all' || statusFilter === 'active_loan') return true;
		return statusFilter === status;
	}

	if (statusFilter === status) return true;
	if (!identityHit) return false;
	if (statusFilter === 'all' || statusFilter === 'active_loan') return true;
	return false;
}

export const BORROWER_LIST_SELECT =
	'*, users!loan_officer_id (full_name), branches (id, name), groups (id, name, center_id)';

/** Slimmer admin list (system-wide) — avoid `*` payload / timeouts. */
export const BORROWER_ADMIN_LIST_SELECT = [
	'id',
	'borrower_id',
	'first_name',
	'surname',
	'status',
	'phone_number',
	'branch_id',
	'group_id',
	'center_id',
	'loan_officer_id',
	'users!loan_officer_id (full_name)',
	'branches (id, name)',
	'groups (id, name, center_id)',
].join(',');

function sanitizeSearchToken(raw) {
	return String(raw || '')
		.trim()
		.replace(/[%_,.()']/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Borrowers matching name or borrower_id who are not already on an open loan
 * (search-only reveal for eligible / paid-up / etc.).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function fetchNonActiveBorrowersByNameOrId(
	supabase,
	{ searchQuery, select = BORROWER_LIST_SELECT, officerId = null, excludeBorrowerIds = null },
) {
	const q = sanitizeSearchToken(searchQuery);
	if (q.length < 2) return [];

	const pattern = `%${q}%`;
	const scope = (query) => {
		let qq = query;
		if (officerId) qq = qq.eq('loan_officer_id', officerId);
		return qq;
	};

	let byIdQ = scope(supabase.from('borrowers').select(select).ilike('borrower_id', pattern)).limit(40);
	let firstQ = scope(supabase.from('borrowers').select(select).ilike('first_name', pattern)).limit(40);
	let surQ = scope(supabase.from('borrowers').select(select).ilike('surname', pattern)).limit(40);

	const [{ data: byId, error: e1 }, { data: byFirst, error: e2 }, { data: bySur, error: e3 }] =
		await Promise.all([byIdQ, firstQ, surQ]);
	if (e1) throw e1;
	if (e2) throw e2;
	if (e3) throw e3;

	const exclude = excludeBorrowerIds instanceof Set ? excludeBorrowerIds : new Set(excludeBorrowerIds || []);
	const map = new Map();
	for (const row of [...(byId || []), ...(byFirst || []), ...(bySur || [])]) {
		if (!row?.id || exclude.has(row.id)) continue;
		map.set(row.id, { ...row, hasOpenLoan: false });
	}
	return [...map.values()];
}

async function collectOpenLoanBorrowerIds(supabase, { officerId = null, pageSize = 1000 } = {}) {
	const ids = new Set();
	let from = 0;
	for (;;) {
		let q = supabase
			.from('loans')
			.select('borrower_id')
			.in('status', BORROWER_OPEN_LOAN_STATUSES)
			.range(from, from + pageSize - 1);
		if (officerId) q = q.eq('officer_id', officerId);

		const { data, error } = await q;
		if (error) throw error;
		const rows = data || [];
		for (const row of rows) {
			if (row?.borrower_id) ids.add(row.borrower_id);
		}
		if (rows.length < pageSize) break;
		from += pageSize;
	}
	return [...ids];
}

/**
 * Borrowers who currently have at least one open (non-paid) loan.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function fetchBorrowersWithOpenLoans(
	supabase,
	{ select = BORROWER_LIST_SELECT, officerId = null, chunkSize = 200 } = {},
) {
	const borrowerIds = await collectOpenLoanBorrowerIds(supabase, { officerId });
	if (borrowerIds.length === 0) return [];

	const all = [];
	for (let i = 0; i < borrowerIds.length; i += chunkSize) {
		const slice = borrowerIds.slice(i, i + chunkSize);
		let q = supabase.from('borrowers').select(select).in('id', slice);
		if (officerId) q = q.eq('loan_officer_id', officerId);
		const { data, error } = await q;
		if (error) throw error;
		for (const row of data || []) {
			all.push({ ...row, hasOpenLoan: true });
		}
	}

	all.sort((a, b) => {
		const an = `${a.first_name || ''} ${a.surname || ''}`.toLowerCase();
		const bn = `${b.first_name || ''} ${b.surname || ''}`.toLowerCase();
		return an.localeCompare(bn);
	});
	return all;
}

/** @deprecated use fetchBorrowersWithOpenLoans */
export async function fetchActiveBorrowersPaged(supabase, opts = {}) {
	return fetchBorrowersWithOpenLoans(supabase, opts);
}
