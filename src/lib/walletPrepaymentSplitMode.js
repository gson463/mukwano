/**
 * System config key: walletPrepaymentSplitMode (system_config)
 *
 * - arrears_only (default): only unpaid installments with dueDate STRICTLY BEFORE payment date
 *   count as "scheduled". Same-day due → prepayment bucket.
 * - standard: unpaid installments due on or before payment date count as scheduled (includes today).
 */

export const WALLET_PREPAYMENT_STANDARD = 'standard';
export const WALLET_PREPAYMENT_ARREARS_ONLY = 'arrears_only';

export function scheduledDueRpcName(mode) {
	return mode === WALLET_PREPAYMENT_ARREARS_ONLY
		? 'scheduled_due_strictly_before_payment_date'
		: 'scheduled_due_for_payment_date';
}

export function normalizeWalletPrepaymentSplitMode(value) {
	const v = String(value ?? '').trim();
	if (v === '') return WALLET_PREPAYMENT_ARREARS_ONLY;
	return v === WALLET_PREPAYMENT_ARREARS_ONLY ? WALLET_PREPAYMENT_ARREARS_ONLY : WALLET_PREPAYMENT_STANDARD;
}
