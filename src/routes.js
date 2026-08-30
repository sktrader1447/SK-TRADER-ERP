import express from 'express';
import { authenticate, requirePermission, isOwner, may, resolveCompanies, ACTIONS, ROLE_DEFAULTS } from './auth.js';
import { canTransition, allocationTotalValid } from './logic.js';
import { getTemplate, saveTemplate, getLogo, setLogo, clearLogo } from './template.js';
import { hashPassword, verifyPassword } from './db.js';
import { buildPurchaseTemplate, parsePurchaseUpload } from './purchaseExcel.js';

const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

function audit(db, req, action, entity, entityId, detail, companyId) {
  db.prepare(`INSERT INTO audit_log (user_id, company_id, action, entity, entity_id, detail, created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(req.user?.id ?? null, companyId ?? null, action, entity, entityId ?? null, detail ?? '', now());
}

export function buildRouter(db) {
  const r = express.Router();
  r.use(authenticate);

  // ---------------- auth / session ----------------
  r.get('/me', (req, res) => {
    const members = db.prepare(
      `SELECT cm.company_id, c.name AS company_name, cm.role
         FROM company_memberships cm JOIN companies c ON c.id=cm.company_id
        WHERE cm.user_id=? AND c.is_active=1`).all(req.user.id);
    const perms = db.prepare('SELECT company_id, action, allowed FROM user_permissions WHERE user_id=?').all(req.user.id);
    res.json({ user: req.user, members, perms });
  });

  // ---------------- users (owner only) ----------------
  r.get('/users', (req, res) => {
    if (!isOwner(req.user)) return res.status(403).json({ error: 'Owner only' });
    const users = db.prepare('SELECT id, username, full_name, role, phone, is_active, created_at FROM users ORDER BY id').all();
    const out = users.map(u => {
      const members = db.prepare('SELECT company_id, role FROM company_memberships WHERE user_id=?').all(u.id);
      const perms = db.prepare('SELECT company_id, action, allowed FROM user_permissions WHERE user_id=?').all(u.id);
      return { ...u, members, perms };
    });
    res.json(out);
  });

  // Create a user with full or limited access via checkboxes.
  // body: { username, password, full_name, role, phone, companies: [{company_id, role}],
  //         access_mode: 'full'|'limited',
  //         permissions: [{company_id, action, allowed}] }  (used only when access_mode='limited')
  r.post('/users', (req, res) => {
    if (!isOwner(req.user)) return res.status(403).json({ error: 'Owner only' });
    const { username, password, full_name, role, phone, companies, access_mode, permissions } = req.body;
    if (!username || !password || !full_name) return res.status(400).json({ error: 'username, password, full_name required' });
    if (!['owner','accountant','manager','staff','booker'].includes(role || 'staff')) return res.status(400).json({ error: 'Invalid role' });
    const dup = db.prepare('SELECT id FROM users WHERE username=?').get(username);
    if (dup) return res.status(400).json({ error: `Username "${username}" already exists` });
    const uid = db.prepare(`INSERT INTO users (username, password_hash, full_name, role, phone, is_active, created_at) VALUES (?,?,?,?,?,1,?)`)
      .run(username, hashPassword(password), full_name, role || 'staff', phone || null, now()).lastInsertRowid;
    // memberships
    const memberList = Array.isArray(companies) ? companies : [];
    const insMem = db.prepare('INSERT INTO company_memberships (company_id, user_id, role, created_at) VALUES (?,?,?,?)');
    for (const m of memberList) if (m.company_id) insMem.run(m.company_id, uid, m.role || 'staff', now());
    // permissions
    if (access_mode === 'limited' && Array.isArray(permissions)) {
      const insPerm = db.prepare(`INSERT INTO user_permissions (user_id, company_id, action, allowed) VALUES (?,?,?,?)
        ON CONFLICT(user_id, company_id, action) DO UPDATE SET allowed=excluded.allowed`);
      for (const p of permissions) {
        if (!ACTIONS.includes(p.action)) continue;
        if (!memberList.some(m => Number(m.company_id) === Number(p.company_id))) continue;
        insPerm.run(uid, p.company_id, p.action, p.allowed ? 1 : 0);
      }
    }
    audit(db, req, 'USER_CREATE', 'users', uid, `${username} role=${role} access=${access_mode}`, null);
    res.json({ id: uid });
  });

  // Toggle active/inactive
  r.post('/users/:id/status', (req, res) => {
    if (!isOwner(req.user)) return res.status(403).json({ error: 'Owner only' });
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!u) return res.status(404).json({ error: 'Not found' });
    const active = req.body.active ? 1 : 0;
    db.prepare('UPDATE users SET is_active=? WHERE id=?').run(active, u.id);
    audit(db, req, active ? 'USER_ACTIVATE' : 'USER_INACTIVE', 'users', u.id, u.username, null);
    res.json({ ok: true });
  });

  // Owner sets/resets any user's password
  r.post('/users/:id/password', (req, res) => {
    if (!isOwner(req.user)) return res.status(403).json({ error: 'Owner only' });
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!u) return res.status(404).json({ error: 'Not found' });
    const { password } = req.body;
    if (!password || String(password).length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), u.id);
    audit(db, req, 'USER_PASSWORD_RESET', 'users', u.id, `password reset for ${u.username}`, null);
    res.json({ ok: true });
  });

  // Current user changes own password (owner can change their own too)
  r.post('/me/password', (req, res) => {
    const { current_password, new_password } = req.body;
    if (!new_password || String(new_password).length < 4) return res.status(400).json({ error: 'New password must be at least 4 characters' });
    const me = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!verifyCurrentPassword(db, me, current_password)) return res.status(400).json({ error: 'Current password is incorrect' });
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(new_password), me.id);
    audit(db, req, 'PASSWORD_CHANGE', 'users', me.id, 'own password changed', null);
    res.json({ ok: true });
  });

  // ---------------- companies ----------------
  r.get('/companies', (req, res) => {
    const list = db.prepare('SELECT * FROM companies ORDER BY name').all();
    res.json(list);
  });

  r.post('/companies', requirePermission('add'), (req, res) => {
    const { name, code, address, phone, email, partner_name, profit_margin_pct } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const id = db.prepare(
      `INSERT INTO companies (name, code, address, phone, email, partner_name, profit_margin_pct, is_active, created_at)
       VALUES (?,?,?,?,?,?,?,1,?)`)
      .run(name, code || null, address || null, phone || null, email || null, partner_name || null, Number(profit_margin_pct || 0), now()).lastInsertRowid;
    // owner becomes member
    db.prepare('INSERT INTO company_memberships (company_id, user_id, role, created_at) VALUES (?,?,?,?)').run(id, req.user.id, 'owner', now());
    audit(db, req, 'COMPANY_CREATE', 'company', id, name, id);
    res.json({ id });
  });

  // update partner / profit-margin / details with audit of changed partner/margin
  r.post('/companies/:id', requirePermission('edit'), (req, res) => {
    const c = db.prepare('SELECT * FROM companies WHERE id=?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    const { name, address, phone, email, partner_name, profit_margin_pct } = req.body;
    const margin = Number(profit_margin_pct ?? c.profit_margin_pct);
    if (margin < 0) return res.status(400).json({ error: 'Margin cannot be negative' });
    db.prepare(`UPDATE companies SET name=?, address=?, phone=?, email=?, partner_name=?, profit_margin_pct=? WHERE id=?`)
      .run(name || c.name, address ?? c.address, phone ?? c.phone, email ?? c.email, partner_name ?? c.partner_name, margin, c.id);
    const changes = [];
    if (String(partner_name ?? c.partner_name) !== String(c.partner_name)) changes.push(`partner ${c.partner_name}->${partner_name ?? c.partner_name}`);
    if (Number(profit_margin_pct ?? c.profit_margin_pct) !== c.profit_margin_pct) changes.push(`margin ${c.profit_margin_pct}%->${margin}%`);
    if (changes.length) audit(db, req, 'COMPANY_UPDATE', 'company', c.id, changes.join(', '), c.id);
    res.json({ ok: true });
  });

  // activate / archive (soft)
  r.post('/companies/:id/archive', requirePermission('delete'), (req, res) => {
    const active = req.body.active ? 1 : 0;
    db.prepare('UPDATE companies SET is_active=?, archived_at=? WHERE id=?').run(active, active ? null : now(), req.params.id);
    audit(db, req, active ? 'COMPANY_ACTIVATE' : 'COMPANY_ARCHIVE', 'company', req.params.id, '', Number(req.params.id));
    res.json({ ok: true });
  });

  // memberships + granular permissions
  r.get('/companies/:id/members', (req, res) => {
    const rows = db.prepare(
      `SELECT cm.user_id, u.full_name, u.role AS global_role, cm.role AS company_role
         FROM company_memberships cm JOIN users u ON u.id=cm.user_id WHERE cm.company_id=?`).all(req.params.id);
    res.json(rows);
  });
  r.get('/companies/:id/permissions', (req, res) => {
    const perms = db.prepare('SELECT user_id, action, allowed FROM user_permissions WHERE company_id=?').all(req.params.id);
    res.json(perms);
  });
  r.post('/companies/:id/permissions', (req, res) => {
    if (!isOwner(req.user)) return res.status(403).json({ error: 'Owner only' });
    // owner-managed permission checklist: [{user_id, action, allowed}]
    const rows = req.body.permissions || [];
    const upsert = db.prepare(`INSERT INTO user_permissions (user_id, company_id, action, allowed) VALUES (?,?,?,?)
      ON CONFLICT(user_id, company_id, action) DO UPDATE SET allowed=excluded.allowed`);
    for (const p of rows) {
      if (!ACTIONS.includes(p.action)) continue;
      upsert.run(p.user_id, req.params.id, p.action, p.allowed ? 1 : 0);
    }
    audit(db, req, 'PERMISSIONS_UPDATE', 'company', req.params.id, `${rows.length} rules`, Number(req.params.id));
    res.json({ ok: true });
  });

  // ---------------- authority requests ----------------
  r.get('/authority-requests', (req, res) => {
    res.json(db.prepare(`SELECT ar.*, u.full_name AS user_name, c.name AS company_name FROM authority_requests ar
      JOIN users u ON u.id=ar.user_id JOIN companies c ON c.id=ar.company_id ORDER BY ar.id DESC`).all());
  });
  r.post('/authority-requests', (req, res) => {
    const { company_id, requested_action, reason } = req.body;
    if (!company_id || !requested_action) return res.status(400).json({ error: 'Missing fields' });
    if (!ACTIONS.includes(requested_action)) return res.status(400).json({ error: 'Invalid action' });
    db.prepare(`INSERT INTO authority_requests (user_id, company_id, requested_action, reason, status, created_at) VALUES (?,?,?,?,'pending',?)`)
      .run(req.user.id, company_id, requested_action, reason || '', now());
    audit(db, req, 'AUTHORITY_REQUEST', 'authority_requests', null, `requested ${requested_action}`, company_id);
    res.json({ ok: true });
  });
  r.post('/authority-requests/:id/decide', (req, res) => {
    if (!isOwner(req.user)) return res.status(403).json({ error: 'Owner only' });
    const ar = db.prepare('SELECT * FROM authority_requests WHERE id=?').get(req.params.id);
    if (!ar || ar.status !== 'pending') return res.status(400).json({ error: 'Not pending' });
    const status = req.body.approve ? 'approved' : 'rejected';
    db.prepare(`UPDATE authority_requests SET status=?, decided_by=?, decided_at=? WHERE id=?`).run(status, req.user.id, now(), ar.id);
    if (status === 'approved') {
      db.prepare(`INSERT INTO user_permissions (user_id, company_id, action, allowed) VALUES (?,?,?,1)
        ON CONFLICT(user_id, company_id, action) DO UPDATE SET allowed=1`).run(ar.user_id, ar.company_id, ar.requested_action);
    }
    audit(db, req, 'AUTHORITY_DECIDE', 'authority_requests', ar.id, status, ar.company_id);
    res.json({ ok: true });
  });

  // ---------------- dashboard ----------------
  r.get('/dashboard', (req, res) => {
    const ctx = resolveCompanies(req);
    const ids = ctx.all ? null : ctx.ids;
    const inIds = ids ? ids.map(() => '?').join(',') : null;
    const args = ids || [];
    const where = ids ? ` WHERE company_id IN (${inIds})` : '';

    const inv = db.prepare(`SELECT COALESCE(SUM(net_total),0) total FROM sales_invoices${where} AND status='posted'`).get(...args);
    const recv = db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM recovery${where}`).get(...args);
    const pays = db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM payments${where} AND reversed_at IS NULL`).get(...args);
    const cheq = db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM cheques${where} AND status='cleared'`).get(...args);
    const rets = db.prepare(`SELECT COALESCE(SUM(net_amount),0) t FROM sale_returns${where}`).get(...args);
    const posted = db.prepare(`SELECT COUNT(*) c FROM sales_invoices${where} AND status='posted'`).get(...args);
    const outstanding = (inv.total || 0) - (rets.t || 0) - (recv.t || 0) - (pays.t || 0) - (cheq.t || 0);

    // low stock (< 10)
    const lowStock = db.prepare(`SELECT id, name, sku, stock FROM products ${ids?`WHERE company_id IN (${inIds}) AND `:'WHERE '} stock < 10 AND is_active=1 ORDER BY stock`).all(...args);
    // overdue receivables (invoices with outstanding>0, older than 30 days)
    const overdue = db.prepare(`SELECT si.id, si.invoice_no, si.net_total, si.invoice_date FROM sales_invoices si
      ${ids?`WHERE si.company_id IN (${inIds}) AND `:'WHERE '} si.status='posted' AND si.invoice_date < date('now','-30 day')`).all(...args);
    // due / overdue cheques
    const dueCheques = db.prepare(`SELECT * FROM cheques ${ids?`WHERE company_id IN (${inIds}) AND `:'WHERE '} status IN ('pending','deposited') AND due_date IS NOT NULL ORDER BY due_date`).all(...args);
    // top selling items (SALE qty)
    const topItems = db.prepare(`SELECT p.id, p.name, p.sku, SUM(il.qty) qty, SUM(il.amount) amt FROM invoice_lines il
      JOIN sales_invoices si ON si.id=il.invoice_id JOIN products p ON p.id=il.product_id
      ${ids?`WHERE si.company_id IN (${inIds}) AND `:'WHERE '} si.status='posted' AND il.item_type='SALE'
      GROUP BY p.id ORDER BY qty DESC LIMIT 10`).all(...args);
    // booker sales & recovery leaderboard (returns reduce net sales)
    const bookerSales = db.prepare(`SELECT b.id, b.name, SUM(si.net_total) sales,
      COALESCE((SELECT SUM(sr.net_amount) FROM sale_returns sr JOIN sales_invoices si2 ON si2.id=sr.invoice_id
                WHERE si2.booker_id=b.id AND si2.status='posted' ${ids?`AND si2.company_id IN (${inIds})`:''}),0) ret
      FROM sales_invoices si LEFT JOIN bookers b ON b.id=si.booker_id
      ${ids?`WHERE si.company_id IN (${inIds}) AND `:'WHERE '} si.status='posted' GROUP BY b.id ORDER BY sales DESC LIMIT 5`).all(...args, ...(ids||[]))
      .map(r => ({ ...r, net_sales: Math.max(0, r.sales - r.ret) }));

    const companies = db.prepare('SELECT id, name FROM companies WHERE is_active=1').all();
    const cheqAlerts = dueCheques.filter(c => c.status !== 'cleared').map(c => ({
      ...c, overdue: c.due_date < today(), company_name: db.prepare('SELECT name FROM companies WHERE id=?').get(c.company_id)?.name
    }));
    const companyIds = ids || companies.map(c => c.id);
    const monthly = companyIds.map(cid => {
      const invs = db.prepare(`SELECT invoice_date, net_total FROM sales_invoices WHERE company_id=? AND status='posted'`).all(cid);
      const recs = db.prepare(`SELECT recovered_at, amount FROM recovery WHERE company_id=?`).all(cid);
      const salesByMonth = {}, recvByMonth = {};
      for (const i of invs) { const m = i.invoice_date.slice(0,7); salesByMonth[m] = (salesByMonth[m]||0)+i.net_total; }
      for (const i of recs) { const m = i.recovered_at.slice(0,7); recvByMonth[m] = (recvByMonth[m]||0)+i.amount; }
      return { company_id: cid, salesByMonth, recvByMonth };
    });

    res.json({ totals: { invoice_total: inv.total||0, recovered: recv.t||0, payments: pays.t||0, cleared_cheques: cheq.t||0, outstanding, posted_count: posted.c },
      lowStock, overdue, cheques: cheqAlerts, topItems, bookerSales, monthly, companies });
  });

  // ---------------- customers ----------------
  r.get('/customers', (req, res) => {
    const ctx = resolveCompanies(req);
    const limit = Math.min(parseInt(req.query.limit || 1000, 10), 1000);
    let rows;
    if (ctx.all) {
      rows = db.prepare(`SELECT DISTINCT c.* FROM customers c JOIN customer_companies cc ON cc.customer_id=c.id ORDER BY c.name LIMIT ?`).all(limit);
    } else {
      rows = db.prepare(`SELECT DISTINCT c.* FROM customers c JOIN customer_companies cc ON cc.customer_id=c.id WHERE cc.company_id IN (${ctx.ids.map(()=>'?').join(',')}) ORDER BY c.name LIMIT ?`).all(...ctx.ids, limit);
    }
    const out = rows.map(c => {
      const companies = db.prepare(`SELECT c.id, c.name FROM customer_companies cc JOIN companies c ON c.id=cc.company_id WHERE cc.customer_id=?`).all(c.id);
      const booker = c.booker_id ? db.prepare('SELECT * FROM bookers WHERE id=?').get(c.booker_id) : null;
      return { ...c, companies, booker };
    });
    res.json(out);
  });

  r.get('/customers/:id', (req, res) => {
    const c = db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    const companies = db.prepare('SELECT c.id, c.name FROM customer_companies cc JOIN companies c ON c.id=cc.company_id WHERE cc.customer_id=?').all(c.id);
    let booker = null;
    if (c.booker_id) {
      booker = db.prepare('SELECT * FROM bookers WHERE id=?').get(c.booker_id);
    }
    const invoices = db.prepare(`SELECT * FROM sales_invoices WHERE customer_id=? AND status='posted' ORDER BY invoice_date DESC`).all(c.id);
    let sales = 0, recovered = 0, returns = 0, outstanding = 0;
    const invs = db.prepare(`SELECT id, net_total FROM sales_invoices WHERE customer_id=? AND status='posted'`).all(c.id);
    for (const i of invs) {
      sales += i.net_total;
      const rec = db.prepare('SELECT COALESCE(SUM(amount),0) t FROM recovery WHERE invoice_id=?').get(i.id).t;
      const pay = db.prepare('SELECT COALESCE(SUM(amount),0) t FROM payments WHERE invoice_id=? AND reversed_at IS NULL').get(i.id).t;
      const chq = db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM cheques WHERE invoice_id=? AND status='cleared'`).get(i.id).t;
      const retAmt = db.prepare(`SELECT COALESCE(SUM(net_amount),0) t FROM sale_returns WHERE invoice_id=?`).get(i.id).t;
      returns += retAmt; recovered += rec + pay + chq; outstanding += i.net_total - retAmt - rec - pay - chq;
    }
    res.json({ ...c, companies, booker, invoices, financials: { sales, recovered, returns, outstanding } });
  });

  r.post('/customers', requirePermission('add'), (req, res) => {
    const { name, address, phone, category, discount_pct, booker_id, company_ids } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (booker_id) {
      const bk = db.prepare('SELECT * FROM bookers WHERE id=?').get(booker_id);
      if (!bk) return res.status(400).json({ error: 'Booker not found' });
    }
    const id = db.prepare(`INSERT INTO customers (name, address, phone, category, discount_pct, booker_id, is_active, created_at) VALUES (?,?,?,?,?,?,1,?)`)
      .run(name, address || null, phone || null, category || null, Number(discount_pct||0), booker_id || null, now()).lastInsertRowid;
    const cids = Array.isArray(company_ids) ? company_ids : [];
    const ins = db.prepare('INSERT OR IGNORE INTO customer_companies (customer_id, company_id) VALUES (?,?)');
    for (const cid of cids) ins.run(id, cid);
    audit(db, req, 'CUSTOMER_CREATE', 'customer', id, name, cids[0]);
    res.json({ id });
  });

  r.post('/customers/:id', requirePermission('edit'), (req, res) => {
    const c = db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    const { name, address, phone, category, discount_pct, booker_id, company_ids } = req.body;
    if (booker_id) {
      const bk = db.prepare('SELECT * FROM bookers WHERE id=?').get(booker_id);
      if (!bk) return res.status(400).json({ error: 'Booker not found' });
      // block multi-company booker assignment until per-company reps exist
      if (Array.isArray(company_ids) && company_ids.length > 1 && booker_id) {
        return res.status(400).json({ error: 'Cannot assign a company-specific booker to a multi-company customer' });
      }
    }
    db.prepare(`UPDATE customers SET name=?, address=?, phone=?, category=?, discount_pct=?, booker_id=? WHERE id=?`)
      .run(name || c.name, address ?? c.address, phone ?? c.phone, category ?? c.category, Number(discount_pct ?? c.discount_pct), booker_id ?? c.booker_id, c.id);
    if (Array.isArray(company_ids)) {
      db.prepare('DELETE FROM customer_companies WHERE customer_id=?').run(c.id);
      const ins = db.prepare('INSERT OR IGNORE INTO customer_companies (customer_id, company_id) VALUES (?,?)');
      for (const cid of company_ids) ins.run(c.id, cid);
    }
    audit(db, req, 'CUSTOMER_UPDATE', 'customer', c.id, name || c.name, c.company_id || null);
    res.json({ ok: true });
  });

  // active/inactive soft archive
  r.post('/customers/:id/status', requirePermission('edit'), (req, res) => {
    const active = req.body.active ? 1 : 0;
    db.prepare('UPDATE customers SET is_active=? WHERE id=?').run(active, req.params.id);
    audit(db, req, active ? 'CUSTOMER_ACTIVATE' : 'CUSTOMER_INACTIVE', 'customer', req.params.id, '', null);
    res.json({ ok: true });
  });

  // ---------------- bookers ----------------
  r.get('/bookers', (req, res) => {
    const ctx = resolveCompanies(req);
    if (ctx.all) return res.json(db.prepare('SELECT * FROM bookers ORDER BY name').all());
    res.json(db.prepare(`SELECT * FROM bookers WHERE company_id IN (${ctx.ids.map(()=>'?').join(',')}) ORDER BY name`).all(...ctx.ids));
  });
  r.post('/bookers', requirePermission('add'), (req, res) => {
    const { company_id, name, phone, address } = req.body;
    if (!name || !company_id) return res.status(400).json({ error: 'name and company required' });
    const id = db.prepare(`INSERT INTO bookers (company_id, name, phone, address, is_active, created_at) VALUES (?,?,?,?,1,?)`).run(company_id, name, phone||null, address||null, now()).lastInsertRowid;
    audit(db, req, 'BOOKER_CREATE', 'booker', id, name, company_id);
    res.json({ id });
  });
  r.post('/bookers/:id', requirePermission('edit'), (req, res) => {
    const b = db.prepare('SELECT * FROM bookers WHERE id=?').get(req.params.id);
    if (!b) return res.status(404).json({ error: 'Not found' });
    db.prepare('UPDATE bookers SET name=?, phone=?, address=?, is_active=? WHERE id=?')
      .run(req.body.name || b.name, req.body.phone ?? b.phone, req.body.address ?? b.address, req.body.active === undefined ? b.is_active : (req.body.active?1:0), b.id);
    audit(db, req, 'BOOKER_UPDATE', 'booker', b.id, '', b.company_id);
    res.json({ ok: true });
  });

  // ---------------- products / inventory ----------------
  r.get('/products', (req, res) => {
    const ctx = resolveCompanies(req);
    const limit = Math.min(parseInt(req.query.limit||1000,10), 1000);
    const q = req.query.q || '';
    const letter = req.query.letter || '';
    let rows;
    if (ctx.all) rows = db.prepare('SELECT * FROM products ORDER BY name LIMIT ?').all(limit);
    else rows = db.prepare(`SELECT * FROM products WHERE company_id IN (${ctx.ids.map(()=>'?').join(',')}) ORDER BY name LIMIT ?`).all(...ctx.ids, limit);
    if (q) rows = rows.filter(p => (p.name+' '+p.sku).toLowerCase().includes(q.toLowerCase()));
    if (letter) rows = rows.filter(p => p.name.toLowerCase().startsWith(letter.toLowerCase()));
    res.json(rows);
  });
  r.post('/products', requirePermission('add'), (req, res) => {
    const { company_id, name, sku, unit, purchase_rate, salon_rate, retail_rate, online_rate, stock } = req.body;
    if (!name || !company_id) return res.status(400).json({ error: 'name and company required' });
    const existing = db.prepare('SELECT id FROM products WHERE company_id=? AND sku=?').get(company_id, sku || '');
    if (sku && existing) return res.status(400).json({ error: `SKU already used (product #${existing.id})` });
    const id = db.prepare(`INSERT INTO products (company_id, name, sku, unit, purchase_rate, salon_rate, retail_rate, online_rate, stock, damaged_stock, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,?,0,1,?)`)
      .run(company_id, name, sku || `SKU-${Date.now()}`, unit||null, Number(purchase_rate||0), Number(salon_rate||0), Number(retail_rate||0), Number(online_rate||0), Number(stock||0), now()).lastInsertRowid;
    if (Number(stock||0)) db.prepare(`INSERT INTO inventory_movements (product_id, company_id, qty, type, ref, note, user_id, created_at) VALUES (?,?,?,'opening','OPENING','Opening stock',?,?)`).run(id, company_id, Number(stock), req.user.id, now());
    audit(db, req, 'PRODUCT_CREATE', 'product', id, name, company_id);
    res.json({ id });
  });
  r.post('/products/:id', requirePermission('edit'), (req, res) => {
    const p = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    if (!p.is_active) return res.status(400).json({ error: 'Archived product cannot be edited' });
    const { name, purchase_rate, salon_rate, retail_rate, online_rate, unit } = req.body;
    if (Number(purchase_rate) < 0) return res.status(400).json({ error: 'Purchase rate cannot be negative' });
    db.prepare(`UPDATE products SET name=?, purchase_rate=?, salon_rate=?, retail_rate=?, online_rate=?, unit=? WHERE id=?`)
      .run(name || p.name, Number(purchase_rate ?? p.purchase_rate), Number(salon_rate ?? p.salon_rate), Number(retail_rate ?? p.retail_rate), Number(online_rate ?? p.online_rate), unit ?? p.unit, p.id);
    audit(db, req, 'PRODUCT_UPDATE', 'product', p.id, p.name, p.company_id);
    res.json({ ok: true });
  });
  // delete/archive
  r.post('/products/:id/archive', requirePermission('delete'), (req, res) => {
    const p = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const active = req.body.active === undefined ? 0 : (req.body.active?1:0);
    db.prepare('UPDATE products SET is_active=? WHERE id=?').run(active, p.id);
    audit(db, req, active ? 'PRODUCT_ARCHIVE' : 'PRODUCT_ACTIVATE', 'product', p.id, p.name, p.company_id);
    res.json({ ok: true });
  });
  r.get('/inventory-movements', (req, res) => {
    res.json(db.prepare('SELECT im.*, p.name AS product_name FROM inventory_movements im JOIN products p ON p.id=im.product_id ORDER BY im.id DESC LIMIT 200').all());
  });

  // stock reconciliation
  r.post('/products/:id/reconcile', requirePermission('approve'), (req, res) => {
    const p = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const { good_stock, damaged_stock, reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Adjustment reason required' });
    const dg = Number(damaged_stock ?? p.damaged_stock);
    const gs = Number(good_stock ?? p.stock);
    db.prepare('UPDATE products SET stock=?, damaged_stock=? WHERE id=?').run(gs, dg, p.id);
    db.prepare(`INSERT INTO inventory_movements (product_id, company_id, qty, type, ref, note, user_id, created_at) VALUES (?,?,?,'reconcile',?,?,?,?)`)
      .run(p.id, p.company_id, gs, reason, reason, req.user.id, now());
    audit(db, req, 'STOCK_RECONCILE', 'product', p.id, reason, p.company_id);
    res.json({ ok: true });
  });

  // ---------------- accounts (common) ----------------
  r.get('/accounts', (req, res) => res.json(db.prepare('SELECT * FROM accounts ORDER BY name').all()));
  r.post('/accounts', (req, res) => {
    const { name, type } = req.body;
    if (!name || !['cash','bank','mobile'].includes(type)) return res.status(400).json({ error: 'invalid account' });
    const id = db.prepare(`INSERT INTO accounts (name, type, is_active, is_common, created_at) VALUES (?,?,1,1,?)`).run(name, type, now()).lastInsertRowid;
    audit(db, req, 'ACCOUNT_CREATE', 'account', id, name, null);
    res.json({ id });
  });

  // ---------------- invoice number generation (repair item) ----------------
  r.get('/next-invoice-number', (req, res) => {
    const ctx = resolveCompanies(req);
    const cid = ctx.ids ? ctx.ids[0] : null;
    const inv = invoiceNumber(db, cid);
    res.json({ invoice_no: inv });
  });
  r.post('/fix-invoice-number', requirePermission('edit'), (req, res) => {
    // duplicate-safe correction guidance
    const { invoice_id, company_id, invoice_no } = req.body;
    const inv = db.prepare('SELECT * FROM sales_invoices WHERE id=?').get(invoice_id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    if (inv.status === 'void') return res.status(400).json({ error: 'Voided invoices cannot be renumbered' });
    const clash = db.prepare('SELECT id FROM sales_invoices WHERE company_id=? AND invoice_no=? AND id<>?').get(company_id || inv.company_id, invoice_no, invoice_id);
    if (clash) return res.status(400).json({ error: `Invoice number ${invoice_no} is already used by invoice #${clash.id}. Choose a unique number.` });
    db.prepare('UPDATE sales_invoices SET invoice_no=? WHERE id=?').run(invoice_no, invoice_id);
    audit(db, req, 'INVOICE_RENUMBER', 'sales_invoices', invoice_id, `renumbered to ${invoice_no}`, company_id || inv.company_id);
    res.json({ ok: true, invoice_no });
  });

  // ---------------- invoice creation ----------------
  r.post('/invoices', requirePermission('add'), (req, res) => {
    const { company_id, customer_id, booker_id, invoice_date, lines, discount_pct, delivery_charge, payment_account_id_1, payment_account_id_2, notes, is_old_bill, opening_balance_note, invoice_no } = req.body;
    if (!company_id || !customer_id) return res.status(400).json({ error: 'company and customer required' });
    const cust = db.prepare('SELECT * FROM customers WHERE id=?').get(customer_id);
    if (!cust) return res.status(400).json({ error: 'customer not found' });
    if (!cust.is_active) return res.status(400).json({ error: 'Inactive customer cannot be selected' });
    const cc = db.prepare('SELECT id FROM customer_companies WHERE customer_id=? AND company_id=?').get(customer_id, company_id);
    if (!cc) return res.status(400).json({ error: 'Customer is not authorized for this company' });
    // booker must match customer's active representative
    const rep = cust.booker_id ? db.prepare('SELECT * FROM bookers WHERE id=?').get(cust.booker_id) : null;
    if (booker_id && Number(booker_id) !== Number(cust.booker_id)) {
      return res.status(400).json({ error: `Booker must match customer's assigned representative (${rep ? rep.name : 'none'})` });
    }
    // payment accounts must be distinct if both provided
    if (payment_account_id_1 && payment_account_id_2 && Number(payment_account_id_1) === Number(payment_account_id_2)) {
      return res.status(400).json({ error: 'Payment accounts must be distinct' });
    }

    const isOldBill = is_old_bill ? 1 : 0;
    let net_total = 0, subtotal = 0;
    const lineList = Array.isArray(lines) ? lines : [];
    if (!isOldBill) {
      for (const l of lineList) {
        const amt = (Number(l.qty) || 0) * (Number(l.rate) || 0);
        subtotal += amt;
      }
    } else {
      subtotal = Number(opening_balance_note || 0); // old bill uses net as opening balance
    }
    const discPct = isOldBill ? 0 : Number(discount_pct ?? 0);
    const discAmt = isOldBill ? 0 : subtotal * discPct / 100;
    const delivery = isOldBill ? 0 : Number(delivery_charge || 0);
    net_total = subtotal - discAmt + delivery;

    // invoice number generation (duplicate-safe)
    let invNo = invoice_no || invoiceNumber(db, company_id);
    let guard = 0;
    while (db.prepare('SELECT id FROM sales_invoices WHERE company_id=? AND invoice_no=?').get(company_id, invNo) && guard < 1000) {
      invNo = invoiceNumber(db, company_id); guard++;
    }

    const create = db.prepare(`INSERT INTO sales_invoices (company_id, invoice_no, customer_id, booker_id, invoice_date, subtotal, discount_pct, discount_amount, delivery_charge, net_total, status, is_old_bill, opening_balance_note, payment_account_id_1, payment_account_id_2, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const invId = create.run(company_id, invNo, customer_id, booker_id || cust.booker_id || null, invoice_date || today(), subtotal, discPct, discAmt, delivery, net_total, 'posted', isOldBill, isOldBill ? (opening_balance_note || '') : null, payment_account_id_1 || null, payment_account_id_2 || null, notes || null, req.user.id, now()).lastInsertRowid;

    if (!isOldBill) {
      const insLine = db.prepare(`INSERT INTO invoice_lines (invoice_id, product_id, description, qty, rate, amount, item_type) VALUES (?,?,?,?,?,?,?)`);
      for (const l of lineList) {
        const amt = (Number(l.qty)||0)*(Number(l.rate)||0);
        const p = l.product_id ? db.prepare('SELECT * FROM products WHERE id=?').get(l.product_id) : null;
        if (p && p.company_id !== company_id) continue;
        insLine.run(invId, p?.id || null, l.description || p?.name || null, Number(l.qty)||0, Number(l.rate)||0, amt, l.item_type || 'SALE');
        // SALE items reduce stock
        if (p && (l.item_type || 'SALE') === 'SALE') {
          db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(Number(l.qty)||0, p.id);
          db.prepare(`INSERT INTO inventory_movements (product_id, company_id, qty, type, ref, note, user_id, created_at) VALUES (?,?,?,'sale',?,?,?,?)`)
            .run(p.id, company_id, -(Number(l.qty)||0), invNo, 'Invoice sale', req.user.id, now());
        }
      }
    }
    audit(db, req, isOldBill ? 'OLD_BILL_CREATE' : 'INVOICE_CREATE', 'sales_invoices', invId, invNo, company_id);
    res.json({ id: invId, invoice_no: invNo });
  });

  r.get('/invoices', (req, res) => {
    const ctx = resolveCompanies(req);
    const limit = Math.min(parseInt(req.query.limit||1000,10), 1000);
    const { company_id, date_from, date_to, booker_id, status } = req.query;
    let where = [];
    let args = [];
    if (!ctx.all) { where.push(`si.company_id IN (${ctx.ids.map(()=>'?').join(',')})`); args.push(...ctx.ids); }
    if (company_id) { where.push('si.company_id=?'); args.push(company_id); }
    if (date_from) { where.push('si.invoice_date>=?'); args.push(date_from); }
    if (date_to) { where.push('si.invoice_date<=?'); args.push(date_to); }
    if (booker_id) { where.push('si.booker_id=?'); args.push(booker_id); }
    if (status) { where.push('si.status=?'); args.push(status); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = db.prepare(`SELECT si.*, c.name AS customer_name, b.name AS booker_name, cc.name AS company_name,
      (SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.invoice_id=si.id AND p.reversed_at IS NULL) AS paid,
      (SELECT COALESCE(SUM(amount),0) FROM recovery rr WHERE rr.invoice_id=si.id) AS recovered,
      (SELECT COALESCE(SUM(amount),0) FROM cheques ch WHERE ch.invoice_id=si.id AND ch.status='cleared') AS cleared_cheques,
      (SELECT COALESCE(SUM(net_amount),0) FROM sale_returns sr WHERE sr.invoice_id=si.id) AS returned
      FROM sales_invoices si JOIN customers c ON c.id=si.customer_id LEFT JOIN bookers b ON b.id=si.booker_id JOIN companies cc ON cc.id=si.company_id
      ${w} ORDER BY si.invoice_date DESC, si.id DESC LIMIT ?`).all(...args, limit);
    const out = rows.map(x => {
      const lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=?').all(x.id);
      return { ...x, lines, outstanding: Math.max(0, x.net_total - x.returned - x.paid - x.recovered - x.cleared_cheques) };
    });
    res.json(out);
  });

  r.get('/invoices/:id', (req, res) => {
    const inv = db.prepare(`SELECT si.*, c.name AS customer_name, c.address AS customer_address, c.phone AS customer_phone, c.category AS customer_category,
      b.name AS booker_name, cc.name AS company_name, a1.name AS account_1, a2.name AS account_2
      FROM sales_invoices si JOIN customers c ON c.id=si.customer_id LEFT JOIN bookers b ON b.id=si.booker_id
      JOIN companies cc ON cc.id=si.company_id LEFT JOIN accounts a1 ON a1.id=si.payment_account_id_1 LEFT JOIN accounts a2 ON a2.id=si.payment_account_id_2
      WHERE si.id=?`).get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    const lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=?').all(inv.id);
    const payments = db.prepare('SELECT * FROM payments WHERE invoice_id=? ORDER BY id').all(inv.id);
    const recovery = db.prepare('SELECT * FROM recovery WHERE invoice_id=? ORDER BY id').all(inv.id);
    const cheques = db.prepare('SELECT * FROM cheques WHERE invoice_id=? ORDER BY id').all(inv.id);
    const returns = db.prepare('SELECT * FROM sale_returns WHERE invoice_id=? ORDER BY id').all(inv.id);
    const paid = payments.filter(p=>!p.reversed_at).reduce((s,p)=>s+p.amount,0);
    const rec = recovery.reduce((s,p)=>s+p.amount,0);
    const chq = cheques.filter(c=>c.status==='cleared').reduce((s,c)=>s+c.amount,0);
    const retAmt = returns.reduce((s,r)=>s+r.net_amount,0);
    res.json({ ...inv, lines, payments, recovery, cheques, returns, outstanding: Math.max(0, inv.net_total - retAmt - paid - rec - chq) });
  });

  // historical invoice (old bill) correction / void
  r.post('/invoices/:id/edit', requirePermission('edit'), (req, res) => {
    const inv = db.prepare('SELECT * FROM sales_invoices WHERE id=?').get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (inv.status !== 'posted') return res.status(400).json({ error: 'Only posted invoices can be edited' });
    const outstanding = invoiceOutstanding(db, inv);
    if (outstanding <= 0 && !inv.is_old_bill) return res.status(400).json({ error: 'Settled invoices cannot be edited' });
    if (inv.is_old_bill) return res.status(400).json({ error: 'Opening-balance invoices cannot be line-edited; use void only' });
    if (!req.body.audit_reason) return res.status(400).json({ error: 'An audit reason is required' });
    const { lines, discount_pct, delivery_charge, customer_id } = req.body;
    if (customer_id) {
      const cc = db.prepare('SELECT id FROM customer_companies WHERE customer_id=? AND company_id=?').get(customer_id, inv.company_id);
      if (!cc) return res.status(400).json({ error: 'Customer not authorized for this company' });
    }
    // reverse old stock, apply new
    const oldLines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=?').all(inv.id);
    for (const l of oldLines) {
      const p = db.prepare('SELECT * FROM products WHERE id=?').get(l.product_id);
      if (p && l.item_type === 'SALE') {
        db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(l.qty, p.id);
        db.prepare(`INSERT INTO inventory_movements (product_id, company_id, qty, type, ref, note, user_id, created_at) VALUES (?,?,?,'correction',?,?,?,?)`)
          .run(p.id, inv.company_id, l.qty, inv.invoice_no, 'Invoice correction reversal', req.user.id, now());
      }
    }
    db.prepare('DELETE FROM invoice_lines WHERE invoice_id=?').run(inv.id);
    let subtotal = 0;
    const insLine = db.prepare(`INSERT INTO invoice_lines (invoice_id, product_id, description, qty, rate, amount, item_type) VALUES (?,?,?,?,?,?,?)`);
    for (const l of (lines||[])) {
      const amt = (Number(l.qty)||0)*(Number(l.rate)||0); subtotal += amt;
      const p = l.product_id ? db.prepare('SELECT * FROM products WHERE id=?').get(l.product_id) : null;
      insLine.run(inv.id, p?.id||null, l.description||p?.name||null, Number(l.qty)||0, Number(l.rate)||0, amt, l.item_type||'SALE');
      if (p && (l.item_type||'SALE')==='SALE') {
        db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(Number(l.qty)||0, p.id);
        db.prepare(`INSERT INTO inventory_movements (product_id, company_id, qty, type, ref, note, user_id, created_at) VALUES (?,?,?,'sale',?,?,?,?)`)
          .run(p.id, inv.company_id, -(Number(l.qty)||0), inv.invoice_no, 'Invoice correction', req.user.id, now());
      }
    }
    const discPct = Number(discount_pct ?? inv.discount_pct);
    const discAmt = subtotal*discPct/100;
    const delivery = Number(delivery_charge ?? inv.delivery_charge);
    const net = subtotal - discAmt + delivery;
    db.prepare(`UPDATE sales_invoices SET customer_id=?, booker_id=?, subtotal=?, discount_pct=?, discount_amount=?, delivery_charge=?, net_total=?, updated_at=?, audit_reason=? WHERE id=?`)
      .run(customer_id || inv.customer_id, inv.booker_id, subtotal, discPct, discAmt, delivery, net, now(), req.body.audit_reason, inv.id);
    audit(db, req, 'INVOICE_EDIT', 'sales_invoices', inv.id, `net ${inv.net_total}->${net}; ${req.body.audit_reason}`, inv.company_id);
    res.json({ ok: true, net_total: net });
  });

  // void invoice (reverses stock + outstanding; number not reused)
  r.post('/invoices/:id/void', requirePermission('approve'), (req, res) => {
    const inv = db.prepare('SELECT * FROM sales_invoices WHERE id=?').get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (inv.status === 'void') return res.status(400).json({ error: 'Already voided' });
    if (!req.body.audit_reason) return res.status(400).json({ error: 'Void reason required' });
    // reverse stock
    const lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=?').all(inv.id);
    for (const l of lines) {
      const p = db.prepare('SELECT * FROM products WHERE id=?').get(l.product_id);
      if (p && l.item_type === 'SALE') {
        db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(l.qty, p.id);
        db.prepare(`INSERT INTO inventory_movements (product_id, company_id, qty, type, ref, note, user_id, created_at) VALUES (?,?,?,'void',?,?,?,?)`)
          .run(p.id, inv.company_id, l.qty, inv.invoice_no, 'Invoice void', req.user.id, now());
      }
    }
    db.prepare(`UPDATE sales_invoices SET status='void', updated_at=?, audit_reason=? WHERE id=?`).run(now(), req.body.audit_reason, inv.id);
    audit(db, req, 'INVOICE_VOID', 'sales_invoices', inv.id, req.body.audit_reason, inv.company_id);
    res.json({ ok: true });
  });

  // ---------------- payments / ledger / recovery ----------------
  r.post('/payments', requirePermission('add'), (req, res) => {
    const { company_id, invoice_id, account_id, amount, paid_at, method } = req.body;
    if (!company_id || !account_id || !amount) return res.status(400).json({ error: 'missing payment fields' });
    const inv = invoice_id ? db.prepare('SELECT * FROM sales_invoices WHERE id=?').get(invoice_id) : null;
    if (inv && inv.status === 'void') return res.status(400).json({ error: 'Cannot pay voided invoice' });
    const id = db.prepare(`INSERT INTO payments (company_id, invoice_id, account_id, amount, paid_at, method, created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(company_id, invoice_id || null, account_id, Number(amount), paid_at || today(), method || 'cash', now()).lastInsertRowid;
    db.prepare(`INSERT INTO ledger_transactions (company_id, account_id, type, amount, ref, ref_type, created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(company_id, account_id, 'in', Number(amount), inv?.invoice_no || 'payment', 'payment', now());
    audit(db, req, 'PAYMENT_CREATE', 'payments', id, `$${amount} ${method}`, company_id);
    res.json({ id });
  });
  r.post('/payments/:id/reverse', requirePermission('approve'), (req, res) => {
    const p = db.prepare('SELECT * FROM payments WHERE id=?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    if (p.reversed_at) return res.status(400).json({ error: 'Already reversed' });
    if (!req.body.audit_reason) return res.status(400).json({ error: 'Reversal reason required' });
    db.prepare(`UPDATE payments SET reversed_at=?, reversed_by=? WHERE id=?`).run(now(), req.user.id, p.id);
    db.prepare(`INSERT INTO ledger_transactions (company_id, account_id, type, amount, ref, ref_type, created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(p.company_id, p.account_id, 'out', p.amount, p.id, 'payment_reverse', now());
    audit(db, req, 'PAYMENT_REVERSE', 'payments', p.id, req.body.audit_reason, p.company_id);
    // recalc settlement
    if (p.invoice_id) recalcSettlement(db, p.invoice_id);
    res.json({ ok: true });
  });

  r.post('/recovery', requirePermission('add'), (req, res) => {
    const { company_id, invoice_id, customer_id, booker_id, amount, recovered_at, note } = req.body;
    if (!company_id || !amount) return res.status(400).json({ error: 'missing recovery fields' });
    const id = db.prepare(`INSERT INTO recovery (company_id, invoice_id, customer_id, booker_id, amount, recovered_at, note, created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(company_id, invoice_id||null, customer_id||null, booker_id||null, Number(amount), recovered_at||today(), note||null, now()).lastInsertRowid;
    audit(db, req, 'RECOVERY_CREATE', 'recovery', id, `$${amount}`, company_id);
    res.json({ id });
  });
  r.post('/recovery/:id', requirePermission('edit'), (req, res) => {
    const rec = db.prepare('SELECT * FROM recovery WHERE id=?').get(req.params.id);
    if (!rec) return res.status(404).json({ error: 'Not found' });
    db.prepare(`UPDATE recovery SET amount=?, note=?, recovered_at=? WHERE id=?`).run(Number(req.body.amount ?? rec.amount), req.body.note ?? rec.note, req.body.recovered_at ?? rec.recovered_at, rec.id);
    audit(db, req, 'RECOVERY_EDIT', 'recovery', rec.id, '', rec.company_id);
    res.json({ ok: true });
  });

  // split recovery across two accounts
  r.post('/recovery/split', requirePermission('add'), (req, res) => {
    const { company_id, invoice_id, customer_id, account_1, amount_1, account_2, amount_2, recovered_at, note } = req.body;
    if (!account_1 || !amount_1) return res.status(400).json({ error: 'primary account+amount required' });
    if (account_2 && Number(account_1) === Number(account_2)) return res.status(400).json({ error: 'accounts must be distinct' });
    const a1 = Number(amount_1), a2 = Number(amount_2 || 0);
    const inv = invoice_id ? db.prepare('SELECT * FROM sales_invoices WHERE id=?').get(invoice_id) : null;
    if (inv) {
      const out = invoiceOutstanding(db, inv);
      if (a1 + a2 > out + 0.001) return res.status(400).json({ error: `Split recovery exceeds outstanding (${out.toFixed(2)})` });
    }
    const insRec = db.prepare(`INSERT INTO recovery (company_id, invoice_id, customer_id, amount, recovered_at, note, created_at) VALUES (?,?,?,?,?,?,?)`);
    const r1 = insRec.run(company_id, invoice_id||null, customer_id||null, a1, recovered_at||today(), `split-${account_1}${note?' | '+note:''}`, now()).lastInsertRowid;
    db.prepare(`INSERT INTO ledger_transactions (company_id, account_id, type, amount, ref, ref_type, created_at) VALUES (?,?,?,?,?,?,?)`).run(company_id, account_1, 'in', a1, inv?.invoice_no||'recovery', 'recovery', now());
    if (account_2 && a2 > 0) {
      const r2 = insRec.run(company_id, invoice_id||null, customer_id||null, a2, recovered_at||today(), `split-${account_2}${note?' | '+note:''}`, now()).lastInsertRowid;
      db.prepare(`INSERT INTO ledger_transactions (company_id, account_id, type, amount, ref, ref_type, created_at) VALUES (?,?,?,?,?,?,?)`).run(company_id, account_2, 'in', a2, inv?.invoice_no||'recovery', 'recovery', now());
    }
    audit(db, req, 'RECOVERY_SPLIT', 'recovery', invoice_id||null, `${a1}+${a2}`, company_id);
    res.json({ ok: true });
  });

  // ---------------- cheques ----------------
  r.get('/cheques', (req, res) => {
    const ctx = resolveCompanies(req);
    const { status, due_from, due_to } = req.query;
    let w = [], args = [];
    if (!ctx.all) { w.push(`ch.company_id IN (${ctx.ids.map(()=>'?').join(',')})`); args.push(...ctx.ids); }
    if (status) { w.push('ch.status=?'); args.push(status); }
    if (due_from) { w.push('ch.due_date>=?'); args.push(due_from); }
    if (due_to) { w.push('ch.due_date<=?'); args.push(due_to); }
    const where = w.length ? 'WHERE '+w.join(' AND ') : '';
    const rows = db.prepare(`SELECT ch.*, c.name AS customer_name, si.invoice_no, b.name AS booker_name, cc.name AS company_name
      FROM cheques ch LEFT JOIN customers c ON c.id=ch.customer_id LEFT JOIN sales_invoices si ON si.id=ch.invoice_id
      LEFT JOIN bookers b ON b.id=ch.booker_id LEFT JOIN companies cc ON cc.id=ch.company_id
      ${where} ORDER BY ch.due_date IS NULL, ch.due_date`).all(...args);
    res.json(rows);
  });
  r.post('/cheques', requirePermission('add'), (req, res) => {
    const { company_id, invoice_id, customer_id, booker_id, cheque_number, bank, amount, issue_date, due_date } = req.body;
    if (!company_id || !cheque_number || !amount) return res.status(400).json({ error: 'company, cheque number, amount required' });
    const dup = db.prepare(`SELECT id FROM cheques WHERE company_id=? AND cheque_number=? AND status NOT IN ('cancelled')`).get(company_id, cheque_number);
    if (dup) return res.status(400).json({ error: `Cheque number ${cheque_number} already used (record #${dup.id})` });
    const id = db.prepare(`INSERT INTO cheques (company_id, invoice_id, customer_id, booker_id, cheque_number, bank, amount, issue_date, due_date, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(company_id, invoice_id||null, customer_id||null, booker_id||null, cheque_number, bank||null, Number(amount), issue_date||null, due_date||null, 'pending', now()).lastInsertRowid;
    audit(db, req, 'CHEQUE_CREATE', 'cheques', id, `${cheque_number} $${amount}`, company_id);
    res.json({ id });
  });
  // lifecycle transitions
  r.post('/cheques/:id/status', requirePermission('approve'), (req, res) => {
    const ch = db.prepare('SELECT * FROM cheques WHERE id=?').get(req.params.id);
    if (!ch) return res.status(404).json({ error: 'Not found' });
    const to = req.body.status;
    const trans = canTransition(ch.status, to);
    if (to in { pending:1, deposited:1, cleared:1, bounced:1, cancelled:1 } === false) return res.status(400).json({ error: 'invalid target status' });
    if (!trans.ok) return res.status(400).json({ error: trans.reason });
    // Clearing reduces outstanding; bouncing/cancelling must not settle.
    const patch = { deposited:{deposit_date:today()}, cleared:{clearance_date:today(),deposit_date:ch.deposit_date||today()}, bounced:{clearance_date:null}, cancelled:{clearance_date:null} }[to] || {};
    const sets = ['status=?'].concat(Object.keys(patch).map(k=>`${k}=?`));
    db.prepare(`UPDATE cheques SET ${sets.join(',')}, updated_at=? WHERE id=?`).run(to, ...Object.values(patch), now(), ch.id);
    audit(db, req, 'CHEQUE_STATUS', 'cheques', ch.id, `${ch.status}->${to}`, ch.company_id);
    if (ch.invoice_id && (to === 'cleared' || ch.status === 'cleared')) recalcSettlement(db, ch.invoice_id);
    res.json({ ok: true });
  });
  // edit cheque details (audited)
  r.post('/cheques/:id/edit', requirePermission('edit'), (req, res) => {
    const ch = db.prepare('SELECT * FROM cheques WHERE id=?').get(req.params.id);
    if (!ch) return res.status(404).json({ error: 'Not found' });
    const { cheque_number, bank, amount, issue_date, due_date, deposit_date, clearance_date } = req.body;
    db.prepare(`UPDATE cheques SET cheque_number=?, bank=?, amount=?, issue_date=?, due_date=?, deposit_date=?, clearance_date=?, updated_at=?, audit_reason=? WHERE id=?`)
      .run(cheque_number ?? ch.cheque_number, bank ?? ch.bank, Number(amount ?? ch.amount), issue_date ?? ch.issue_date, due_date ?? ch.due_date, deposit_date ?? ch.deposit_date, clearance_date ?? ch.clearance_date, now(), req.body.audit_reason || null, ch.id);
    audit(db, req, 'CHEQUE_EDIT', 'cheques', ch.id, cheque_number||ch.cheque_number, ch.company_id);
    res.json({ ok: true });
  });
  // cancel cheque
  r.post('/cheques/:id/cancel', requirePermission('approve'), (req, res) => {
    const ch = db.prepare('SELECT * FROM cheques WHERE id=?').get(req.params.id);
    if (!ch) return res.status(404).json({ error: 'Not found' });
    if (ch.status === 'cancelled') return res.status(400).json({ error: 'Already cancelled' });
    if (!req.body.audit_reason) return res.status(400).json({ error: 'Cancellation reason required' });
    db.prepare(`UPDATE cheques SET status='cancelled', updated_at=?, audit_reason=? WHERE id=?`).run(now(), req.body.audit_reason, ch.id);
    audit(db, req, 'CHEQUE_CANCEL', 'cheques', ch.id, req.body.audit_reason, ch.company_id);
    if (ch.invoice_id && ch.status === 'cleared') recalcSettlement(db, ch.invoice_id); // restore outstanding
    res.json({ ok: true });
  });

  // ---------------- recovery & cheques workspace ----------------
  r.get('/recovery-workspace', (req, res) => {
    const ctx = resolveCompanies(req);
    const limit = Math.min(parseInt(req.query.limit||1000,10),1000);
    const rows = db.prepare(`SELECT si.*, c.name AS customer_name, b.name AS booker_name, cc.name AS company_name,
      (SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.invoice_id=si.id AND p.reversed_at IS NULL) AS paid,
      (SELECT COALESCE(SUM(amount),0) FROM recovery rr WHERE rr.invoice_id=si.id) AS recovered,
      (SELECT COALESCE(SUM(amount),0) FROM cheques ch WHERE ch.invoice_id=si.id AND ch.status='cleared') AS cleared_cheques,
      (SELECT COALESCE(SUM(net_amount),0) FROM sale_returns sr WHERE sr.invoice_id=si.id) AS returned,
      (SELECT COUNT(*) FROM cheques ch WHERE ch.invoice_id=si.id AND ch.status IN ('pending','deposited')) AS open_cheques
      FROM sales_invoices si JOIN customers c ON c.id=si.customer_id LEFT JOIN bookers b ON b.id=si.booker_id JOIN companies cc ON cc.id=si.company_id
      ${ctx.all?'':'WHERE si.company_id IN ('+ctx.ids.map(()=>'?').join(',')+')'} AND si.status='posted' ORDER BY si.is_old_bill DESC, si.invoice_date DESC LIMIT ?`)
      .all(...(ctx.all?[]:ctx.ids), limit);
    res.json(rows.map(x => ({ ...x, outstanding: Math.max(0, x.net_total - x.returned - x.paid - x.recovered - x.cleared_cheques) })));
  });

  // ---------------- sale returns ----------------
  r.get('/sale-returns', (req, res) => {
    const ctx = resolveCompanies(req);
    let w=[], args=[];
    if (!ctx.all) { w.push(`sr.company_id IN (${ctx.ids.map(()=>'?').join(',')})`); args.push(...ctx.ids); }
    const ww = w.length ? 'WHERE '+w.join(' AND ') : '';
    const rows = db.prepare(`SELECT sr.*, c.name customer_name, cc.name company_name, si.invoice_no
      FROM sale_returns sr JOIN sales_invoices si ON si.id=sr.invoice_id JOIN customers c ON c.id=sr.customer_id
      JOIN companies cc ON cc.id=sr.company_id ${ww} ORDER BY sr.return_date DESC, sr.id DESC`).all(...args);
    const out = rows.map(x => ({ ...x, lines: db.prepare('SELECT * FROM sale_return_lines WHERE return_id=?').all(x.id) }));
    res.json(out);
  });

  // Details needed to process a return for a given invoice, with available qty per line.
  r.get('/invoices/:id/returnable', (req, res) => {
    const inv = db.prepare(`SELECT si.*, c.name customer_name, c.address customer_address, c.phone customer_phone, cc.name company_name
      FROM sales_invoices si JOIN customers c ON c.id=si.customer_id JOIN companies cc ON cc.id=si.company_id WHERE si.id=?`).get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    const lines = db.prepare(`SELECT il.*,
        (SELECT COALESCE(SUM(srl.qty),0) FROM sale_return_lines srl WHERE srl.invoice_line_id=il.id) AS returned_qty
      FROM invoice_lines il WHERE il.invoice_id=? ORDER BY il.id`).all(inv.id).map(l => ({
      ...l, available_qty: Math.max(0, l.qty - l.returned_qty),
    }));
    const outstanding = invoiceOutstanding(db, inv);
    const returns = db.prepare('SELECT * FROM sale_returns WHERE invoice_id=? ORDER BY id').all(inv.id);
    res.json({ ...inv, lines, outstanding, returns });
  });

  // body: { invoice_id, return_date, reference, note, lines:[{invoice_line_id, product_id, qty, item_type}] }
  r.post('/sale-returns', requirePermission('add'), (req, res) => {
    const { invoice_id, return_date, reference, note, lines } = req.body;
    if (!invoice_id || !Array.isArray(lines) || !lines.length) return res.status(400).json({ error: 'invoice and return items required' });
    const inv = db.prepare('SELECT * FROM sales_invoices WHERE id=?').get(invoice_id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    if (inv.status === 'void') return res.status(400).json({ error: 'Voided invoice cannot be returned' });

    // validate each returned line against original (non-over-return)
    let netAmount = 0;
    const validated = [];
    for (const l of lines) {
      const il = db.prepare('SELECT * FROM invoice_lines WHERE id=?').get(l.invoice_line_id);
      if (!il || il.invoice_id !== Number(invoice_id)) return res.status(400).json({ error: 'Invalid invoice line' });
      const returned = db.prepare(`SELECT COALESCE(SUM(qty),0) t FROM sale_return_lines WHERE invoice_line_id=?`).get(il.id).t;
      const qty = Number(l.qty || 0);
      if (qty <= 0) return res.status(400).json({ error: 'Return qty must be positive' });
      if (qty > il.qty - returned + 0.0001) return res.status(400).json({ error: `Return qty (${qty}) exceeds available (${il.qty - returned}) for line #${il.id}` });
      const rate = il.rate || 0;
      validated.push({ il, qty, rate, amount: qty * rate, item_type: il.item_type || 'SALE' });
      if ((il.item_type || 'SALE') === 'SALE') netAmount += qty * rate;
    }

    const rid = db.prepare(`INSERT INTO sale_returns (company_id, invoice_id, customer_id, return_date, reference, net_amount, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(inv.company_id, inv.id, inv.customer_id, return_date || today(), reference || null, netAmount, note || null, req.user.id, now()).lastInsertRowid;

    const insLine = db.prepare(`INSERT INTO sale_return_lines (return_id, invoice_line_id, product_id, description, qty, rate, amount, item_type) VALUES (?,?,?,?,?,?,?,?)`);
    const updStock = db.prepare('UPDATE products SET stock=stock+? WHERE id=?');
    const insMove = db.prepare(`INSERT INTO inventory_movements (product_id, company_id, qty, type, ref, note, user_id, created_at) VALUES (?,?,?,'return',?,?,?,?)`);
    for (const v of validated) {
      const pid = v.il.product_id || null;
      insLine.run(rid, v.il.id, pid, v.il.description, v.qty, v.rate, v.amount, v.item_type);
      if (pid) {
        updStock.run(v.qty, pid);
        insMove.run(pid, inv.company_id, v.qty, inv.invoice_no, 'Sale return', req.user.id, now());
      }
    }
    audit(db, req, 'SALE_RETURN_CREATE', 'sale_returns', rid, `invoice ${inv.invoice_no} net=${netAmount} items=${validated.length}`, inv.company_id);
    res.json({ id: rid, net_amount: netAmount });
  });

  // ---------------- expenses (common) with heads, accounts & company % sharing ----------------
  r.get('/expense-heads', (req,res)=> res.json(db.prepare('SELECT * FROM expense_heads ORDER BY name').all()));
  r.post('/expense-heads', (req,res)=>{
    const { name } = req.body;
    if(!name) return res.status(400).json({error:'Head name required'});
    const id=db.prepare(`INSERT INTO expense_heads (name, is_active, created_at) VALUES (?,1,?)`).run(name, now()).lastInsertRowid;
    audit(db,req,'EXPENSE_HEAD_CREATE','expense_heads',id,name,null);
    res.json({id});
  });

  r.get('/expenses', (req, res) => {
    const { date_from, date_to } = req.query;
    let w=[], args=[];
    if (date_from){w.push('e.expense_date>=?');args.push(date_from);}
    if (date_to){w.push('e.expense_date<=?');args.push(date_to);}
    const where = w.length?'WHERE '+w.join(' AND '):'';
    const rows = db.prepare(`SELECT e.*, h.name head_name, a.name account_name, a.type account_type
      FROM expenses e LEFT JOIN expense_heads h ON h.id=e.head_id LEFT JOIN accounts a ON a.id=e.account_id
      ${where} ORDER BY e.expense_date DESC, e.id DESC`).all(...args);
    const out = rows.map(e=>{
      const allocs = db.prepare(`SELECT ea.*, c.name company_name FROM expense_allocations ea JOIN companies c ON c.id=ea.company_id WHERE ea.expense_id=?`).all(e.id);
      return {...e, allocations: allocs};
    });
    res.json(out);
  });
  r.post('/expenses', requirePermission('add'), (req, res) => {
    const { name, category, head_id, account_id, description, amount, expense_date, reference, allocations } = req.body;
    if (!name || amount === undefined) return res.status(400).json({ error: 'name and amount required' });
    if (Number(amount) <= 0) return res.status(400).json({ error: 'amount must be positive' });
    // validate % sharing sums to 100 if provided
    if (Array.isArray(allocations) && allocations.length) {
      const total = allocations.reduce((s,a)=>s+Number(a.percentage||0),0);
      if (Math.abs(total-100) > 0.0001) return res.status(400).json({ error: `Company allocation must total exactly 100% (got ${total})` });
    }
    const id = db.prepare(`INSERT INTO expenses (name, category, head_id, account_id, description, amount, expense_date, reference, is_common, created_at) VALUES (?,?,?,?,?,?,?,?,1,?)`)
      .run(name, category||null, head_id||null, account_id||null, description||null, Number(amount), expense_date||today(), reference||null, now()).lastInsertRowid;
    if (Array.isArray(allocations) && allocations.length) {
      const ins = db.prepare(`INSERT INTO expense_allocations (expense_id, company_id, percentage) VALUES (?,?,?)`);
      for (const a of allocations) ins.run(id, a.company_id, Number(a.percentage));
    }
    db.prepare(`INSERT INTO dist_ledger (account_id, kind, ref_id, type, amount, note, created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(account_id||null, 'expense', id, 'out', Number(amount), name, now());
    audit(db, req, 'EXPENSE_CREATE', 'expenses', id, `${name} ${amount} head=${head_id} acc=${account_id}`, null);
    res.json({ id });
  });

  // ---------------- payroll (common) ----------------
  r.get('/employees', (req,res)=>res.json(db.prepare('SELECT * FROM employees ORDER BY name').all()));
  r.post('/employees', (req,res)=>{
    const { name, role, phone } = req.body;
    if(!name) return res.status(400).json({error:'name required'});
    const id=db.prepare(`INSERT INTO employees (name, role, phone, is_active, created_at) VALUES (?,?,?,1,?)`).run(name, role||null, phone||null, now()).lastInsertRowid;
    res.json({id});
  });
  r.get('/payroll', (req,res)=>res.json(db.prepare(`SELECT p.*, e.name AS employee_name FROM payroll p JOIN employees e ON e.id=p.employee_id ORDER BY p.period DESC, p.id DESC`).all()));
  r.post('/payroll', (req,res)=>{
    const { employee_id, period, allowances, deductions, advance, rider_bike_info, fuel_allowance, maintenance_cost } = req.body;
    if(!employee_id || !period) return res.status(400).json({error:'employee and period required'});
    const allow=Number(allowances||0), fuel=Number(fuel_allowance||0), maint=Number(maintenance_cost||0), ded=Number(deductions||0);
    const gross = allow + fuel + maint;
    const net = gross - ded - Number(advance||0);
    const id=db.prepare(`INSERT INTO payroll (employee_id, period, allowances, deductions, advance, rider_bike_info, fuel_allowance, maintenance_cost, net, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(employee_id, period, allow, ded, Number(advance||0), rider_bike_info||null, fuel, maint, net, now()).lastInsertRowid;
    db.prepare(`INSERT INTO dist_ledger (kind, ref_id, type, amount, note, created_at) VALUES ('payroll',?,?,?,?,?)`).run(id,'out',net,'Payroll '+period,now());
    audit(db,req,'PAYROLL_CREATE','payroll',id,period,null);
    res.json({id});
  });

  // ---------------- logistics (common) ----------------
  r.get('/logistics', (req,res)=>res.json(db.prepare('SELECT * FROM logistics ORDER BY date DESC').all()));
  r.post('/logistics', (req,res)=>{
    const { date, transportation, fuel_consumption, mileage, description } = req.body;
    const id=db.prepare(`INSERT INTO logistics (date, transportation, fuel_consumption, mileage, description, created_at) VALUES (?,?,?,?,?,?)`)
      .run(date||today(), transportation||null, Number(fuel_consumption||0), Number(mileage||0), description||null, now()).lastInsertRowid;
    db.prepare(`INSERT INTO dist_ledger (kind, ref_id, type, amount, note, created_at) VALUES ('logistics',?,?,?,?,?)`).run(id,'out',Number(fuel_consumption||0),transportation||'logistics',now());
    res.json({id});
  });

  // ---------------- assets (common) ----------------
  r.get('/assets', (req,res)=>res.json(db.prepare('SELECT * FROM assets ORDER BY id DESC').all()));
  r.post('/assets', (req,res)=>{
    const { name, category, purchase_value, purchase_date } = req.body;
    if(!name) return res.status(400).json({error:'name required'});
    const id=db.prepare(`INSERT INTO assets (name, category, purchase_value, purchase_date, is_common, created_at) VALUES (?,?,?,?,1,?)`)
      .run(name, category||null, Number(purchase_value||0), purchase_date||null, now()).lastInsertRowid;
    res.json({id});
  });

  // ---------------- allocation plans (report-only) ----------------
  r.get('/allocation-plans', (req,res)=>res.json(db.prepare('SELECT * FROM allocation_plans ORDER BY id DESC').all()));
  r.get('/allocation-plans/:id', (req,res)=>{
    const p=db.prepare('SELECT * FROM allocation_plans WHERE id=?').get(req.params.id);
    const items=db.prepare(`SELECT api.*, c.name AS company_name FROM allocation_plan_items api JOIN companies c ON c.id=api.company_id WHERE api.plan_id=?`).all(req.params.id);
    res.json({...p, items});
  });
  r.post('/allocation-plans', requirePermission('add'), (req,res)=>{
    if (!isOwner(req.user)) return res.status(403).json({error:'Owner only'});
    const { name, items } = req.body;
    if(!name) return res.status(400).json({error:'name required'});
    if (!allocationTotalValid(items)) return res.status(400).json({error:'Allocation must total exactly 100%'});
    const create=db.prepare(`INSERT INTO allocation_plans (name, created_by, created_at) VALUES (?,?,?)`);
    const pid=create.run(name, req.user.id, now()).lastInsertRowid;
    const ins=db.prepare(`INSERT INTO allocation_plan_items (plan_id, company_id, percentage) VALUES (?,?,?)`);
    for (const it of (items||[])) ins.run(pid, it.company_id, Number(it.percentage));
    audit(db,req,'ALLOCATION_PLAN_CREATE','allocation_plans',pid,name,null);
    res.json({id:pid});
  });
  r.post('/allocation-plans/:id', requirePermission('edit'), (req,res)=>{
    if (!isOwner(req.user)) return res.status(403).json({error:'Owner only'});
    const p=db.prepare('SELECT * FROM allocation_plans WHERE id=?').get(req.params.id);
    if(!p) return res.status(404).json({error:'Not found'});
    const { name, items } = req.body;
    if (items) {
      if (!allocationTotalValid(items)) return res.status(400).json({error:'Allocation must total exactly 100%'});
      db.prepare('DELETE FROM allocation_plan_items WHERE plan_id=?').run(p.id);
      const ins=db.prepare(`INSERT INTO allocation_plan_items (plan_id, company_id, percentage) VALUES (?,?,?)`);
      for (const it of items) ins.run(p.id, it.company_id, Number(it.percentage));
    }
    db.prepare('UPDATE allocation_plans SET name=?, updated_at=? WHERE id=?').run(name||p.name, now(), p.id);
    audit(db,req,'ALLOCATION_PLAN_UPDATE','allocation_plans',p.id,name||p.name,null);
    res.json({ok:true});
  });

  // ---------------- Distribution Business ledger ----------------
  r.get('/dist-ledger', (req,res)=>{
    res.json(db.prepare('SELECT * FROM dist_ledger ORDER BY id DESC LIMIT 500').all());
  });

  // ---------------- profitability ----------------
  r.get('/profitability', (req,res)=>{
    const ctx = resolveCompanies(req);
    const companies = ctx.all ? db.prepare('SELECT * FROM companies WHERE is_active=1').all() : db.prepare(`SELECT * FROM companies WHERE id IN (${ctx.ids.map(()=>'?').join(',')}) AND is_active=1`).all(...ctx.ids);
    const plan = db.prepare('SELECT * FROM allocation_plans ORDER BY id DESC LIMIT 1').get();
    const items = plan ? db.prepare('SELECT * FROM allocation_plan_items WHERE plan_id=?').all(plan.id) : [];
    // common dist cost = sum of dist_ledger out
    const distCost = db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM dist_ledger WHERE type='out'`).get().t;
    const dateFrom = req.query.date_from, dateTo = req.query.date_to;
    const rows = companies.map(c=>{
      let w=['company_id=?','status=\'posted\''], args=[c.id];
      if(dateFrom){w.push('invoice_date>=?');args.push(dateFrom);}
      if(dateTo){w.push('invoice_date<=?');args.push(dateTo);}
      const sales = db.prepare(`SELECT COALESCE(SUM(net_total),0) t FROM sales_invoices WHERE ${w.join(' AND ')}`).get(...args).t;
      const marginValue = sales * (c.profit_margin_pct||0)/100;
      const item = items.find(i=>i.company_id===c.id);
      const allocPct = item ? item.percentage : 0;
      const allocValue = distCost * allocPct/100;
      const net = marginValue - allocValue;
      const bookerSales = db.prepare(`SELECT b.id, b.name, SUM(si.net_total) s FROM sales_invoices si LEFT JOIN bookers b ON b.id=si.booker_id WHERE si.company_id=? AND si.status='posted' GROUP BY b.id`).all(c.id)
        .map(x => {
          const ret = db.prepare(`SELECT COALESCE(SUM(sr.net_amount),0) t FROM sale_returns sr JOIN sales_invoices si2 ON si2.id=sr.invoice_id WHERE si2.company_id=? AND si2.booker_id=?`).get(c.id, x.id).t || 0;
          return { name: x.name, sales: x.s, returns: ret, net_sales: Math.max(0, x.s - ret) };
        });
      const bookerRecovery = db.prepare(`SELECT b.name, SUM(rr.amount) s FROM recovery rr LEFT JOIN bookers b ON b.id=rr.booker_id WHERE rr.company_id=? GROUP BY rr.booker_id`).all(c.id);
      return { company_id:c.id, company_name:c.name, partner_name:c.partner_name, profit_margin_pct:c.profit_margin_pct, sales, margin_value:marginValue,
        alloc_pct:allocPct, alloc_value:allocValue, profit_loss:net, bookerSales, bookerRecovery };
    });
    res.json({ dist_cost: distCost, plan, rows });
  });

  // ---------------- reports ----------------
  r.get('/reports/sales', (req,res)=>{
    const ctx=resolveCompanies(req); const {date_from,date_to,company_id,booker_id,item_id}=req.query;
    let w=[],args=[]; if(!ctx.all){w.push(`si.company_id IN (${ctx.ids.map(()=>'?').join(',')})`);args.push(...ctx.ids);}
    if(company_id){w.push('si.company_id=?');args.push(company_id);} if(date_from){w.push('si.invoice_date>=?');args.push(date_from);} if(date_to){w.push('si.invoice_date<=?');args.push(date_to);} if(booker_id){w.push('si.booker_id=?');args.push(booker_id);}
    const ww=w.length?'WHERE '+w.join(' AND '):'';
    const rows=db.prepare(`SELECT si.invoice_no, si.invoice_date, c.name customer_name, b.name booker_name, cc.name company_name, si.net_total, si.discount_amount, si.delivery_charge FROM sales_invoices si JOIN customers c ON c.id=si.customer_id LEFT JOIN bookers b ON b.id=si.booker_id JOIN companies cc ON cc.id=si.company_id ${ww} AND si.status='posted' ORDER BY si.invoice_date`).all(...args);
    if(item_id){ const f=rows.filter(r=>db.prepare('SELECT id FROM invoice_lines WHERE invoice_id=? AND product_id=?').get()); }
    res.json(rows);
  });
  r.get('/reports/stock', (req,res)=>{
    const ctx=resolveCompanies(req); let rows;
    if(ctx.all) rows=db.prepare('SELECT p.*, c.name company_name FROM products p JOIN companies c ON c.id=p.company_id ORDER BY p.name').all();
    else rows=db.prepare(`SELECT p.*, c.name company_name FROM products p JOIN companies c ON c.id=p.company_id WHERE p.company_id IN (${ctx.ids.map(()=>'?').join(',')}) ORDER BY p.name`).all(...ctx.ids);
    res.json(rows);
  });
  r.get('/reports/receivables', (req,res)=>{
    const ctx=resolveCompanies(req);
    const rows=db.prepare(`SELECT si.id, si.invoice_no, si.invoice_date, c.name customer_name, b.name booker_name, cc.name company_name, si.net_total,
      (SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.invoice_id=si.id AND p.reversed_at IS NULL) paid,
      (SELECT COALESCE(SUM(amount),0) FROM recovery rr WHERE rr.invoice_id=si.id) recovered,
      (SELECT COALESCE(SUM(amount),0) FROM cheques ch WHERE ch.invoice_id=si.id AND ch.status='cleared') cleared_cheques,
      (SELECT COALESCE(SUM(net_amount),0) FROM sale_returns sr WHERE sr.invoice_id=si.id) returned
      FROM sales_invoices si JOIN customers c ON c.id=si.customer_id LEFT JOIN bookers b ON b.id=si.booker_id JOIN companies cc ON cc.id=si.company_id
      ${ctx.all?'':'WHERE si.company_id IN ('+ctx.ids.map(()=>'?').join(',')+')'} AND si.status='posted' ORDER BY si.invoice_date`).all(...(ctx.all?[]:ctx.ids));
    res.json(rows.map(r=>({...r, outstanding:Math.max(0,r.net_total-r.returned-r.paid-r.recovered-r.cleared_cheques)})));
  });
  r.get('/reports/cashflow', (req,res)=>{
    const ctx=resolveCompanies(req); const {company_id,date_from,date_to}=req.query;
    let w=[],args=[]; if(!ctx.all){w.push(`company_id IN (${ctx.ids.map(()=>'?').join(',')})`);args.push(...ctx.ids);} if(company_id){w.push('company_id=?');args.push(company_id);} if(date_from){w.push('created_at>=?');args.push(date_from+'T00:00:00Z');} if(date_to){w.push('created_at<=?');args.push(date_to+'T23:59:59Z');}
    const ww=w.length?'WHERE '+w.join(' AND '):'';
    const rows=db.prepare(`SELECT * FROM ledger_transactions ${ww} ORDER BY id DESC`).all(...args);
    const cashIn=rows.filter(r=>r.type==='in').reduce((s,r)=>s+r.amount,0);
    const cashOut=rows.filter(r=>r.type==='out').reduce((s,r)=>s+r.amount,0);
    res.json({rows, cash_in:cashIn, cash_out:cashOut, net:cashIn-cashOut});
  });
  r.get('/reports/booker', (req,res)=>{
    const ctx=resolveCompanies(req); const {company_id,date_from,date_to}=req.query;
    let comps;
    if(ctx.all) comps=db.prepare('SELECT id FROM companies').all();
    else comps=ctx.ids.map(id=>({id}));
    const out=[];
    for(const c of comps){
      let w=['si.company_id=?',"si.status='posted'"],args=[c.id];
      if(date_from){w.push('invoice_date>=?');args.push(date_from);} if(date_to){w.push('invoice_date<=?');args.push(date_to);}
      const sales=db.prepare(`SELECT b.id, b.name, SUM(si.net_total) sales, COUNT(*) invoices FROM sales_invoices si LEFT JOIN bookers b ON b.id=si.booker_id WHERE ${w.join(' AND ')} GROUP BY b.id ORDER BY sales DESC`).all(...args);
      // returns per booker (same date range)
      let rw=['si.company_id=?',"si.status='posted'"], rargs=[c.id];
      if(date_from){rw.push('sr.return_date>=?');rargs.push(date_from);} if(date_to){rw.push('sr.return_date<=?');rargs.push(date_to);}
      const rets=db.prepare(`SELECT b.id, b.name, COALESCE(SUM(sr.net_amount),0) returns FROM sale_returns sr
        JOIN sales_invoices si ON si.id=sr.invoice_id LEFT JOIN bookers b ON b.id=si.booker_id
        WHERE ${rw.join(' AND ')} GROUP BY b.id`).all(...rargs);
      const rec=db.prepare(`SELECT b.name, SUM(rr.amount) recovered FROM recovery rr LEFT JOIN bookers b ON b.id=rr.booker_id WHERE rr.company_id=? GROUP BY rr.booker_id`).all(c.id);
      const merged = sales.map(s => { const r = rets.find(x => x.id === s.id) || { returns: 0 }; return { ...s, returns: r.returns, net_sales: Math.max(0, s.sales - r.returns) }; });
      out.push({company_id:c.id, company_name: c.name || db.prepare('SELECT name FROM companies WHERE id=?').get(c.id)?.name || '', sales: merged, recovery:rec});
    }
    res.json(out);
  });
  r.get('/reports/item', (req,res)=>{
    const ctx=resolveCompanies(req); const {item_id,company_id}=req.query;
    let w=['si.status=\'posted\''],args=[];
    if(!ctx.all){w.push(`si.company_id IN (${ctx.ids.map(()=>'?').join(',')})`);args.push(...ctx.ids);} if(company_id){w.push('si.company_id=?');args.push(company_id);} if(item_id){w.push('il.product_id=?');args.push(item_id);}
    const rows=db.prepare(`SELECT p.name item_name, p.sku, si.invoice_no, si.invoice_date, il.qty, il.rate, il.amount, il.item_type FROM invoice_lines il JOIN products p ON p.id=il.product_id JOIN sales_invoices si ON si.id=il.invoice_id WHERE ${w.join(' AND ')} ORDER BY si.invoice_date`).all(...args);
    res.json(rows);
  });
  r.get('/reports/expense', (req,res)=>{
    const {date_from,date_to}=req.query; let w=[],args=[];
    if(date_from){w.push('e.expense_date>=?');args.push(date_from);} if(date_to){w.push('e.expense_date<=?');args.push(date_to);}
    const ww=w.length?'WHERE '+w.join(' AND '):'';
    const rows=db.prepare(`SELECT e.*, h.name head_name, a.name account_name FROM expenses e LEFT JOIN expense_heads h ON h.id=e.head_id LEFT JOIN accounts a ON a.id=e.account_id ${ww} ORDER BY e.expense_date DESC`).all(...args);
    const out=rows.map(e=>{
      const allocs=db.prepare(`SELECT ea.*, c.name company_name FROM expense_allocations ea JOIN companies c ON c.id=ea.company_id WHERE ea.expense_id=?`).all(e.id);
      return {...e, allocations:allocs};
    });
    res.json(out);
  });

  // ---------------- ledger/audit ----------------
  r.get('/ledger', (req,res)=>{
    const ctx=resolveCompanies(req); const {company_id}=req.query;
    let w=[],args=[];
    if(company_id){w.push('company_id=?');args.push(company_id);} else if(!ctx.all){w.push(`company_id IN (${ctx.ids.map(()=>'?').join(',')})`);args.push(...ctx.ids);}
    const ww=w.length?'WHERE '+w.join(' AND '):'';
    res.json(db.prepare(`SELECT lt.*, a.name account_name FROM ledger_transactions lt LEFT JOIN accounts a ON a.id=lt.account_id ${ww} ORDER BY lt.id DESC LIMIT 500`).all(...args));
  });
  r.get('/audit', (req,res)=>{
    res.json(db.prepare(`SELECT al.*, u.full_name user_name FROM audit_log al LEFT JOIN users u ON u.id=al.user_id ORDER BY al.id DESC LIMIT 200`).all());
  });

  // ---------------- supplier / purchase invoices ----------------
  // Create purchase invoice with line items. Each SALE-able item increases stock.
  r.post('/supplier-purchases', requirePermission('add'), (req,res)=>{
    const { company_id, invoice_date, supplier, reference, amount, paid_amount, items } = req.body;
    if(!company_id || !supplier) return res.status(400).json({error:'company and supplier required'});
    const lineList = Array.isArray(items) ? items : [];
    if (!lineList.length && amount === undefined) return res.status(400).json({error:'Add items or an amount'});
    // compute line total + increase stock
    let lineTotal = 0;
    for (const it of lineList) {
      if (!it.product_id) continue;
      const p = db.prepare('SELECT * FROM products WHERE id=?').get(it.product_id);
      if (!p || p.company_id !== Number(company_id)) continue;
      const qty = Number(it.qty||0), rate = Number(it.rate||p.purchase_rate||0);
      lineTotal += qty*rate;
    }
    const finalAmount = amount !== undefined ? Number(amount) : lineTotal;
    const paid = Number(paid_amount || 0);
    if (paid > finalAmount + 0.001) return res.status(400).json({error:'Paid amount cannot exceed invoice amount'});
    const id=db.prepare(`INSERT INTO supplier_purchases (company_id, invoice_date, supplier, reference, amount, paid_amount, created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(company_id, invoice_date||today(), supplier, reference||null, finalAmount, paid, now()).lastInsertRowid;
    // line items + stock increase
    if (lineList.length) {
      const insLine = db.prepare(`INSERT INTO purchase_lines (purchase_id, product_id, description, qty, rate, amount) VALUES (?,?,?,?,?,?)`);
      for (const it of lineList) {
        if (!it.product_id) continue;
        const p = db.prepare('SELECT * FROM products WHERE id=?').get(it.product_id);
        if (!p || p.company_id !== Number(company_id)) continue;
        const qty = Number(it.qty||0), rate = Number(it.rate||p.purchase_rate||0);
        insLine.run(id, p.id, p.name, qty, rate, qty*rate);
        // stock + qty
        db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(qty, p.id);
        db.prepare(`INSERT INTO inventory_movements (product_id, company_id, qty, type, ref, note, user_id, created_at) VALUES (?,?,?,'purchase',?,?,?,?)`)
          .run(p.id, company_id, qty, reference||('PUR-'+id), 'Purchase invoice', req.user.id, now());
      }
    }
    audit(db,req,'SUPPLIER_PURCHASE_CREATE','supplier_purchases',id,`${supplier} amount=${finalAmount} items=${lineList.length}`,company_id);
    res.json({id, amount: finalAmount});
  });

  // Purchase ledger with Date | Invoice No | Debit | Credit | Balance
  r.get('/purchase-ledger', (req,res)=>{
    const ctx=resolveCompanies(req); const {company_id}=req.query;
    let w=[],args=[];
    if(company_id){w.push('sp.company_id=?');args.push(company_id);}
    else if(!ctx.all){w.push(`sp.company_id IN (${ctx.ids.map(()=>'?').join(',')})`);args.push(...ctx.ids);}
    const ww=w.length?'WHERE '+w.join(' AND '):'';
    const rows=db.prepare(`SELECT sp.*, cc.name company_name FROM supplier_purchases sp JOIN companies cc ON cc.id=sp.company_id ${ww} ORDER BY sp.invoice_date, sp.id`).all(...args);
    const cb={}; // running balance per company
    const out=rows.map(r=>{
      const debit=r.amount, credit=r.paid_amount;
      const bal=(cb[r.company_id]||0)+debit-credit;
      cb[r.company_id]=bal;
      return { id:r.id, invoice_date:r.invoice_date, invoice_no:r.reference||`PUR-${r.id}`, supplier:r.supplier,
        company_id:r.company_id, company_name:r.company_name, debit, credit, balance:Math.round(bal*100)/100 };
    });
    res.json(out);
  });

  r.get('/supplier-purchases', (req,res)=>{
    const ctx=resolveCompanies(req); const {company_id}=req.query;
    let w=[],args=[];
    if(company_id){w.push('company_id=?');args.push(company_id);}
    else if(!ctx.all){w.push(`company_id IN (${ctx.ids.map(()=>'?').join(',')})`);args.push(...ctx.ids);}
    const ww=w.length?'WHERE '+w.join(' AND '):'';
    const rows=db.prepare(`SELECT sp.*, cc.name company_name FROM supplier_purchases sp JOIN companies cc ON cc.id=sp.company_id ${ww} ORDER BY sp.id DESC`).all(...args);
    const out=rows.map(r=>{
      const lines=db.prepare('SELECT * FROM purchase_lines WHERE purchase_id=?').all(r.id);
      return {...r, lines, balance:Math.max(0,r.amount-r.paid_amount)};
    });
    res.json(out);
  });
  r.post('/supplier-purchases/:id/pay', requirePermission('add'), (req,res)=>{
    const sp=db.prepare('SELECT * FROM supplier_purchases WHERE id=?').get(req.params.id);
    if(!sp) return res.status(404).json({error:'Not found'});
    const { amount, paid_at, reference } = req.body;
    if (Number(amount)<=0) return res.status(400).json({error:'Payment amount required'});
    if (Number(amount) > (sp.amount-sp.paid_amount)+0.001) return res.status(400).json({error:'Payment exceeds outstanding balance'});
    db.prepare(`INSERT INTO supplier_payments (purchase_id, amount, paid_at, reference, created_at) VALUES (?,?,?,?,?)`).run(sp.id, Number(amount), paid_at||today(), reference||null, now());
    db.prepare(`UPDATE supplier_purchases SET paid_amount=paid_amount+? WHERE id=?`).run(Number(amount), sp.id);
    audit(db,req,'SUPPLIER_PAYMENT','supplier_purchases',sp.id,`${amount}`,sp.company_id);
    res.json({ok:true});
  });

  // ---------------- purchase invoice excel template & import ----------------
  r.get('/purchase-template', (req, res) => {
    const buf = buildPurchaseTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="purchase-invoice-template.xlsx"');
    res.send(buf);
  });
  // body: { data: base64 string of the .xlsx }
  r.post('/supplier-purchases/upload', requirePermission('add'), (req, res) => {
    const { data } = req.body;
    if (!data) return res.status(400).json({ error: 'No file data' });
    try {
      const buf = Buffer.from(data, 'base64');
      const result = parsePurchaseUpload(db, req, buf);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: 'Could not parse the file. Please use the .xlsx template. (' + e.message + ')' });
    }
  });

  // ---------------- backups ----------------
  r.get('/backups', (req,res)=>res.json(db.prepare('SELECT * FROM backups ORDER BY id DESC').all()));
  r.post('/backups', (req,res)=>{
    const ts=new Date().toISOString().replace(/[:.]/g,'-');
    const filename=`erp-backup-${ts}.db`;
    const id=db.prepare(`INSERT INTO backups (filename, created_by, created_at, note) VALUES (?,?,?,?)`).run(filename, req.user.id, now(), req.body.note||null).lastInsertRowid;
    audit(db,req,'BACKUP_CREATE','backups',id,filename,null);
    res.json({id, filename});
  });

  // ---------------- invoice template ----------------
  r.get('/invoice-template', (req, res) => {
    const t = getTemplate(db);
    res.json({ ...t, has_logo: !!getLogo(db) });
  });
  r.post('/invoice-template', requirePermission('edit'), (req, res) => {
    const allowed = ['company_name','company_address','company_phone','company_email','account_bank_name','account_title','account_iban','account_easypaisa','default_terms','footer_note','currency','accent_color'];
    const patch = {};
    for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];
    for (const k of ['show_logo','show_account_details','show_terms','show_rep']) if (req.body[k] !== undefined) patch[k] = !!req.body[k];
    const t = saveTemplate(db, patch);
    audit(db, req, 'INVOICE_TEMPLATE_UPDATE', 'invoice_template', null, 'template updated', null);
    res.json({ ...t, has_logo: !!getLogo(db) });
  });
  r.post('/invoice-template/logo', requirePermission('edit'), (req, res) => {
    const { data } = req.body; // base64 JPEG
    if (!data) return res.status(400).json({ error: 'No image data' });
    setLogo(db, data);
    audit(db, req, 'INVOICE_TEMPLATE_LOGO', 'invoice_template', null, 'logo uploaded', null);
    res.json({ ok: true, has_logo: true });
  });
  r.get('/invoice-template/logo', (req, res) => {
    const data = getLogo(db);
    if (!data) return res.json({ data: null });
    res.json({ data });
  });
  r.delete('/invoice-template/logo', requirePermission('edit'), (req, res) => {
    clearLogo(db);
    res.json({ ok: true, has_logo: false });
  });

  // ---------------- settings ----------------
  r.get('/settings/whatsapp', (req,res)=>{
    res.json({ recipients: (db.prepare('SELECT value FROM app_settings WHERE key=?').get('whatsapp_recipients')||{}).value || '' });
  });
  r.post('/settings/whatsapp', (req,res)=>{
    const { recipients } = req.body;
    db.prepare(`INSERT INTO app_settings (key,value) VALUES ('whatsapp_recipients',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(recipients||'');
    audit(db,req,'SETTINGS_WHATSAPP','app_settings',null,'recipients updated',null);
    res.json({ok:true});
  });

  r.get('/overview', (req,res)=>{
    // supplier ledger running view
    const purchases=db.prepare('SELECT * FROM supplier_purchases ORDER BY invoice_date').all();
    const ledger=purchases.map(p=>({...p, outstanding:p.amount-p.paid_amount}));
    res.json({ suppliers: ledger });
  });

  return r;
}

// ---------- business helpers ----------
function verifyCurrentPassword(db, user, pw) {
  return verifyPassword(user.password_hash, pw || '');
}
function invoiceNumber(db, companyId) {
  const prefix = companyId ? `INV-${String(companyId).padStart(2,'0')}-` : 'INV-';
  const last = db.prepare(`SELECT invoice_no FROM sales_invoices WHERE company_id=? ORDER BY id DESC LIMIT 1`).get(companyId);
  let next = 1;
  if (last && last.invoice_no) {
    const m = last.invoice_no.match(/(\d+)\s*$/);
    if (m) next = parseInt(m[1],10) + 1;
  }
  // scan for a free number in case of gaps
  let candidate = next;
  let guard = 0;
  while (db.prepare('SELECT id FROM sales_invoices WHERE company_id=? AND invoice_no=?').get(companyId, `${prefix}${String(candidate).padStart(4,'0')}`) && guard < 10000) { candidate++; guard++; }
  return `${prefix}${String(candidate).padStart(4,'0')}`;
}

function invoiceOutstanding(db, inv) {
  const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM payments WHERE invoice_id=? AND reversed_at IS NULL`).get(inv.id).t;
  const rec = db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM recovery WHERE invoice_id=?`).get(inv.id).t;
  const chq = db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM cheques WHERE invoice_id=? AND status='cleared'`).get(inv.id).t;
  const ret = db.prepare(`SELECT COALESCE(SUM(net_amount),0) t FROM sale_returns WHERE invoice_id=?`).get(inv.id).t;
  return Math.max(0, inv.net_total - ret - paid - rec - chq);
}

function recalcSettlement(db, invoiceId) {
  const inv = db.prepare('SELECT * FROM sales_invoices WHERE id=?').get(invoiceId);
  if (!inv) return;
  const outstanding = invoiceOutstanding(db, inv);
  const settled = outstanding <= 0.001 ? 1 : 0;
  db.prepare(`UPDATE sales_invoices SET status = CASE WHEN ?=1 THEN 'posted' ELSE 'posted' END WHERE id=?`).run(settled, invoiceId);
  audit(db, { user: { id: null } }, 'SETTLEMENT_RECALC', 'sales_invoices', invoiceId, `outstanding=${outstanding.toFixed(2)}`, inv.company_id);
}
