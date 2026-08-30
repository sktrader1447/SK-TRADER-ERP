import { api, state, fmtMoney, fmtDate, esc } from './api.js';
import { navigate, toast } from './app.js';

function companyOptions(members) {
  return members.map(m => `<option value="${m.company_id}">${esc(m.company_name)}</option>`).join('');
}

export async function viewPurchases() {
  const members = state.members;
  const [companies, products, ledger, purchases] = await Promise.all([
    api('/companies'), api('/products?limit=5000'), api('/purchase-ledger'), api('/supplier-purchases'),
  ]);
  const prodOpts = products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  return {
    html: `
    <div class="panel"><div class="head">Add Purchase Invoice <span class="pill p">Stock increases automatically</span></div>
      <div style="padding:16px">
        <div class="grid">
          <div class="field"><label>Company</label><select id="pc_company">${companyOptions(members)}</select></div>
          <div class="field"><label>Supplier</label><input id="pc_supplier" placeholder="Supplier name"></div>
          <div class="field"><label>Invoice Date</label><input id="pc_date" type="date" value="${new Date().toISOString().slice(0,10)}"></div>
          <div class="field"><label>Invoice No / Reference</label><input id="pc_ref" placeholder="e.g. PUR-2026-001"></div>
        </div>
        <div class="muted" style="margin:14px 0 6px;font-weight:700">Items (quantity × rate)</div>
        <div class="tbl-wrap"><table id="pc_items_tbl">
          <tr><th style="width:55%">Product</th><th>Qty</th><th>Rate</th><th>Amount</th><th></th></tr>
        </table></div>
        <button class="btn sm ghost" onclick="window.__pcAddLine()">+ Add Item</button>
        <div class="grid" style="margin-top:14px">
          <div class="field"><label>Total Amount <span class="muted">(auto if items added)</span></label><input id="pc_amount" type="number" step="0.01"></div>
          <div class="field"><label>Paid Now</label><input id="pc_paid" type="number" step="0.01"></div>
        </div>
        <button class="btn" style="margin-top:12px" onclick="window.__pcSave()">Save Purchase Invoice</button>
      </div>
    </div>

    <div class="panel"><div class="head">Upload Purchase Invoice <span class="pill p">Excel · auto stock + ledger</span></div>
      <div style="padding:16px">
        <div class="muted" style="margin-bottom:10px">Company se stock aane par saath me purchase invoice aati hai. Kai items ek-ek karne ki bajaye <b>Excel file upload</b> karo — stock aur Purchase Ledger apne aap update ho jayenge.</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <button class="btn ghost" onclick="window.__dlTemplate()">⬇ Download Template</button>
          <input type="file" id="pu_file" accept=".xlsx,.xls" style="max-width:280px">
          <button class="btn" onclick="window.__puUpload()">Upload & Import</button>
        </div>
        <div id="pu_result" style="margin-top:12px"></div>
      </div>
    </div>

    <div class="panel"><div class="head">Purchase Ledger</div>
      <div class="tbl-wrap"><table>
        <tr><th>Date</th><th>Invoice No</th><th>Debit</th><th>Credit</th><th>Balance</th></tr>
        ${ledger.map(l=>`<tr>
          <td>${fmtDate(l.invoice_date)}</td><td>${esc(l.invoice_no)}</td>
          <td>${fmtMoney(l.debit)}</td><td>${fmtMoney(l.credit)}</td>
          <td style="font-weight:700">${fmtMoney(l.balance)}</td>
        </tr>`).join('')||'<tr><td colspan=5 class="empty">No purchases yet</td></tr>'}
      </table></div>
    </div>

    <div class="panel"><div class="head">Purchase Invoices</div>
      <div class="tbl-wrap"><table>
        <tr><th>Date</th><th>Invoice No</th><th>Supplier</th><th>Company</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Items</th><th></th></tr>
        ${purchases.map(p=>`<tr>
          <td>${fmtDate(p.invoice_date)}</td><td>${esc(p.reference||'PUR-'+p.id)}</td><td>${esc(p.supplier)}</td>
          <td>${esc(p.company_name)}</td><td>${fmtMoney(p.amount)}</td><td>${fmtMoney(p.paid_amount)}</td>
          <td style="font-weight:700">${fmtMoney(p.balance)}</td>
          <td>${p.lines.map(l=>`${esc(l.description)} ×${l.qty} @${l.rate}`).join('<br>')||'<span class="muted">—</span>'}</td>
          <td>${p.balance>0?`<button class="btn sm ghost" onclick="window.__pcPay(${p.id})">Pay</button>`:''}</td>
        </tr>`).join('')||'<tr><td colspan=9 class="empty">No purchases yet</td></tr>'}
      </table></div>
    </div>`,
    mount: () => {
      window.__dlTemplate = async () => {
        try {
          const blob = await api('/purchase-template');
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = 'purchase-invoice-template.xlsx';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
        } catch(e){ toast(e.message, true); }
      };
      window.__puUpload = async () => {
        const file = document.getElementById('pu_file').files[0];
        if (!file) return toast('Choose a .xlsx file first', true);
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result || '').split(',')[1] || '';
          const res = document.getElementById('pu_result');
          res.innerHTML = '<div class="muted">Importing…</div>';
          try {
            const data = await api('/supplier-purchases/upload', { method:'POST', body:{ data: base64 } });
            const okMsg = `Imported ${data.invoices_created} invoice(s), ${data.items_imported} item(s). Stock + ledger updated.`;
            const errMsg = data.errors && data.errors.length ? ' Skipped: ' + data.errors.slice(0,4).join(' | ') : '';
            toast(okMsg + errMsg);
            navigate('purchases');
          } catch(e){
            toast('Import failed: ' + e.message, true);
            navigate('purchases');
          }
        };
        reader.readAsDataURL(file);
      };
      const addLine = () => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><select class="pc_prod" onchange="window.__pcRecalc(this)">${prodOpts}</select></td>
          <td><input class="pc_qty" type="number" min="0" step="1" value="1" oninput="window.__pcRecalc(this)"></td>
          <td><input class="pc_rate" type="number" min="0" step="0.01" value="0" oninput="window.__pcRecalc(this)"></td>
          <td class="pc_amt">0.00</td>
          <td><button class="btn sm danger" onclick="this.closest('tr').remove();window.__pcRecalc()">✕</button></td>`;
        document.getElementById('pc_items_tbl').appendChild(tr);
        window.__pcRecalc();
      };
      window.__pcAddLine = addLine;
      addLine(); // start with one blank line
      window.__pcRecalc = () => {
        let total = 0;
        document.querySelectorAll('#pc_items_tbl tr:not(:first-child)').forEach(tr => {
          const prod = tr.querySelector('.pc_prod'); const qty = tr.querySelector('.pc_qty'); const rate = tr.querySelector('.pc_rate');
          if (!prod || !qty || !rate) return;
          // default rate to product purchase rate
          if (!rate.value || Number(rate.value)===0) {
            const p = products.find(x=>x.id===Number(prod.value));
            if (p) rate.value = p.purchase_rate;
          }
          const amt = (Number(qty.value)||0)*(Number(rate.value)||0);
          tr.querySelector('.pc_amt').textContent = amt.toFixed(2);
          total += amt;
        });
        const amtInput = document.getElementById('pc_amount');
        if (document.querySelectorAll('#pc_items_tbl tr:not(:first-child)').length && total>0) amtInput.value = total.toFixed(2);
      };
      // company change re-defaults rates
      document.getElementById('pc_company').addEventListener('change', window.__pcRecalc);

      window.__pcSave = async () => {
        const items = [...document.querySelectorAll('#pc_items_tbl tr:not(:first-child)')].map(tr => ({
          product_id: +tr.querySelector('.pc_prod').value,
          qty: +tr.querySelector('.pc_qty').value || 0,
          rate: +tr.querySelector('.pc_rate').value || 0,
        })).filter(i=>i.product_id && i.qty>0);
        if (!items.length && !document.getElementById('pc_amount').value) return toast('Add items or an amount', true);
        try {
          await api('/supplier-purchases', { method:'POST', body:{
            company_id: +document.getElementById('pc_company').value,
            supplier: document.getElementById('pc_supplier').value,
            invoice_date: document.getElementById('pc_date').value,
            reference: document.getElementById('pc_ref').value,
            amount: +document.getElementById('pc_amount').value || undefined,
            paid_amount: +document.getElementById('pc_paid').value || 0,
            items,
          }});
          toast('Purchase invoice saved — stock updated');
          navigate('purchases');
        } catch(e){ toast(e.message, true); }
      };
      window.__pcPay = async (id) => {
        const amt = prompt('Payment amount:');
        if (!amt || Number(amt)<=0) return;
        try { await api(`/supplier-purchases/${id}/pay`, { method:'POST', body:{ amount:+amt } }); toast('Payment recorded'); navigate('purchases'); } catch(e){ toast(e.message, true); }
      };
    }
  };
}
