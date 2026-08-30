import { api, state, fmtMoney, fmtDate, esc, can } from './api.js';
import { navigate, toast } from './app.js';

let products = [];
let customers = [];
let accounts = [];
let nextNo = '';
let invTemplate = {};
let invCompany = {};
let invLogo = null;

// --- modal popup helpers ---
export function openModal(title, html, wide) {
  const m = document.getElementById('modal');
  const box = m.querySelector('.mbox');
  box.style.maxWidth = wide ? '1100px' : '940px';
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = html;
  m.classList.add('show');
  document.body.style.overflow = 'hidden';
}
export function closeModal() {
  const m = document.getElementById('modal');
  m.classList.remove('show');
  document.getElementById('modalBody').innerHTML = '';
  document.body.style.overflow = '';
}
window.__closeModal = closeModal;

// ---- amount in words ----
const _ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const _tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
function _two(n) {
  if (n < 20) return _ones[n];
  return _tens[Math.floor(n/10)] + (n%10 ? '-' + _ones[n%10] : '');
}
function _hundred(n) {
  if (n < 100) return _two(n);
  return _ones[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' ' + _two(n%100) : '');
}
export function numberToWords(n) {
  if (n === undefined || n === null || isNaN(n)) return '';
  const neg = n < 0;
  n = Math.abs(n);
  const crore = Math.floor(n / 10000000);
  n = n % 10000000;
  const lakh = Math.floor(n / 100000);
  n = n % 100000;
  const thousand = Math.floor(n / 1000);
  n = n % 1000;
  const parts = [];
  if (crore) parts.push(_two(crore) + ' Crore');
  if (lakh) parts.push(_two(lakh) + ' Lakh');
  if (thousand) parts.push(_two(thousand) + ' Thousand');
  if (n) parts.push(_hundred(n));
  let words = parts.join(' ');
  if (!words) words = 'Zero';
  return (neg ? 'Minus ' : '') + words;
}
export function amountInWords(amount, currency) {
  const num = Math.round(Number(amount||0)*100)/100;
  const whole = Math.floor(num);
  const paisa = Math.round((num - whole) * 100);
  let w = numberToWords(whole);
  if (paisa) w += ' and ' + _two(paisa) + ' Paisa';
  const rupee = currency === 'PKR' ? ' (Rupees)' : '';
  return (currency ? currency + rupee + ' ' : '') + w + ' Only';
}

export async function viewInvoices() {
  const [prod, cust, acc] = await Promise.all([
    api('/products' + (state.company_id ? `?company_id=${state.company_id}` : '')),
    api('/customers' + (state.company_id ? `?company_id=${state.company_id}` : '')),
    api('/accounts'),
  ]);
  products = prod; customers = cust; accounts = acc;
  const invs = await api('/invoices' + (state.company_id ? `?company_id=${state.company_id}` : ''));
  return {
    html: `
    <div class="row-actions" style="margin-bottom:16px">
      <button class="btn" onclick="window.__showForm()">+ New Invoice</button>
      <button class="btn ghost" onclick="window.__showForm(true)">+ Add Old Bill</button>
      <div class="spacer" style="flex:1"></div>
      <select onchange="window.__invCompany(this.value)">${state.members.map(m => `<option value="${m.company_id}" ${m.company_id===state.company_id?'selected':''}>${esc(m.company_name)}</option>`).join('')}</select>
    </div>
    <div class="panel">
      <div class="head">Saved Invoices <span class="pill b">${invs.length}</span></div>
      <div class="tbl-wrap"><table>
        <tr><th>Invoice No</th><th>Date</th><th>Company</th><th>Customer</th><th>Booker</th><th>Total</th><th>Outstanding</th><th>Type</th><th></th></tr>
        ${invs.map(i=>`<tr>
          <td>${esc(i.invoice_no)}</td><td>${fmtDate(i.invoice_date)}</td><td>${esc(i.company_name)}</td><td>${esc(i.customer_name)}</td><td>${esc(i.booker_name||'')}</td>
          <td>${fmtMoney(i.net_total)}</td><td style="color:${i.outstanding>0?'var(--bad)':'var(--ok)'}">${fmtMoney(i.outstanding)}</td>
          <td>${i.is_old_bill?'<span class="pill y">Old Bill</span>':'<span class="pill g">Sale</span>'}</td>
          <td><button class="btn sm ghost" onclick="window.__viewInv(${i.id})">View</button></td>
        </tr>`).join('')}
      </table></div>
    </div>`,
    mount: (el) => {
      window.__invCompany = async (v) => { state.company_id = +v; navigate('invoices'); };
      window.__showForm = (isOld) => showForm(isOld);
      window.__viewInv = (id) => viewInvoiceDetail(id);
    }
  };
}

