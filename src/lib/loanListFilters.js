/** Shared list rules for Loans pages (officer / manager / admin). */

export function loanMatchesIdentitySearch(loan, searchQuery) {
	const q = String(searchQuery || '').trim().toLowerCase();
	if (!q) return false;
	const b = loan?.borrowers;
	const borrowerName = `${b?.first_name || ''} ${b?.surname || ''}`.toLowerCase();
	const loanId = String(loan?.loan_id || '').toLowerCase();
	return loanId.includes(q) || borrowerName.includes(q);
}

export function loanMatchesGeneralSearch(loan, searchQuery) {
	const q = String(searchQuery || '').trim().toLowerCase();
	if (!q) return true;
	const b = loan?.borrowers;
	const borrowerName = `${b?.first_name || ''} ${b?.surname || ''}`.toLowerCase();
	const qPhone = b?.phone_number && String(b.phone_number).toLowerCase().includes(q);
	const qBorrowerId = b?.borrower_id && String(b.borrower_id).toLowerCase().includes(q);
	return (
		String(loan?.loan_id || '')
			.toLowerCase()
			.includes(q) ||
		borrowerName.includes(q) ||
		String(loan?.principal ?? '').includes(q) ||
		Boolean(qPhone) ||
		Boolean(qBorrowerId)
	);
}

/**
 * Paid loans stay hidden until the user searches by borrower name or loan ID.
 * Open loans follow the status filter as usual.
 */
export function shouldIncludeLoanByStatusAndSearch(loan, { searchQuery, statusFilter }) {
	const isPaid = loan?.status === 'paid';
	const identityHit = loanMatchesIdentitySearch(loan, searchQuery);

	if (isPaid) {
		return identityHit;
	}

	if (!loanMatchesGeneralSearch(loan, searchQuery)) return false;

	if (statusFilter === 'all') return true;
	if (statusFilter === 'paid') return false;
	return loan.status === statusFilter;
}
