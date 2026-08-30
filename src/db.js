import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Data dir can be overridden by env (persistent disk on hosting platforms like Render/Railway).
const DATA_DIR = process.env.DATA_DIR || process.env.PERSIST_DIR || path.join(__dirname, '..', 'data');
import fs from 'node:fs';
fs.mkdirSync(DATA_DIR, { recursive: true });

export const DB_PATH = path.join(DATA_DIR, 'erp.db');

export function openDb(dbPath = DB_PATH) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  seed(db);
  return db;
}

function migrate(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    phone TEXT, email TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT UNIQUE,
    address TEXT, phone TEXT, email TEXT,
    logo BLOB,
    partner_name TEXT,
    profit_margin_pct REAL NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    archived_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS company_memberships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'staff',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    company_id INTEGER NOT NULL REFERENCES companies(id),
    action TEXT NOT NULL,
    allowed INTEGER NOT NULL DEFAULT 1,
    UNIQUE(user_id, company_id, action)
  );

  CREATE TABLE IF NOT EXISTS authority_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    company_id INTEGER NOT NULL REFERENCES companies(id),
    requested_action TEXT NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    decided_by INTEGER REFERENCES users(id),
    decided_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    company_id INTEGER,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id INTEGER,
    detail TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bookers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    name TEXT NOT NULL,
    phone TEXT, address TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT, phone TEXT,
    category TEXT, source TEXT, customer_group TEXT,
    discount_pct REAL NOT NULL DEFAULT 0,
    booker_id INTEGER REFERENCES bookers(id),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS customer_companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    company_id INTEGER NOT NULL REFERENCES companies(id),
    UNIQUE(customer_id, company_id)
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    name TEXT NOT NULL,
    sku TEXT NOT NULL,
    unit TEXT,
    purchase_rate REAL NOT NULL DEFAULT 0,
    salon_rate REAL NOT NULL DEFAULT 0,
    retail_rate REAL NOT NULL DEFAULT 0,
    online_rate REAL NOT NULL DEFAULT 0,
    stock REAL NOT NULL DEFAULT 0,
    damaged_stock REAL NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS inventory_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    company_id INTEGER,
    qty REAL NOT NULL,
    type TEXT NOT NULL,
    ref TEXT,
    note TEXT,
    user_id INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- cash / bank / mobile
    is_active INTEGER NOT NULL DEFAULT 1,
    is_common INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sales_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    invoice_no TEXT NOT NULL,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    booker_id INTEGER REFERENCES bookers(id),
    invoice_date TEXT NOT NULL,
    subtotal REAL NOT NULL DEFAULT 0,
    discount_pct REAL NOT NULL DEFAULT 0,
    discount_amount REAL NOT NULL DEFAULT 0,
    delivery_charge REAL NOT NULL DEFAULT 0,
    net_total REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'posted', -- draft/posted/void
    is_old_bill INTEGER NOT NULL DEFAULT 0,
    opening_balance_note TEXT,
    payment_account_id_1 INTEGER REFERENCES accounts(id),
    payment_account_id_2 INTEGER REFERENCES accounts(id),
    notes TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    audit_reason TEXT
  );

  CREATE TABLE IF NOT EXISTS invoice_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES sales_invoices(id),
    product_id INTEGER REFERENCES products(id),
    description TEXT,
    qty REAL NOT NULL DEFAULT 0,
    rate REAL NOT NULL DEFAULT 0,
    amount REAL NOT NULL DEFAULT 0,
    item_type TEXT NOT NULL DEFAULT 'SALE' -- SALE / FOC / DEMO
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    invoice_id INTEGER REFERENCES sales_invoices(id),
    account_id INTEGER REFERENCES accounts(id),
    amount REAL NOT NULL,
    paid_at TEXT NOT NULL,
    method TEXT,
    reversed_at TEXT,
    reversed_by INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ledger_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    type TEXT NOT NULL, -- in/out
    amount REAL NOT NULL,
    ref TEXT,
    ref_type TEXT,
    user_id INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recovery (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    invoice_id INTEGER REFERENCES sales_invoices(id),
    customer_id INTEGER,
    booker_id INTEGER,
    amount REAL NOT NULL,
    recovered_at TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cheques (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    invoice_id INTEGER REFERENCES sales_invoices(id),
    customer_id INTEGER,
    booker_id INTEGER,
    cheque_number TEXT,
    bank TEXT,
    amount REAL NOT NULL DEFAULT 0,
    issue_date TEXT,
    due_date TEXT,
    deposit_date TEXT,
    clearance_date TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- pending/deposited/cleared/bounced/cancelled
    created_at TEXT NOT NULL,
    updated_at TEXT,
    audit_reason TEXT
  );

  -- Common Operations (Distribution Business): cross-company by default
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT, phone TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payroll (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    period TEXT NOT NULL,
    allowances REAL NOT NULL DEFAULT 0,
    deductions REAL NOT NULL DEFAULT 0,
    advance REAL NOT NULL DEFAULT 0,
    rider_bike_info TEXT,
    fuel_allowance REAL NOT NULL DEFAULT 0,
    maintenance_cost REAL NOT NULL DEFAULT 0,
    net REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS logistics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    transportation TEXT,
    fuel_consumption REAL NOT NULL DEFAULT 0,
    mileage REAL NOT NULL DEFAULT 0,
    description TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT,
    purchase_value REAL NOT NULL DEFAULT 0,
    purchase_date TEXT,
    is_common INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT,
    head_id INTEGER REFERENCES expense_heads(id),
    account_id INTEGER REFERENCES accounts(id),
    description TEXT,
    amount REAL NOT NULL DEFAULT 0,
    expense_date TEXT NOT NULL,
    reference TEXT,
    is_common INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  -- Heads of account for expenses (Rent, Fuel, Salaries, etc.)
  CREATE TABLE IF NOT EXISTS expense_heads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  -- Per-company % sharing of a single expense (must total 100%)
  CREATE TABLE IF NOT EXISTS expense_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_id INTEGER NOT NULL REFERENCES expenses(id),
    company_id INTEGER NOT NULL REFERENCES companies(id),
    percentage REAL NOT NULL DEFAULT 0,
    UNIQUE(expense_id, company_id)
  );

  -- Purchase invoice line items (drive stock up)
  CREATE TABLE IF NOT EXISTS purchase_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL REFERENCES supplier_purchases(id),
    product_id INTEGER REFERENCES products(id),
    description TEXT,
    qty REAL NOT NULL DEFAULT 0,
    rate REAL NOT NULL DEFAULT 0,
    amount REAL NOT NULL DEFAULT 0
  );

  -- Expense allocation plans (report-only): exact 100% across companies
  CREATE TABLE IF NOT EXISTS allocation_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_by INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS allocation_plan_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL REFERENCES allocation_plans(id),
    company_id INTEGER NOT NULL REFERENCES companies(id),
    percentage REAL NOT NULL,
    UNIQUE(plan_id, company_id)
  );

  -- Distribution Business ledger: common, separate from company ledgers
  CREATE TABLE IF NOT EXISTS dist_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER,
    kind TEXT NOT NULL, -- expense/payroll/logistics/asset/transfer
    ref_id INTEGER,
    type TEXT NOT NULL, -- in/out
    amount REAL NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS supplier_purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    invoice_date TEXT,
    supplier TEXT,
    reference TEXT,
    amount REAL NOT NULL DEFAULT 0,
    paid_amount REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS supplier_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL REFERENCES supplier_purchases(id),
    amount REAL NOT NULL,
    paid_at TEXT NOT NULL,
    reference TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sale_returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    invoice_id INTEGER REFERENCES sales_invoices(id),
    customer_id INTEGER REFERENCES customers(id),
    return_date TEXT,
    reference TEXT,
    net_amount REAL NOT NULL DEFAULT 0,
    note TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sale_return_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    return_id INTEGER NOT NULL REFERENCES sale_returns(id),
    invoice_line_id INTEGER REFERENCES invoice_lines(id),
    product_id INTEGER REFERENCES products(id),
    description TEXT,
    qty REAL NOT NULL DEFAULT 0,
    rate REAL NOT NULL DEFAULT 0,
    amount REAL NOT NULL DEFAULT 0,
    item_type TEXT
  );

  CREATE TABLE IF NOT EXISTS import_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    row INTEGER,
    status TEXT NOT NULL,
    reason TEXT,
    ref_id INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    created_by INTEGER,
    created_at TEXT NOT NULL,
    note TEXT
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  `);

  // ---- migrations for existing databases ----
  try {
    const expCols = db.prepare(`PRAGMA table_info(expenses)`).all().map(c => c.name);
    if (!expCols.includes('head_id')) db.exec(`ALTER TABLE expenses ADD COLUMN head_id INTEGER`);
    if (!expCols.includes('account_id')) db.exec(`ALTER TABLE expenses ADD COLUMN account_id INTEGER`);
  } catch (e) { /* ignore */ }
}

// ---------- helpers ----------
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.createHash('sha256').update(salt + pw).digest('hex');
  return `${salt}$${h}`;
}
export function verifyPassword(hash, pw) {
  if (!hash || !hash.includes('$')) return false;
  const [salt, expected] = hash.split('$');
  const h = crypto.createHash('sha256').update(salt + pw).digest('hex');
  return h === expected;
}
const now = () => new Date().toISOString();

function seed(db) {
  const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (count > 0) return;
  const t = now();
  const ins = db.prepare(`INSERT INTO users (username, password_hash, full_name, role, phone, created_at) VALUES (?,?,?,?,?,?)`);
  // owner / admin / accountant / manager / staff
  ins.run('owner', hashPassword('owner123'), 'Owner Admin', 'owner', '+92 300 1111111', t);
  ins.run('acc', hashPassword('acc123'), 'Accountant User', 'accountant', '+92 300 2222222', t);
  ins.run('mgr', hashPassword('mgr123'), 'Manager User', 'manager', '+92 300 3333333', t);
  ins.run('staff', hashPassword('staff123'), 'Staff User', 'staff', '+92 300 4444444', t);

  const insCo = db.prepare(`INSERT INTO companies (name, code, address, phone, email, partner_name, profit_margin_pct, is_active, created_at) VALUES (?,?,?,?,?,?,?,1,?)`);
  const c1 = insCo.run('Erbil Distributors', 'ERB-D1', '40 Meter Road, Erbil', '+964 750 0000000', 'erbil@erp.test', 'Karim & Sons', 12.5, t).lastInsertRowid;
  const c2 = insCo.run('Duhok Retail', 'DUH-R1', 'Main Bazaar, Duhok', '+964 750 1111111', 'duhok@erp.test', 'Nadia Trading', 9.0, t).lastInsertRowid;

  const insM = db.prepare(`INSERT INTO company_memberships (company_id, user_id, role, created_at) VALUES (?,?,?,?)`);
  const userIds = { owner: 1, acc: 2, mgr: 3, staff: 4 };
  for (const [uname, uid] of Object.entries(userIds)) {
    insM.run(c1, uid, uname === 'owner' ? 'owner' : uname === 'staff' ? 'staff' : uname, t);
    insM.run(c2, uid, uname === 'owner' ? 'owner' : uname === 'staff' ? 'staff' : uname, t);
  }

  const insBooker = db.prepare(`INSERT INTO bookers (company_id, name, phone, address, is_active, created_at) VALUES (?,?,?,?,1,?)`);
  const b1 = insBooker.run(c1, 'Ahmad Salih', '+964 750 1110000', 'Ankawa, Erbil', t).lastInsertRowid;
  const b2 = insBooker.run(c1, 'Sara Jalal', '+964 750 1110001', 'Shaqlawa, Erbil', t).lastInsertRowid;
  insBooker.run(c2, 'Dana Rauf', '+964 750 2220000', 'Zakho, Duhok', t);

  const insCust = db.prepare(`INSERT INTO customers (name, address, phone, category, source, customer_group, discount_pct, booker_id, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,1,?)`);
  const cu1 = insCust.run('Zara Beauty Salon', 'Ankawa, Erbil', '+964 750 1234567', 'Salon', 'Walk-in', '', 5, b1, t).lastInsertRowid;
  const cu2 = insCust.run('Nawroz General Store', 'Bazaar, Erbil', '+964 750 7654321', 'Retail', 'Reference', '', 0, b2, t).lastInsertRowid;
  insCust.run('Gulan Hair Studio', 'Shorsh, Erbil', '+964 750 5556666', 'Salon', 'Walk-in', '', 10, b1, t);

  const insCC = db.prepare(`INSERT INTO customer_companies (customer_id, company_id) VALUES (?,?)`);
  insCC.run(cu1, c1); insCC.run(cu2, c1);

  const insProd = db.prepare(`INSERT INTO products (company_id, name, sku, unit, purchase_rate, salon_rate, retail_rate, online_rate, stock, damaged_stock, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`);
  const p1 = insProd.run(c1, 'Shampoo 300ml', 'ERB-SH-001', 'pcs', 1200, 1800, 1600, 1500, 200, 0, t).lastInsertRowid;
  const p2 = insProd.run(c1, 'Hair Color Black', 'ERB-HC-002', 'tube', 2500, 3500, 3200, 3000, 45, 3, t).lastInsertRowid;
  const p3 = insProd.run(c1, 'Face Cream', 'ERB-FC-003', 'jar', 3000, 4500, 4200, 4000, 8, 0, t).lastInsertRowid;
  insProd.run(c1, 'Nail Polish', 'ERB-NP-004', 'bottle', 800, 1300, 1200, 1100, 150, 2, t);
  insProd.run(c2, 'Body Lotion', 'DUH-BL-001', 'bottle', 1400, 2100, 1900, 1800, 90, 1, t);

  const insAcc = db.prepare(`INSERT INTO accounts (name, type, is_active, is_common, created_at) VALUES (?,?,1,1,?)`);
  const a1 = insAcc.run('Cash - Main', 'cash', t).lastInsertRowid;
  const a2 = insAcc.run('Bank - Erbil', 'bank', t).lastInsertRowid;
  insAcc.run('Easypaisa - Main', 'mobile', t);
  insAcc.run('Bank - Duhok', 'bank', t);

  // expense heads of account
  const insHead = db.prepare(`INSERT INTO expense_heads (name, is_active, created_at) VALUES (?,1,?)`);
  insHead.run('Rent', t); insHead.run('Fuel / Transport', t); insHead.run('Salaries / Payroll', t);
  insHead.run('Utilities', t); insHead.run('Maintenance', t); insHead.run('Marketing', t);
  insHead.run('Office Supplies', t); insHead.run('Other', t);

  const insInv = db.prepare(`INSERT INTO sales_invoices (company_id, invoice_no, customer_id, booker_id, invoice_date, subtotal, discount_pct, discount_amount, delivery_charge, net_total, status, is_old_bill, payment_account_id_1, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`);
  const inv1 = insInv.run(c1, 'INV-0001', cu1, b1, '2026-08-01', 3500, 5, 175, 0, 3325, 'posted', 0, a1, t).lastInsertRowid;
  insInv.run(c1, 'INV-0002', cu2, b2, '2026-08-10', 6400, 0, 0, 500, 6900, 'posted', 0, a2, t);
  const inv3 = insInv.run(c1, 'INV-0003', cu1, b1, '2026-08-20', 9000, 10, 900, 0, 8100, 'posted', 0, a1, t).lastInsertRowid;

  const insLine = db.prepare(`INSERT INTO invoice_lines (invoice_id, product_id, description, qty, rate, amount, item_type) VALUES (?,?,?,?,?,?,?)`);
  insLine.run(inv1, p1, 'Shampoo 300ml', 1, 1800, 1800, 'SALE');
  insLine.run(inv1, p2, 'Hair Color Black', 1, 3500, 3500, 'SALE'); // note total line not matching; keep for demo
  insLine.run(inv3, p3, 'Face Cream', 2, 4500, 9000, 'SALE');

  const insPay = db.prepare(`INSERT INTO payments (company_id, invoice_id, account_id, amount, paid_at, method, created_at) VALUES (?,?,?,?,?,?,?)`);
  insPay.run(c1, inv1, a1, 1500, '2026-08-02', 'cash', t);
  insPay.run(c1, inv1, a2, 1000, '2026-08-05', 'bank', t);

  const insLed = db.prepare(`INSERT INTO ledger_transactions (company_id, account_id, type, amount, ref, ref_type, created_at) VALUES (?,?,?,?,?,?,?)`);
  insLed.run(c1, a1, 'in', 1500, 'INV-0001', 'payment', t);
  insLed.run(c1, a2, 'in', 1000, 'INV-0001', 'payment', t);

  const insRec = db.prepare(`INSERT INTO recovery (company_id, invoice_id, customer_id, booker_id, amount, recovered_at, note, created_at) VALUES (?,?,?,?,?,?,?,?)`);
  insRec.run(c1, inv1, cu1, b1, 500, '2026-08-08', 'partial recovery', t);

  const insCheq = db.prepare(`INSERT INTO cheques (company_id, invoice_id, customer_id, booker_id, cheque_number, bank, amount, issue_date, due_date, deposit_date, clearance_date, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insCheq.run(c1, inv3, cu1, b1, 'CHQ-88231', 'Erbil Bank', 4000, '2026-08-22', '2026-09-05', null, null, 'pending', t);
  insCheq.run(c1, inv1, cu1, b1, 'CHQ-44012', 'Cihan Bank', 825, '2026-08-10', '2026-08-20', '2026-08-12', null, 'deposited', t);

  // common expense + payroll + logistics examples
  const insExp = db.prepare(`INSERT INTO expenses (name, category, description, amount, expense_date, reference, is_common, created_at) VALUES (?,?,?,?,?,?,1,?)`);
  insExp.run('Shop Rent', 'Rent', 'Warehouse rent for Q3', 250000, '2026-08-01', 'RENT-Q3', t);
  insExp.run('Fuel Bulk', 'Fuel', 'Monthly fuel purchase', 150000, '2026-08-15', 'FUEL-08', t);

  const insEmp = db.prepare(`INSERT INTO employees (name, role, phone, is_active, created_at) VALUES (?,?,?,1,?)`);
  const e1 = insEmp.run('Ranj Mohammed', 'Rider', '+964 750 9990000', t).lastInsertRowid;
  const insPayroll = db.prepare(`INSERT INTO payroll (employee_id, period, allowances, deductions, advance, rider_bike_info, fuel_allowance, maintenance_cost, net, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  insPayroll.run(e1, '2026-08', 120000, 0, 5000, 'Honda CD70 - plate 582', 30000, 5000, 120000, t);

  const insLog = db.prepare(`INSERT INTO logistics (date, transportation, fuel_consumption, mileage, description, created_at) VALUES (?,?,?,?,?,?)`);
  insLog.run('2026-08-12', 'Van - VH-204', 30, 420, 'Weekly delivery round', t);

  const insPlan = db.prepare(`INSERT INTO allocation_plans (name, created_by, created_at) VALUES (?,1,?)`);
  const plan = insPlan.run('Q3 2026 Common Allocation', t).lastInsertRowid;
  const insPlanItem = db.prepare(`INSERT INTO allocation_plan_items (plan_id, company_id, percentage) VALUES (?,?,?)`);
  insPlanItem.run(plan, c1, 60); insPlanItem.run(plan, c2, 40);

  db.prepare(`INSERT INTO app_settings (key, value) VALUES ('whatsapp_recipients', ?)`).run('+92 300 1550344');

  // audit
  db.prepare(`INSERT INTO audit_log (user_id, company_id, action, entity, entity_id, detail, created_at) VALUES (1,NULL,'SEED','system',NULL,'Initial seed data',?)`).run(t);
}