async function showForm(isOld) {
  const co = state.company_id;
  const comp = state.members.find(m => m.company_id === co);
  if (!co || !comp) return toast('Select a company first', true);
  const prods = await api(`/products?company_id=${co}`);
  const custs = (await api(`/customers?company_id=${co}`)).filter(c => c.is_active);
  const accs = await api('/accounts');
  products = prods; customers = custs; accounts = accs;
  try { invTemplate = await api('/invoice-template'); } catch(e){ invTemplate = {}; }
  try {
    const comps = await api('/companies');
    invCompany = comps.find(c => c.id === co) || {};
  } catch(e){ invCompany = {}; }
  try {
    const lg = await api('/invoice-template/logo');
    invLogo = lg.data || null;
  } catch(e){ invLogo = null; }
  try { nextNo = (await api(`/next-invoice-number?company_id=${co}`)).invoice_no; } catch(e){ nextNo=''; }
  openModal(`${isOld?'Add Opening-Balance Old Bill':'New Sale Invoice'} — ${esc(comp.company_name)}`, `
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
      <div class="field"><label>Invoice No</label><div style="display:flex;gap:6px;align-items:center"><input id="inv_no" value="${esc(nextNo)}"><button class="btn sm ghost" onclick="window.__fixNo()">Fix</button></div></div>
      <div class="field"><label>Invoice Date</label><input type="date" id="inv_date" value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="field"><label>Customer</label><select id="inv_cust" onchange="window.__custPick()"><option value="">Select customer…</option>${custs.map(c=>`<option value="${c.id}" data-b="${c.booker_id||''}" data-d="${c.discount_pct}">${esc(c.name)}</option>`).join('')}</select></div>
    </div>
    <div class="panel" style="margin-top:12px;box-shadow:none" id="cust_info"></div>

    ${isOld?`
      <div class="grid" style="margin-top:12px">
        <div class="field"><label>Opening Balance Amount (net)</label><input id="old_amount" type="number" step="0.01" placeholder="0.00"></div>
        <div class="field"><label>Discount Amount</label><input id="old_disc" type="number" step="0.01" placeholder="0.00"></div>
        <div class="field" style="grid-column:1/-1"><label>Opening-Balance Notes</label><textarea id="old_note" rows="2"></textarea></div>
      </div>
      <div style="margin-top:14px;text-align:right"><button class="btn" onclick="window.__saveOldBill()">Save Opening Balance</button></div>
    `:`
      <div style="margin-top:14px">
        <div class="field"><label>Items — Tab on last row adds a new line; use ↓↑ to pick product</label></div>
        <div id="items"></div>
      </div>
      <div class="grid" style="margin-top:14px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
        <div class="field"><label>Discount %</label><input id="disc_pct" type="number" step="0.1" oninput="window.__recalc()"></div>
        <div class="field"><label>Discount Amount</label><input id="disc_amt" readonly></div>
        <div class="field"><label>Delivery Charge</label><input id="deliv" type="number" step="0.01" value="0" oninput="window.__recalc()"></div>
        <div class="field"><label>Subtotal</label><input id="subtotal" readonly></div>
        <div class="field"><label>Net Total</label><input id="net_total" readonly></div>
      </div>
      <div class="grid" style="margin-top:14px">
        <div class="field"><label>Payment Account 1</label><select id="acc1">${accs.map(a=>`<option value="${a.id}">${esc(a.name)} (${a.type})</option>`).join('')}</select></div>
        <div class="field"><label>Payment Account 2 (optional, distinct)</label><select id="acc2"><option value="">— none —</option>${accs.map(a=>`<option value="${a.id}">${esc(a.name)} (${a.type})</option>`).join('')}</select></div>
      </div>
      <div style="margin-top:16px;text-align:right">
        <button class="btn ghost" onclick="window.__cancelForm()">Cancel</button>
        <button class="btn warn" onclick="window.__preview()">Preview & Confirm</button>
      </div>
    `}`, isOld);

  if (!isOld) {
    addRow();
    window.__custPick = () => {
      const c = document.getElementById('inv_cust');
      const opt = c.selectedOptions[0];
      const info = document.getElementById('cust_info');
      if (!opt || !opt.value) { info.innerHTML = ''; return; }
      const cust = customers.find(x => x.id === +opt.value);
      const bk = products[0] && cust.booker ? cust.booker : null;
      info.innerHTML = `
        <div class="head">Customer: ${esc(cust.name)}</div>
        <div style="padding:14px">
          <div class="kv"><span>Address</span><b>${esc(cust.address||'—')}</b></div>
          <div class="kv"><span>Phone</span><b>${esc(cust.phone||'—')}</b></div>
          <div class="kv"><span>Type</span><b>${esc(cust.category||'—')}</b></div>
          <div class="kv"><span>Booker / Rep</span><b>${esc(cust.booker?.name||'None')}</b></div>
          <div class="kv"><span>Approved Discount</span><b>${cust.discount_pct}%</b></div>
        </div>`;
      document.getElementById('disc_pct').value = cust.discount_pct || 0;
      recalc();
    };
    window.__fixNo = async () => {
      const v = document.getElementById('inv_no').value.trim();
      const clash = await api('/invoices?company_id=' + state.company_id);
      if (clash.some(i => i.invoice_no === v)) toast('Number already used — choose a unique one', true);
      else toast('Invoice number OK: ' + v);
    };
    window.__preview = preview;
    window.__cancelForm = () => closeModal();
  } else {
    window.__saveOldBill = async () => {
      const amt = +document.getElementById('old_amount').value || 0;
      const disc = +document.getElementById('old_disc').value || 0;
      if (amt <= 0) return toast('Opening balance amount required', true);
      const cid = +document.getElementById('inv_cust').value;
      if (!cid) return toast('Select a customer', true);
      try {
        await api('/invoices', { method:'POST', body: {
          company_id: state.company_id, customer_id: cid, invoice_date: document.getElementById('inv_date').value,
          is_old_bill: true, opening_balance_note: document.getElementById('old_note').value,
          invoice_no: document.getElementById('inv_no').value || undefined,
        }});
        toast('Opening balance saved'); closeModal(); navigate('invoices');
      } catch(e){ toast(e.message, true); }
    };
  }
}

