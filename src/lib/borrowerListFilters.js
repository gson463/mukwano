/** Shared list rules for Borrowers pages (officer / admin). */

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

/**
 * Only active_loan borrowers appear by default.
 * Other statuses (eligible, paid_up, defaulted, …) require search by name or borrower ID.
 */
export function shouldIncludeBorrowerByStatusAndSearch(borrower, { searchQuery, statusFilter }) {
	const status = borrower?.status;
	const identityHit = borrowerMatchesIdentitySearch(borrower, searchQuery);
	const isActiveLoan = status === 'active_loan';

	// Non-active (eligible / paid_up / defaulted / …): hide until name or borrower ID search,
	// or until the status dropdown is set to that status (loaded separately).
	if (!isActiveLoan) {
		if (statusFilter === status) return true;
		if (!identityHit) return false;
		if (statusFilter === 'all' || statusFilter === 'active_loan') return true;
		return false;
	}

	if (statusFilter === 'all' || statusFilter === 'active_loan') return true;
	return statusFilter === status;
}

export const BORROWER_ACTIVE_LOAN_STATUS = 'active_loan';

export const BORROWER_LIST_SELECT =
	'*, users (full_name), branches (id, name), groups (id, name, center_id)';

function sanitizeSearchToken(raw) {
	return String(raw || '')
		.trim()
		.replace(/[%_,.()]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Borrowers not on active_loan, matching name or borrower_id (search-only reveal).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function fetchNonActiveBorrowersByNameOrId(
	supabase,
	{ searchQuery, select = BORROWER_LIST_SELECT, officerId = null },
) {
	const q = sanitizeSearchToken(searchQuery);
	if (q.length < 2) return [];

	const pattern = `%${q}%`;
	const scope = (query) => {
		let qq = query.neq('status', 'active_loan');
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

	const map = new Map();
	for (const row of [...(byId || []), ...(byFirst || []), ...(bySur || [])]) {
		if (row?.id) map.set(row.id, row);
	}
	return [...map.values()];
}
