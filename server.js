import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './src/db.js';
import { login } from './src/auth.js';
import { buildRouter } from './src/routes.js';
import { buildPdf, buildExcel, reportMeta } from './src/reports.js';
import { buildInvoicePdf } from './src/invoicePdf.js';
import { getTemplate, getLogo } from './src/template.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(db) {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(cookieParser());
  app.use((req, res, next) => { req.db = db; next(); });

  app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = login(db, username, password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    res.cookie('uid', user.id, { httpOnly: true, sameSite: 'lax', maxAge: 1000*60*60*24*7 });
    res.json({ ok: true, user: { id: user.id, full_name: user.full_name, role: user.role } });
  });
  app.post('/api/logout', (req, res) => { res.clearCookie('uid'); res.json({ ok: true }); });

  app.use('/api', buildRouter(db));

  // ---- report export endpoints ----
  function collectReport(type, req) {
    const q = req.query;
    let columns = [], rows = [];
    switch (type) {
      case 'sales':
        columns = [
          { key: 'company_name', label: 'Company' }, { key: 'invoice_no', label: 'Invoice No' },
          { key: 'invoice_date', label: 'Date' }, { key: 'customer_name', label: 'Customer' },
          { key: 'booker_name', label: 'Booker' }, { key: 'net_total', label: 'Net Total' },
        ];
        rows = req.db.prepare(`SELECT cc.name company_name, si.invoice_no, si.invoice_date, c.name customer_name, b.name booker_name, si.net_total
          FROM sales_invoices si JOIN companies cc ON cc.id=si.company_id JOIN customers c ON c.id=si.customer_id LEFT JOIN bookers b ON b.id=si.booker_id
          WHERE si.status='posted' ${q.company_id?'AND si.company_id=?':''} ${q.date_from?'AND si.invoice_date>=?':''} ${q.date_to?'AND si.invoice_date<=?':''}
          ORDER BY si.invoice_date`).all(...[q.company_id,q.date_from,q.date_to].filter(Boolean));
        break;
      case 'stock':
        columns = [
          { key: 'company_name', label: 'Company' }, { key: 'name', label: 'Item' }, { key: 'sku', label: 'SKU' },
          { key: 'stock', label: 'Stock' }, { key: 'damaged_stock', label: 'Damaged' }, { key: 'retail_rate', label: 'Retail Rate' },
        ];
        rows = req.db.prepare(`SELECT p.name, p.sku, p.stock, p.damaged_stock, p.retail_rate, cc.name company_name FROM products p JOIN companies cc ON cc.id=p.company_id ${q.company_id?'WHERE p.company_id=?':''} ORDER BY p.name`).all(...(q.company_id?[q.company_id]:[]));
        break;
      case 'receivables':
        columns = [
          { key: 'company_name', label: 'Company' }, { key: 'invoice_no', label: 'Invoice No' }, { key: 'invoice_date', label: 'Date' },
          { key: 'customer_name', label: 'Customer' }, { key: 'booker_name', label: 'Booker' }, { key: 'net_total', label: 'Net Total' },
          { key: 'paid', label: 'Paid' }, { key: 'outstanding', label: 'Outstanding' },
        ];
        {
          const base = req.db.prepare(`SELECT si.invoice_no, si.invoice_date, c.name customer_name, b.name booker_name, cc.name company_name, si.net_total,
            (SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.invoice_id=si.id AND p.reversed_at IS NULL) paid,
            (SELECT COALESCE(SUM(amount),0) FROM recovery rr WHERE rr.invoice_id=si.id) recovered,
            (SELECT COALESCE(SUM(amount),0) FROM cheques ch WHERE ch.invoice_id=si.id AND ch.status='cleared') cleared
            FROM sales_invoices si JOIN customers c ON c.id=si.customer_id LEFT JOIN bookers b ON b.id=si.booker_id JOIN companies cc ON cc.id=si.company_id
            WHERE si.status='posted' ${q.company_id?'AND si.company_id=?':''} ORDER BY si.invoice_date`).all(...(q.company_id?[q.company_id]:[]));
          rows = base.map(r => ({ ...r, outstanding: Math.max(0, r.net_total - r.paid - r.recovered - r.cleared) }));
        }
        break;
      case 'cashflow':
        columns = [
          { key: 'account_name', label: 'Account' }, { key: 'type', label: 'Type' }, { key: 'amount', label: 'Amount' },
          { key: 'ref', label: 'Reference' }, { key: 'created_at', label: 'Date' },
        ];
        rows = req.db.prepare(`SELECT a.name account_name, lt.type, lt.amount, lt.ref, lt.created_at FROM ledger_transactions lt LEFT JOIN accounts a ON a.id=lt.account_id ORDER BY lt.id DESC`).all();
        break;
      case 'expense':
        columns = [
          { key: 'expense_date', label: 'Date' }, { key: 'name', label: 'Expense' }, { key: 'category', label: 'Category' },
          { key: 'description', label: 'Description' }, { key: 'reference', label: 'Reference' }, { key: 'amount', label: 'Amount' },
        ];
        rows = req.db.prepare('SELECT * FROM expenses ORDER BY expense_date').all();
        break;
      case 'booker':
        columns = [
          { key: 'company_name', label: 'Company' }, { key: 'name', label: 'Booker' }, { key: 'sales', label: 'Sales' }, { key: 'recovered', label: 'Recovery' },
        ];
        rows = [];
        {
          const comps = q.company_id ? [{ id: q.company_id }] : req.db.prepare('SELECT id FROM companies').all();
          for (const c of comps) {
            const cn = req.db.prepare('SELECT name FROM companies WHERE id=?').get(c.id).name;
            const s = req.db.prepare(`SELECT b.name, SUM(si.net_total) sales FROM sales_invoices si LEFT JOIN bookers b ON b.id=si.booker_id WHERE si.company_id=? AND si.status='posted' GROUP BY b.id`).all(c.id);
            const rec = req.db.prepare('SELECT b.name, SUM(rr.amount) recovered FROM recovery rr LEFT JOIN bookers b ON b.id=rr.booker_id WHERE rr.company_id=? GROUP BY rr.booker_id').all(c.id);
            const all = new Set([...s.map(x=>x.name), ...rec.map(x=>x.name)]);
            for (const n of all) rows.push({ company_name: cn, name: n, sales: s.find(x=>x.name===n)?.sales||0, recovered: rec.find(x=>x.name===n)?.recovered||0 });
          }
        }
        break;
      default: break;
    }
    return { columns, rows };
  }

  app.get('/api/reports/:type/export', (req, res) => {
    const type = req.params.type;
    const fmt = req.query.format || 'pdf';
    const meta = reportMeta({
      title: req.query.title || (type.charAt(0).toUpperCase() + type.slice(1)) + ' Report',
      type, company_name: req.query.company_name || 'All Companies',
      date_from: req.query.date_from, date_to: req.query.date_to,
      report_number: req.query.report_number, reference_number: req.query.reference_number,
    });
    const { columns, rows } = collectReport(type, req);
    if (fmt === 'xlsx') {
      const buf = buildExcel({ meta, columns, rows });
      res.setHeader('Content-Type', 'application/vnd.ms-excel');
      res.setHeader('Content-Disposition', `attachment; filename="${type}-report.xls"`);
      res.send(buf);
    } else {
      const buf = buildPdf({ meta, columns, rows });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${type}-report.pdf"`);
      res.send(buf);
    }
  });

  function makeInvoiceExport(req, res, inv) {
    const lines = req.db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=?').all(inv.id);
    const template = getTemplate(req.db);
    const logoB64 = getLogo(req.db);
    const company = req.db.prepare('SELECT name, address, phone, email FROM companies WHERE id=?').get(inv.company_id) || {};
    const invOut = {
      invoice_no: inv.invoice_no, invoice_date: inv.invoice_date,
      customer_name: inv.customer_name, customer_address: inv.customer_address, customer_phone: inv.customer_phone,
      booker_name: inv.booker_name, discount_pct: inv.discount_pct, discount_amount: inv.discount_amount,
      delivery_charge: inv.delivery_charge, net_total: inv.net_total,
    };
    const pdf = buildInvoicePdf({ template, invoice: invOut, lines, logo: logoB64, company });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${inv.invoice_no}.pdf"`);
    res.send(pdf);
  }

  app.get('/api/invoices/:id/export', (req, res) => {
    const inv = req.db.prepare(`SELECT si.*, c.name customer_name, c.address customer_address, c.phone customer_phone, b.name booker_name
      FROM sales_invoices si JOIN customers c ON c.id=si.customer_id LEFT JOIN bookers b ON b.id=si.booker_id WHERE si.id=?`).get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    makeInvoiceExport(req, res, inv);
  });

  // template preview PDF using sample data
  app.get('/api/invoice-template/preview.pdf', (req, res) => {
    const template = getTemplate(req.db);
    const logoB64 = getLogo(req.db);
    const company = { name: template.company_name || 'FREECIA PROFESSIONAL', address: template.company_address, phone: template.company_phone, email: template.company_email };
    const sample = {
      invoice_no: 'F-193', invoice_date: '8/1/2026',
      customer_name: 'TRENDS SALON', customer_address: 'KDA GULSHAN BRANCH', customer_phone: '0310-2787081',
      booker_name: 'RUBAB', discount_pct: 10, discount_amount: 7375, delivery_charge: 0, net_total: 66375,
    };
    const lines = [
      { description: 'KERATIN RECONSTRUCTING 1000ML', qty: 2, rate: 24500, amount: 49000 },
      { description: 'FREECIA BLEACH POWDER 500 GM JAR', qty: 5, rate: 4950, amount: 24750 },
    ];
    const pdf = buildInvoicePdf({ template, invoice: sample, lines, logo: logoB64, company });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-template-preview.pdf"`);
    res.send(pdf);
  });

  const pubDir = path.join(__dirname, 'public');
  app.use(express.static(pubDir));
  app.get('*', (req, res) => res.sendFile(path.join(pubDir, 'index.html')));
  return app;
}

// Start only when run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb();
  const app = createApp(db);
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => console.log(`ERP listening on 0.0.0.0:${PORT}`));
}
