# Multi-Company ERP — Distribution Business Edition

A self-contained, authenticated, role-aware ERP web app built from scratch for this workspace.
It implements the complete project TODO and, importantly, the **remaining open items**:

1. **Repair / verification** — cheque lifecycle (pending → deposited → cleared/bounced/cancelled,
   cleared-only settlement, due/overdue alerts) and duplicate-safe automatic invoice-number generation.
2. **Common "Distribution Business" operations** — cross-company payroll, logistics, expenses and
   accounts, a separate Distribution Business ledger, report-only expense-allocation plans that must
   total exactly 100%, editable company partner & profit-margin settings, and company-specific
   profitability reports.

## Run it

```bash
cd /home/user/erp
npm install
npm start          # serves on http://0.0.0.0:3000
npm test           # Node built-in test runner (node --test)
```

Demo logins (seeded): `owner/owner123`, `acc/acc123`, `mgr/mgr123`, `staff/staff123`.

## Stack

- **Backend:** Node 20 + Express + `better-sqlite3` (single-file DB at `data/erp.db`, WAL mode,
  foreign keys on). No external services or cron.
- **Frontend:** plain ESM modules + vanilla JS/CSS, responsive, keyboard-first invoice entry.
- **Reports:** hand-built valid **PDF** and **Excel (SpreadsheetML)** exports with a standard report
  metadata header (title, type, company, date range, report number, reference, generation time).

## Source layout

| File | Purpose |
|------|---------|
| `src/db.js` | Schema (DDL), hashing, seed data |
| `src/auth.js` | Sessions, granular per-action permissions, role defaults, `may()` |
| `src/routes.js` | Protected ERP API procedures, cheque lifecycle, invoice logic, common ops |
| `src/logic.js` | Pure business rules (cheque transitions, settlement, allocation 100%, profitability) |
| `src/reports.js` | PDF + Excel export builders with metadata header |
| `server.js` | App factory + report/invoice export endpoints |
| `public/modules/*.js` | UI modules (dashboard, invoices, cheques, recovery, customers, inventory, common, reports, people) |
| `test/*.test.js` | Vitest-style unit + integration coverage (Node `node --test`) |

## Key business rules covered by tests

- Cheque lifecycle state machine & rejected transitions; only **cleared** cheques reduce outstanding.
- Bounced/cancelled cheques preserve outstanding and audit history.
- Payment reversal recalculates settlement status.
- Duplicate-safe invoice numbers + duplicate correction guidance.
- Granular company/action permission enforcement and owner override.
- Expense-allocation plans rejected unless they total exactly 100%.
- Company profitability = sales × margin% − allocated share of common Distribution cost.
- PDF/Excel/report metadata construction.

## The two open groups — how they're implemented

### Cheque & invoice repair
- `/api/cheques/:id/status` enforces `pending→deposited→cleared/bounced` and updates the invoice's
  outstanding only on `cleared`; `recalcSettlement()` runs on reversal/cancellation of cleared cheques.
- `/api/next-invoice-number` scans the company's highest number and finds a gap-free, unused number.
  `/api/fix-invoice-number` rejects duplicates and returns actionable guidance.
- The dashboard surfaces due/overdue cheques (no in-process scheduling needed).

### Common Distribution Business
- `expenses`, `payroll`, `logistics`, `assets`, `accounts`, `employees` are **common** (cross-company),
  each posting to the separate `dist_ledger`.
- `allocation_plans` + `allocation_plan_items` are report-only, owner-managed, and validated to sum to
  exactly 100%.
- Company `partner_name` and `profit_margin_pct` are editable with audited change history.
- `/api/profitability` computes per-company sales, margin value, allocated common cost, and final
  profit/loss, plus booker sales & recovery.
