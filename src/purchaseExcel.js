// Purchase-invoice Excel template + import.
// Template is a flat sheet; each row = one line item. Rows sharing the same
// (Company, Supplier, Invoice Date, Ref) are grouped into ONE purchase invoice
// so a multi-item supplier delivery can be imported in a single file.
import * as XLSX from 'xlsx';

export const PURCHASE_COLUMNS = ['Company', 'Supplier', 'Invoice Date', 'Invoice No / Ref', 'Product (Name or SKU)', 'Qty', 'Rate', 'Paid Amount'];

const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

function num(v) { const n = Number(v); return isNaN(n) ? 0 : n; }
function clean(s) { return String(s ?? '').trim(); }

// ---------------- template generation ----------------
export function buildPurchaseTemplate() {
  const example = [
    'Erbil Distributors', 'Al-Noor Suppliers', '2026-08-29', 'PUR-2026-001',
    'Shampoo 300ml', 10, 1200, 0,
  ];
  const ws = XLSX.utils.aoa_to_sheet([
    PURCHASE_COLUMNS,
    example,
    [],
    ['HOW TO USE:'],
    ['1. Download this file, fill ONE row per line item of the purchase invoice.'],
    ['2. Rows with the same Company + Supplier + Date + Ref become ONE purchase invoice (many items).'],
    ['3. Company and Product columns match by name (or product SKU). Qty > 0 is required.'],
    ['4. Save as .xlsx and use "Upload Purchase Invoice" in the Purchases page.'],
    ['5. Stock and Purchase Ledger update automatically for every valid item.'],
  ]);
  ws['!cols'] = [{ wch: 20 }, { wch: 22 }, { wch: 13 }, { wch: 16 }, { wch: 28 }, { wch: 8 }, { wch: 10 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Purchase Invoice');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ---------------- import ----------------
export function parsePurchaseUpload(db, req, buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  const companies = db.prepare('SELECT * FROM companies').all();
  const products = db.prepare('SELECT * FROM products').all();
  const errors = [];
  const stockUpdates = [];

  const keyOf = r => [r.company_id, clean(r.supplier), r.date, clean(r.ref)].join('|');
  const groups = {}; // key -> { company_id, supplier, date, ref, paid, items:[] }

  for (const [i, row] of rows.entries()) {
    const lineNo = i + 2; // 1-based + header
    const companyName = clean(row['Company']);
    const supplier = clean(row['Supplier']);
    const date = clean(row['Invoice Date']) || today();
    const ref = clean(row['Invoice No / Ref']);
    const productKey = clean(row['Product (Name or SKU)']);
    const qty = num(row['Qty']);
    const rate = num(row['Rate']);
    const paid = num(row['Paid Amount']);

    // resolve company
    let company = companyName ? companies.find(c => c.name.toLowerCase() === companyName.toLowerCase()) || companies.find(c => String(c.id) === String(companyName)) : null;
    if (!company) { errors.push(`Row ${lineNo}: unknown Company "${companyName}"`); continue; }
    if (!supplier) { errors.push(`Row ${lineNo}: Supplier is required`); continue; }
    if (!productKey) { errors.push(`Row ${lineNo}: Product is required`); continue; }

    // resolve product within the company
    const lower = productKey.toLowerCase();
    const product = products.find(p => p.company_id === company.id && (p.name.toLowerCase() === lower || (p.sku && String(p.sku).toLowerCase() === lower)));
    if (!product) {
      // try by name/sku prefix match
      const fuzzy = products.find(p => p.company_id === company.id && (p.name.toLowerCase().includes(lower) || (p.sku && String(p.sku).toLowerCase().includes(lower))));
      if (fuzzy) errors.push(`Row ${lineNo}: product "${productKey}" matched "${fuzzy.name}" by prefix — please use exact name/SKU. Skipped.`);
      else errors.push(`Row ${lineNo}: product "${productKey}" not found for company "${company.name}"`);
      continue;
    }
    if (qty <= 0) { errors.push(`Row ${lineNo}: Qty must be > 0`); continue; }
    const finalRate = rate > 0 ? rate : (product.purchase_rate || 0);

    const key = keyOf({ company_id: company.id, supplier, date, ref });
    if (!groups[key]) groups[key] = { company_id: company.id, supplier, date, ref, paid: paid || 0, items: [] };
    groups[key].items.push({ product, qty, rate: finalRate, amount: qty * finalRate });
  }

  let invoicesCreated = 0;
  let itemsImported = 0;
  const insertPurchase = db.prepare(`INSERT INTO supplier_purchases (company_id, invoice_date, supplier, reference, amount, paid_amount, created_at) VALUES (?,?,?,?,?,?,?)`);
  const insertLine = db.prepare(`INSERT INTO purchase_lines (purchase_id, product_id, description, qty, rate, amount) VALUES (?,?,?,?,?,?)`);
  const updStock = db.prepare('UPDATE products SET stock=stock+? WHERE id=?');
  const insMovement = db.prepare(`INSERT INTO inventory_movements (product_id, company_id, qty, type, ref, note, user_id, created_at) VALUES (?,?,?,'purchase',?,?,?,?)`);
  const audit = db.prepare(`INSERT INTO audit_log (user_id, company_id, action, entity, entity_id, detail, created_at) VALUES (?,?,?,?,?,?,?)`);

  for (const g of Object.values(groups)) {
    const amount = g.items.reduce((s, it) => s + it.amount, 0);
    const paid = Math.min(g.paid, amount);
    const id = insertPurchase.run(g.company_id, g.date, g.supplier, g.ref || ('PUR-' + Date.now()), amount, paid, now()).lastInsertRowid;
    const refUsed = g.ref || ('PUR-' + id);
    db.prepare('UPDATE supplier_purchases SET reference=? WHERE id=?').run(refUsed, id);
    for (const it of g.items) {
      insertLine.run(id, it.product.id, it.product.name, it.qty, it.rate, it.amount);
      updStock.run(it.qty, it.product.id);
      insMovement.run(it.product.id, g.company_id, it.qty, refUsed, 'Purchase import', req.user.id, now());
      stockUpdates.push(`${it.product.name}: +${it.qty} (now ${it.product.stock + it.qty})`);
      itemsImported++;
    }
    audit.run(req.user.id, g.company_id, 'SUPPLIER_PURCHASE_IMPORT', 'supplier_purchases', id, `${g.supplier} amount=${amount} items=${g.items.length}`, now());
    invoicesCreated++;
  }

  return { invoices_created: invoicesCreated, items_imported: itemsImported, stock_updates: stockUpdates, errors };
}
