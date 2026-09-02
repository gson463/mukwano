/**
 * Repayment amounts must be whole multiples of one installment line amount.
 * Used by Group Repayment, Record Repayment dialog, and record-repayment Edge Function.
 */

export const REPAYMENT_AMOUNT_INVALID_FALLBACK =
	'This amount is not valid. Enter a multiple of the installment amount (minimum one full installment).';

export function getInstallmentUnitFromSchedule(schedule) {
	if (!Array.isArray(schedule) || schedule.length === 0) {
		return null;
	}
	let min = Infinity;
	for (const inst of schedule) {
		const a = Number(inst?.amount);
		if (Number.isFinite(a) && a > 0.01) {
			min = Math.min(min, a);
		}
	}
	return min === Infinity ? null : min;
}

export function smallestMultipleOfUnitAtLeast(due, unit) {
	if (!Number.isFinite(unit) || unit <= 0) {
		return null;
	}
	const d = Math.max(0, Number(due));
	const n = Math.ceil(d / unit - 1e-9);
	return Math.max(n, 1) * unit;
}

export function isValidRepaymentAmount(amount, _due, unit) {
	if (!Number.isFinite(amount) || amount <= 0) {
		return false;
	}
	if (unit == null || !Number.isFinite(unit) || unit <= 0) {
		return false;
	}
	if (amount + 1e-6 < unit) {
		return false;
	}
	const k = amount / unit;
	return Math.abs(k - Math.round(k)) < 1e-5;
}

export function roundToValidRepaymentAmount(amount, _due, unit) {
	if (!Number.isFinite(amount) || unit == null || !Number.isFinite(unit) || unit <= 0) {
		return amount;
	}
	if (amount + 1e-8 < unit) {
		return unit;
	}
	const k = Math.ceil(amount / unit - 1e-9);
	return k * unit;
}

export function repaymentAmountValidationMessage(amount, _due, unit, currencyLabel = '') {
	if (unit == null || !Number.isFinite(unit) || unit <= 0) {
		return 'Loan schedule does not show an installment amount (contact an administrator).';
	}
	const prefix = currencyLabel ? `${currencyLabel} ` : '';
	if (amount + 1e-6 < unit) {
		return `Minimum is ${prefix}${unit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (one installment).`;
	}
	const k = amount / unit;
	if (Math.abs(k - Math.round(k)) >= 1e-5) {
		return `Enter a multiple of ${prefix}${unit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (e.g. ${prefix}${unit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, ${prefix}${(unit * 2).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, …).`;
	}
	return '';
}
