// Pure business rules — unit-testable without a DB.

// Cheque lifecycle state machine. Transition rules:
//   pending  -> deposited | cancelled
//   deposited-> cleared | bounced | cancelled
//   cleared  -> (none; reversal-based cancellation handled by ledger ops)
//   bounced  -> cancelled
//   cancelled-> (none)
export const CHEQUE_TRANSITIONS = {
  pending:   ['deposited', 'cancelled'],
  deposited: ['cleared', 'bounced', 'cancelled'],
  cleared:   [],
  bounced:   ['cancelled'],
  cancelled: [],
};

export function canTransition(current, target) {
  if (target === current) return { ok: false, reason: 'no status change' };
  if (!(current in CHEQUE_TRANSITIONS)) return { ok: false, reason: `unknown status ${current}` };
  if (CHEQUE_TRANSITIONS[current].includes(target)) return { ok: true };
  return { ok: false, reason: `cannot move ${current}->${target}` };
}

// Cheque settles an invoice balance ONLY when cleared.
export function chequeSettles(status) {
  return status === 'cleared';
}

// Whether a cheque is currently due or overdue for alerting.
// A cheque counts as "open" (not yet fully settled) while pending or deposited.
export function chequeDueAlert(cheque, today) {
  const open = ['pending', 'deposited'].includes(cheque.status);
  if (!open) return { open: false, due: false, overdue: false };
  if (!cheque.due_date) return { open: true, due: false, overdue: false };
  const due = cheque.due_date <= today;
  const overdue = cheque.due_date < today;
  return { open: true, due, overdue };
}

// Invoice outstanding: net_total - posted payments - recoveries - cleared cheques.
export function invoiceOutstanding(netTotal, paid, recovered, clearedCheques) {
  return Math.max(0, netTotal - paid - recovered - clearedCheques);
}

// Settlement status from remaining posted payments.
export function settlementStatus(outstanding) {
  return outstanding <= 0.001 ? 'settled' : 'outstanding';
}

// Invoice discount: default from customer's approved discount; compute safely.
export function computeInvoiceDiscount(subtotal, discountPct) {
  const pct = Math.max(0, Number(discountPct) || 0);
  return round2(subtotal * pct / 100);
}

export function computeNetTotal(subtotal, discountAmount, deliveryCharge) {
  return round2(subtotal - Number(discountAmount || 0) + Number(deliveryCharge || 0));
}

export function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// Allocation plan must sum to exactly 100%.
export function allocationTotalValid(items) {
  const total = (items || []).reduce((s, i) => s + Number(i.percentage || 0), 0);
  return Math.abs(total - 100) < 0.0001;
}

// Company profitability: sales * margin% - allocated share of common dist cost.
export function companyProfitability({ sales, profitMarginPct, distCost, allocPct }) {
  const marginValue = round2(sales * (Number(profitMarginPct) || 0) / 100);
  const allocValue = round2(Number(distCost || 0) * (Number(allocPct) || 0) / 100);
  return { margin_value: marginValue, alloc_value: allocValue, profit_loss: round2(marginValue - allocValue) };
}
