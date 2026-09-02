/** Scheduled (arrears + due) portion vs prepayment for reports / repayment lists. */

const EPS = 0.05;

export function prepaymentAmount(repayment) {
	if (!repayment) return 0;
	const amt = Number(repayment.amount ?? 0);
	const src = String(repayment.wallet_split_source ?? '').toLowerCase();
	if (src === 'explicit') {
		const pa = Number(repayment.prepayment_amount ?? 0);
		if (Number.isFinite(pa) && pa >= 0) return Math.min(Math.max(0, pa), amt);
	}
	const rawSnap = repayment.scheduled_due_snapshot;
	const snapNum =
		rawSnap != null && rawSnap !== '' && Number.isFinite(Number(rawSnap)) ? Number(rawSnap) : null;
	const pa = Number(repayment.prepayment_amount ?? 0);

	if (snapNum != null) {
		const fromSnap = Math.max(0, amt - snapNum);
		if (Number.isFinite(pa) && pa >= 0 && Math.abs(pa - fromSnap) < EPS) {
			return Math.min(Math.max(0, pa), amt);
		}
		if (Number.isFinite(pa) && pa >= 0 && pa > fromSnap + EPS) {
			return Math.min(pa, amt);
		}
		return fromSnap;
	}
	return Math.max(0, Math.min(Number.isFinite(pa) ? pa : 0, amt));
}

export function scheduledRepaymentAmount(repayment) {
	const amt = Number(repayment?.amount ?? 0);
	return Math.max(0, amt - prepaymentAmount(repayment));
}
