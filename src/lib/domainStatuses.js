/** @typedef {{ value: string, label: string }} StatusOption */

/** @type {StatusOption[]} */
export const LOAN_STATUS_FILTER_OPTIONS = [
	{ value: 'active', label: 'Active' },
	{ value: 'paid', label: 'Paid' },
	{ value: 'delinquent', label: 'Delinquent' },
	{ value: 'defaulted', label: 'Defaulted' },
	{ value: 'written_off', label: 'Written off' },
	{ value: 'edit_requested', label: 'Edit requested' },
	{ value: 'delete_requested', label: 'Delete requested' },
];

export function loanStatusLabel(status) {
	if (status == null || status === '') return '—';
	const o = LOAN_STATUS_FILTER_OPTIONS.find((x) => x.value === status);
	if (o) return o.label;
	return String(status).replace(/_/g, ' ');
}
