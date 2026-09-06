/** Fast Loans list queries: open loans only; paid loaded on identity search. */

export const LOAN_OPEN_STATUSES = [
	'active',
	'delinquent',
	'defaulted',
	'delete_requested',
	'edit_requested',
];

/** List columns — omit schedule (large JSON) until view-schedule. */
export const LOAN_LIST_BORROWER_EMBED =
	'borrowers ( id, first_name, surname, group_id, center_id, borrower_id, phone_number, borrower_type )';

export const LOAN_LIST_SELECT = `
  id, loan_id, borrower_id, product_id, officer_id, principal, interest_rate,
  total_payable, balance, outstanding_interest, repayment_frequency, period, period_unit,
  disbursement_date, repayment_start_date, status, created_at,
  ${LOAN_LIST_BORROWER_EMBED}
`;

export const LOAN_LIST_SELECT_WITH_OFFICER = `
  id, loan_id, borrower_id, product_id, officer_id, principal, interest_rate,
  total_payable, balance, outstanding_interest, repayment_frequency, period, period_unit,
  disbursement_date, repayment_start_date, status, created_at,
  ${LOAN_LIST_BORROWER_EMBED},
  officer:users!officer_id ( id, full_name, branch_id )
`;

function sanitizeSearchToken(raw) {
	return String(raw || '')
		.trim()
		.replace(/[%_,.()]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Paid loans matching borrower name or loan ID (for search-only reveal).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function fetchPaidLoansByNameOrLoanId(
	supabase,
	{ searchQuery, select = LOAN_LIST_SELECT, officerId = null, officerIds = null, branchId = null },
) {
	const q = sanitizeSearchToken(searchQuery);
	if (q.length < 2) return [];

	const pattern = `%${q}%`;
	const scopeLoan = (query) => {
		let qq = query.eq('status', 'paid');
		if (officerId) qq = qq.eq('officer_id', officerId);
		else if (officerIds?.length) qq = qq.in('officer_id', officerIds);
		return qq;
	};

	let byLoanIdQ = scopeLoan(supabase.from('loans').select(select).ilike('loan_id', pattern)).limit(40);

	let firstNameQ = supabase.from('borrowers').select('id').ilike('first_name', pattern).limit(40);
	let surnameQ = supabase.from('borrowers').select('id').ilike('surname', pattern).limit(40);
	if (officerId) {
		firstNameQ = firstNameQ.eq('loan_officer_id', officerId);
		surnameQ = surnameQ.eq('loan_officer_id', officerId);
	} else if (officerIds?.length) {
		firstNameQ = firstNameQ.in('loan_officer_id', officerIds);
		surnameQ = surnameQ.in('loan_officer_id', officerIds);
	}
	if (branchId) {
		firstNameQ = firstNameQ.eq('branch_id', branchId);
		surnameQ = surnameQ.eq('branch_id', branchId);
	}

	const [{ data: byLoanId, error: e1 }, { data: byFirst, error: e2 }, { data: bySur, error: e3 }] =
		await Promise.all([byLoanIdQ, firstNameQ, surnameQ]);
	if (e1) throw e1;
	if (e2) throw e2;
	if (e3) throw e3;

	const borrowerIds = [
		...new Set([...(byFirst || []), ...(bySur || [])].map((b) => b.id).filter(Boolean)),
	];
	let byName = [];
	if (borrowerIds.length > 0) {
		const { data, error } = await scopeLoan(
			supabase.from('loans').select(select).in('borrower_id', borrowerIds),
		).limit(40);
		if (error) throw error;
		byName = data || [];
	}

	const map = new Map();
	for (const row of [...(byLoanId || []), ...byName]) {
		if (row?.id) map.set(row.id, row);
	}
	return [...map.values()];
}