let rowSeq = 0;
function addRow(initial) {
  const box = document.getElementById('items');
  const r = document.createElement('div');
  r.className = 'grid';
  r.style.cssText = 'grid-template-columns:1.6fr 70px 100px 100px 100px 30px;gap:8px;margin-bottom:8px;align-items:center';
  r.innerHTML = `
    <input list="prodlist" placeholder="Search product (name/SKU) ↓↑" class="row-prod" autocomplete="off">
    <input class="row-qty" type="number" value="${initial?initial.qty:1}" min="0" step="any">
    <input class="row-rate" type="number" value="${initial?initial.rate:0}" step="any">
    <select class="row-type"><option>SALE</option><option>FOC</option><option>DEMO</option></select>
    <input class="row-amt" readonly value="0">
    <button class="btn sm danger" onclick="this.parentElement.remove();recalc()">✕</button>
  `;
  box.appendChild(r);
  const prod = r.querySelector('.row-prod');
  const qty = r.querySelector('.row-qty');
  const rate = r.querySelector('.row-rate');
  const typ = r.querySelector('.row-type');
  const amt = r.querySelector('.row-amt');
  prod.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { pickProduct(e, prod); e.preventDefault(); }
  });
  prod.addEventListener('change', () => {
    const p = products.find(x => x.name === prod.value || x.sku === prod.value);
    if (p) {
      prod.dataset.pid = p.id;
      rate.value = rateRate(p, document.getElementById('inv_cust')?.selectedOptions[0]?.dataset?.d);
      prod.value = p.name + ' (' + p.sku + ')';
    }
    recalc();
  });
  qty.addEventListener('input', recalc);
  rate.addEventListener('input', recalc);
  typ.addEventListener('change', recalc);
  // Tab on last row creates new row
  [...r.querySelectorAll('input,select')].forEach(el => el.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && r === box.lastElementChild) {
      setTimeout(() => { addRow(); box.lastElementChild.querySelector('.row-prod').focus(); }, 0);
    }
  }));
  recalc();
}

function rateRate(p, custDisc) {
  // default from customer category-specific price; salon for salon customers
  const cat = document.getElementById('inv_cust')?.selectedOptions[0]?.text || '';
  return p.salon_rate || p.retail_rate || p.online_rate || 0;
}

function pickProduct(e, input) {
  const q = input.value.toLowerCase();
  const matches = products.filter(p => !q || (p.name + ' ' + p.sku).toLowerCase().includes(q));
  if (!matches.length) return;
  const idx = e.key === 'ArrowDown' ? 0 : matches.length - 1;
  const p = matches[idx];
  input.value = p.name + ' (' + p.sku + ')';
  input.dataset.pid = p.id;
  const rateEl = input.parentElement.querySelector('.row-rate');
  rateEl.value = p.salon_rate || p.retail_rate || p.online_rate || 0;
  recalc();
}

function recalc() {
  const items = [...document.querySelectorAll('#items .grid')];
  let subtotal = 0;
  items.forEach(row => {
    const q = +row.querySelector('.row-qty').value || 0;
    const r = +row.querySelector('.row-rate').value || 0;
    const a = q * r;
    row.querySelector('.row-amt').value = a.toFixed(2);
    if (row.querySelector('.row-type').value === 'SALE') subtotal += a;
  });
  const discPct = +document.getElementById('disc_pct').value || 0;
  const discAmt = subtotal * discPct / 100;
  document.getElementById('subtotal').value = subtotal.toFixed(2);
  document.getElementById('disc_amt').value = discAmt.toFixed(2);
  const deliv = +document.getElementById('deliv').value || 0;
  document.getElementById('net_total').value = (subtotal - discAmt + deliv).toFixed(2);
}

// Build the on-screen invoice preview mirroring the branded PDF template.
function renderTemplatePreview({ lines, cust, subtotal, discPct, discAmt, deliv, net, invoice_no, date }) {
  const t = invTemplate || {};
  const co = invCompany || {};
  const T = (k, d) => (t[k] !== undefined && t[k] !== '' ? t[k] : d);
  const accent = T('accent_color', '#1f2937');
  const currency = T('currency', 'PKR');
  const num = (n) => Number(n||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n) => `${currency} ${num(n)}`;
  const coName = co.name || T('company_name', '');
  const coAddr = co.address || T('company_address', '');
  const coPhone = co.phone || T('company_phone', '');
  const coEmail = co.email || T('company_email', '');
  const showLogo = t.show_logo !== false && invLogo;
  const logoImg = invLogo ? `data:image/jpeg;base64,${invLogo}` : '';
  // account details (template)
  const accLines = [];
  if (t.show_account_details !== false) {
    if (t.account_bank) accLines.push(`<div>${esc(t.account_bank_name||'Bank')} : ${esc(t.account_title||'')}  ${esc(t.account_iban||'')}</div>`);
    if (t.account_easypaisa) accLines.push(`<div>EASYPAISA : ${esc(t.account_easypaisa)}</div>`);
  }
  const words = amountInWords(net, currency);
  return `
  <div style="border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff;font-family:'Segoe UI',Arial,sans-serif;color:#111827">
    <div style="padding:18px 20px;display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap">
      ${showLogo?`<div style="width:54px;height:54px;overflow:hidden;border-radius:6px;border:1px solid var(--line);display:grid;place-items:center"><img src="${logoImg}" style="max-width:100%;max-height:100%;object-fit:contain"></div>`:''}
      <div style="flex:1;text-align:center;min-width:180px">
        ${coName?`<div style="font-size:20px;font-weight:800;color:${accent}">${esc(coName)}</div>`:''}
        ${coAddr?`<div style="font-size:11.5px;color:#4b5563">${esc(coAddr)}</div>`:''}
        ${coPhone?`<div style="font-size:11.5px;color:#4b5563">${esc(coPhone)}</div>`:''}
        ${coEmail?`<div style="font-size:11.5px;color:#4b5563">${esc(coEmail)}</div>`:''}
      </div>
      <div style="text-align:right">
        <div style="font-size:22px;font-weight:800;color:${accent}">INVOICE</div>
        <div style="font-size:11.5px;font-weight:700">Invoice # : ${esc(invoice_no)}</div>
        <div style="font-size:11.5px">Date : ${esc(date)}</div>
      </div>
    </div>
    <div style="border-top:2px solid ${accent}"></div>
    <div style="padding:16px 20px;display:flex;gap:20px;flex-wrap:wrap">
      <div style="flex:1;min-width:220px">
        <div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:.5px">BILL TO</div>
        <div style="font-size:14px;font-weight:700">${esc(cust.name||'')}</div>
        ${cust.address?`<div style="font-size:11.5px;color:#4b5563">${esc(cust.address)}</div>`:''}
        ${cust.phone?`<div style="font-size:11.5px;color:#4b5563">${esc(cust.phone)}</div>`:''}
      </div>
      <div style="font-size:11.5px;min-width:180px">
        ${t.show_terms !== false?`<div>Terms : ${esc(T('default_terms','CASH'))}</div>`:''}
        ${t.show_rep !== false && cust.booker?.name?`<div>Rep : ${esc(cust.booker.name)}</div>`:''}
        ${accLines.length?`<div style="margin-top:8px;padding:10px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;font-size:10.5px;color:#374151">ACCOUNT DETAILS<br>${accLines.join('')}</div>`:''}
      </div>
    </div>
    <div style="padding:0 20px">
      <table style="width:100%;border-collapse:collapse;font-size:12.5px">
        <thead><tr style="background:${accent};color:#fff">
          <th style="padding:8px 10px;text-align:left;font-weight:700">Item</th>
          <th style="padding:8px 10px;text-align:right;font-weight:700">Qty</th>
          <th style="padding:8px 10px;text-align:right;font-weight:700">Rate</th>
          <th style="padding:8px 10px;text-align:right;font-weight:700">Amount</th>
        </tr></thead>
        <tbody>${lines.map((l,i)=>`<tr style="background:${i%2? '#fff':'#fafbfc'};border-bottom:1px solid #e5e7eb">
          <td style="padding:8px 10px">${esc(l.description)}</td>
          <td style="padding:8px 10px;text-align:right">${l.qty}</td>
          <td style="padding:8px 10px;text-align:right">${num(l.rate)}</td>
          <td style="padding:8px 10px;text-align:right;font-weight:600">${num(l.qty*l.rate)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <div style="padding:12px 20px;display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start">
      <div style="flex:1;min-width:220px;font-size:12px;color:#374151">
        <div style="font-weight:700;margin-bottom:6px">SUB-TOTAL (${lines.length} items)</div>
        <div style="font-weight:700;margin-top:8px">Amount in words:</div>
        <div style="font-size:12px;font-weight:600;text-transform:capitalize">${esc(words)}</div>
      </div>
      <div style="min-width:240px;margin-left:auto;font-size:12.5px">
        <div style="display:flex;justify-content:space-between;padding:4px 0"><span style="font-weight:700">SUB-TOTAL</span><span>${num(subtotal)}</span></div>
        ${discAmt?`<div style="display:flex;justify-content:space-between;padding:4px 0;color:#b91c1c"><span>DISCOUNT ${discPct}%</span><span>-${num(discAmt)}</span></div>`:''}
        ${deliv?`<div style="display:flex;justify-content:space-between;padding:4px 0"><span>DELIVERY</span><span>${num(deliv)}</span></div>`:''}
        <div style="display:flex;justify-content:space-between;align-items:center;background:${accent};color:#fff;padding:9px 12px;border-radius:6px;font-weight:800;margin-top:4px">
          <span>GRAND TOTAL</span><span>${money(net)}</span>
        </div>
      </div>
    </div>
    ${T('footer_note','')?`<div style="margin:6px 20px 0;border-top:1px solid #e5e7eb;padding:10px 0 16px;font-size:10.5px;color:#6b7280">
      <b>NOTE:</b> ${esc(T('footer_note').replace(/^NOTE:\s*/i,''))}
    </div>`:''}
  </div>`;
}

async function preview() {
  const items = [...document.querySelectorAll('#items .grid')];
  const lines = items.map(row => ({
    product_id: row.querySelector('.row-prod').dataset.pid || null,
    description: row.querySelector('.row-prod').value,
    qty: +row.querySelector('.row-qty').value || 0,
    rate: +row.querySelector('.row-rate').value || 0,
    item_type: row.querySelector('.row-type').value,
  })).filter(l => l.qty > 0);
  if (!lines.length) return toast('Add at least one item', true);
  const cid = +document.getElementById('inv_cust').value;
  if (!cid) return toast('Select a customer', true);
  const cust = customers.find(x => x.id === cid);
  const acc1 = +document.getElementById('acc1').value;
  const acc2 = +document.getElementById('acc2').value || null;
  const acc1o = accounts.find(a => a.id === acc1);
  const acc2o = accounts.find(a => a.id === acc2);
  const subtotal = +document.getElementById('subtotal').value;
  const discPct = +document.getElementById('disc_pct').value || 0;
  const discAmt = +document.getElementById('disc_amt').value;
  const deliv = +document.getElementById('deliv').value || 0;
  const net = +document.getElementById('net_total').value;

  window.__previewData = { lines, company_id: state.company_id, customer_id: cid, invoice_date: document.getElementById('inv_date').value,
    discount_pct: discPct, delivery_charge: deliv, payment_account_id_1: acc1, payment_account_id_2: acc2, invoice_no: document.getElementById('inv_no').value || undefined };

  openModal('Preview — Invoice Template', `
      <div style="margin-bottom:14px;display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn ok" onclick="window.__confirmSave()">✓ Confirm & Save</button>
        <button class="btn ghost" onclick="window.__downloadDraft()">Download PDF</button>
        <button class="btn" onclick="window.__backForm()">← Edit</button>
      </div>
      ${renderTemplatePreview({ lines, cust, subtotal, discPct, discAmt, deliv, net,
        invoice_no: window.__previewData.invoice_no || nextNo, date: window.__previewData.invoice_date })}`, true);

  window.__confirmSave = async () => {
    try {
      await api('/invoices', { method: 'POST', body: window.__previewData });
      toast('Invoice saved'); closeModal(); navigate('invoices');
    } catch(e){ toast(e.message, true); }
  };
  window.__downloadDraft = async () => {
    window.open(`/api/next-invoice-number?company_id=${state.company_id}`, '_blank');
    toast('Draft PDF requires a saved invoice — confirm to save first');
  };
  window.__backForm = () => showForm(false);
}

async function viewReturn(id) {
  const data = await api(`/invoices/${id}/returnable`);
  const returnableLines = data.lines.filter(l => l.available_qty > 0);
  if (!returnableLines.length) { toast('No items available to return', true); return; }
  openModal(`Sale Return — ${esc(data.invoice_no)}`, `
    <div style="margin-bottom:14px;display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn ok" onclick="window.__saveReturn(${id})">✓ Save Return</button>
      <button class="btn ghost" onclick="window.__closeModal()">Cancel</button>
    </div>
    <div class="kv"><span>Invoice</span><b>${esc(data.invoice_no)}</b></div>
    <div class="kv"><span>Customer</span><b>${esc(data.customer_name)}</b></div>
    <div class="kv"><span>Company</span><b>${esc(data.company_name)}</b></div>
    <div class="kv"><span>Date</span><b>${fmtDate(data.invoice_date)}</b></div>
    <div class="kv"><span>Outstanding</span><b style="color:${data.outstanding>0?'var(--bad)':'var(--ok)'}">${fmtMoney(data.outstanding)}</b></div>
    <div style="margin-top:12px" class="muted">Enter return qty (max = available). Returning SALE items reduces the customer's outstanding and adds the qty back to stock.</div>
    <table style="margin-top:8px"><thead><tr><th>Item</th><th>Type</th><th>Rate</th><th>Available</th><th>Return Qty</th><th>Amount</th></tr></thead>
      <tbody>
      ${returnableLines.map(l=>`<tr>
        <td>${esc(l.description)}</td><td>${l.item_type}</td>
        <td>${fmtMoney(l.rate)}</td><td>${l.available_qty}</td>
        <td><input class="rt-qty" data-il="${l.id}" data-rate="${l.rate}" data-type="${l.item_type}" type="number" min="0" max="${l.available_qty}" value="0" oninput="window.__rtRecalc()"></td>
        <td class="rt-amt" style="text-align:right">0.00</td>
      </tr>`).join('')}
      </tbody>
      <tfoot><tr><td colspan=5 style="text-align:right;font-weight:800">Return Amount (SALE)</td><td id="rt_total" style="text-align:right;font-weight:800">0.00</td></tr></tfoot>
    </table>
    <div class="grid" style="margin-top:14px">
      <div class="field"><label>Return Date</label><input id="rt_date" type="date" value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="field"><label>Reference / Note</label><input id="rt_ref" placeholder="optional"></div>
    </div>`, true);

  window.__rtRecalc = () => {
    let total = 0;
    document.querySelectorAll('.rt-qty').forEach(inp => {
      const qty = +inp.value || 0;
      const rate = +inp.dataset.rate;
      const type = inp.dataset.type;
      const amt = type === 'SALE' ? qty * rate : 0;
      inp.closest('tr').querySelector('.rt-amt').textContent = amt.toFixed(2);
      total += amt;
    });
    document.getElementById('rt_total').textContent = total.toFixed(2);
  };
  window.__saveReturn = async (iid) => {
    const lines = [...document.querySelectorAll('.rt-qty')].map(inp => ({
      invoice_line_id: +inp.dataset.il,
      product_id: null,
      qty: +inp.value || 0,
      item_type: inp.dataset.type,
    })).filter(l => l.qty > 0);
    if (!lines.length) return toast('Enter a return qty for at least one item', true);
    try {
      const r = await api('/sale-returns', { method:'POST', body:{
        invoice_id: iid, return_date: document.getElementById('rt_date').value,
        reference: document.getElementById('rt_ref').value, note: document.getElementById('rt_ref').value, lines,
      }});
      toast('Sale return saved — stock added, outstanding reduced');
      closeModal(); viewInvoiceDetail(iid);
    } catch(e){ toast(e.message, true); }
  };
}

async function viewInvoiceDetail(id) {
  const inv = await api(`/invoices/${id}`);
  const content = document.getElementById('content');
  const canEdit = !inv.is_old_bill && inv.status === 'posted' && inv.outstanding > 0 && can('edit', inv.company_id);
  content.innerHTML = `
  <div class="row-actions" style="margin-bottom:14px">
    <button class="btn ghost" onclick="window.__nav('invoices')">← Back</button>
    <button class="btn" onclick="window.__dlPdf()">Download PDF</button>
    ${canEdit?`<button class="btn warn" onclick="window.__editInv()">Edit</button>`:''}
    ${can('add', inv.company_id)&&inv.status==='posted'?`<button class="btn" onclick="window.__returnInv()">↩ Sale Return</button>`:''}
    ${can('approve', inv.company_id)&&inv.status==='posted'?`<button class="btn danger" onclick="window.__voidInv()">Void</button>`:''}
    ${inv.is_old_bill?'<span class="pill y">Opening-Balance (Old Bill) — no stock movements</span>':''}
  </div>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
    <div class="panel"><div class="head">Invoice ${esc(inv.invoice_no)}</div><div style="padding:16px">
      <div class="kv"><span>Company</span><b>${esc(inv.company_name)}</b></div>
      <div class="kv"><span>Date</span><b>${fmtDate(inv.invoice_date)}</b></div>
      <div class="kv"><span>Customer</span><b>${esc(inv.customer_name)}</b></div>
      <div class="kv"><span>Address</span><b>${esc(inv.customer_address||'—')}</b></div>
      <div class="kv"><span>Phone</span><b>${esc(inv.customer_phone||'—')}</b></div>
      <div class="kv"><span>Booker</span><b>${esc(inv.booker_name||'—')}</b></div>
      <div class="kv"><span>Payment Account(s)</span><b>${esc(inv.account_1||'—')}${inv.account_2?(' + '+esc(inv.account_2)):''}</b></div>
      <div class="kv"><span>Outstanding</span><b style="color:${inv.outstanding>0?'var(--bad)':'var(--ok)'}">${fmtMoney(inv.outstanding)}</b></div>
    </div></div>
    <div class="panel"><div class="head">Line Items</div><div class="tbl-wrap"><table>
      <tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th><th>Type</th></tr>
      ${inv.lines.map(l=>`<tr><td>${esc(l.description)}</td><td>${l.qty}</td><td>${fmtMoney(l.rate)}</td><td>${fmtMoney(l.amount)}</td><td>${l.item_type}</td></tr>`).join('')}
      <tr><td colspan=3 style="text-align:right;font-weight:700">Subtotal</td><td>${fmtMoney(inv.subtotal)}</td></tr>
      <tr><td colspan=3 style="text-align:right">Discount</td><td>-${fmtMoney(inv.discount_amount)}</td></tr>
      <tr><td colspan=3 style="text-align:right">Delivery</td><td>+${fmtMoney(inv.delivery_charge)}</td></tr>
      <tr><td colspan=3 style="text-align:right;font-weight:800">Net</td><td style="font-weight:800">${fmtMoney(inv.net_total)}</td></tr>
    </table></div></div>
  </div>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
    <div class="panel"><div class="head">Payment History</div>
      ${inv.payments.length?`<div class="tbl-wrap"><table><tr><th>Amount</th><th>Method</th><th>Date</th><th>Status</th></tr>${inv.payments.map(p=>`<tr><td>${fmtMoney(p.amount)}</td><td>${esc(p.method)}</td><td>${fmtDate(p.paid_at)}</td><td>${p.reversed_at?'<span class="pill r">Reversed</span>':'<span class="pill g">Posted</span>'}</td></tr>`).join('')}</table></div>`:`<div class="empty">No payments recorded</div>`}
    </div>
    <div class="panel"><div class="head">Cheque Context</div>
      ${inv.cheques.length?`<div class="tbl-wrap"><table><tr><th>Cheque</th><th>Bank</th><th>Amount</th><th>Status</th></tr>${inv.cheques.map(c=>`<tr><td>${esc(c.cheque_number)}</td><td>${esc(c.bank||'')}</td><td>${fmtMoney(c.amount)}</td><td><span class="pill ${c.status==='cleared'?'g':c.status==='bounced'||c.status==='cancelled'?'r':'b'}">${c.status}</span></td></tr>`).join('')}</table></div>`:`<div class="empty">No cheques for this invoice</div>`}
    </div>
  </div>`;

  window.__dlPdf = () => window.open(`/api/invoices/${id}/export`, '_blank');
  window.__returnInv = () => viewReturn(id);
  window.__editInv = () => editInvoice(id);
  window.__voidInv = async () => {
    const reason = prompt('Void reason (required):');
    if (!reason) return;
    try { await api(`/invoices/${id}/void`, { method:'POST', body:{ audit_reason: reason } }); toast('Invoice voided'); viewInvoiceDetail(id); } catch(e){ toast(e.message, true); }
  };
}

async function editInvoice(id) {
  const inv = await api(`/invoices/${id}`);
  const custs = (await api(`/customers?company_id=${inv.company_id}`)).filter(c=>c.is_active);
  const prods = await api(`/products?company_id=${inv.company_id}`);
  const content = document.getElementById('content');
  content.innerHTML = `<div class="panel"><div class="head">Edit Invoice ${esc(inv.invoice_no)}</div><div style="padding:18px">
    <div class="field"><label>Audit Reason (required)</label><input id="edit_reason"></div>
    <div class="field" style="margin-top:8px"><label>Customer</label><select id="edit_cust">${custs.map(c=>`<option value="${c.id}" ${c.id===inv.customer_id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>
    <div style="margin-top:12px"><div class="field"><label>Items</label></div><div id="edit_items"></div></div>
    <div class="grid" style="margin-top:12px">
      <div class="field"><label>Discount %</label><input id="edit_disc" value="${inv.discount_pct}"></div>
      <div class="field"><label>Delivery</label><input id="edit_deliv" value="${inv.delivery_charge}"></div>
      <div class="field"><label>New Net</label><input id="edit_net" readonly></div>
    </div>
    <div style="margin-top:16px;text-align:right"><button class="btn" onclick="window.__saveEdit(${id})">Save Edit</button></div>
  </div></div>`;
  const box = document.getElementById('edit_items');
  inv.lines.forEach(l => {
    const r = document.createElement('div');
    r.className='grid'; r.style.cssText='grid-template-columns:1.6fr 70px 100px 90px;gap:8px;margin-bottom:8px';
    r.innerHTML = `<input class="e-prod" value="${esc(l.description)}"><input class="e-qty" type="number" value="${l.qty}"><input class="e-rate" type="number" value="${l.rate}"><select class="e-type"><option ${l.item_type==='SALE'?'selected':''}>SALE</option><option ${l.item_type==='FOC'?'selected':''}>FOC</option><option ${l.item_type==='DEMO'?'selected':''}>DEMO</option></select>`;
    box.appendChild(r);
  });
  const recalcEdit = () => {
    const rows=[...document.querySelectorAll('#edit_items .grid')];
    let st=0; rows.forEach(x=>{ if(x.querySelector('.e-type').value==='SALE') st += (+x.querySelector('.e-qty').value||0)*(+x.querySelector('.e-rate').value||0); });
    const disc=st*(+document.getElementById('edit_disc').value||0)/100;
    const net=st-disc+(+document.getElementById('edit_deliv').value||0);
    document.getElementById('edit_net').value=net.toFixed(2);
  };
  box.querySelectorAll('input,select').forEach(el=>el.addEventListener('input',recalcEdit));
  document.getElementById('edit_disc').addEventListener('input',recalcEdit);
  document.getElementById('edit_deliv').addEventListener('input',recalcEdit);
  recalcEdit();
  window.__saveEdit = async (iid) => {
    const reason = document.getElementById('edit_reason').value;
    if (!reason) return toast('Audit reason required', true);
    const lines = [...document.querySelectorAll('#edit_items .grid')].map(r=>({
      product_id: null, description: r.querySelector('.e-prod').value,
      qty: +r.querySelector('.e-qty').value||0, rate: +r.querySelector('.e-rate').value||0,
      item_type: r.querySelector('.e-type').value,
    })).filter(l=>l.qty>0);
    try {
      await api(`/invoices/${iid}/edit`, { method:'POST', body:{
        customer_id: +document.getElementById('edit_cust').value,
        discount_pct: +document.getElementById('edit_disc').value||0,
        delivery_charge: +document.getElementById('edit_deliv').value||0,
        lines, audit_reason: reason,
      }});
      toast('Invoice updated'); viewInvoiceDetail(iid);
    } catch(e){ toast(e.message, true); }
  };
}
