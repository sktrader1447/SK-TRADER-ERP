import { api, state, fmtMoney, fmtDate, esc, can } from './api.js';
import { navigate, toast } from './app.js';
import { CUSTOMER_CATEGORIES } from './companies.js';

const CATS = ['', ...CUSTOMER_CATEGORIES];

export async function viewCustomers() {
  const custs = await api('/customers' + (state.company_id ? `?company_id=${state.company_id}` : ''));
  const bookers = await api('/bookers' + (state.company_id ? `?company_id=${state.company_id}` : ''));
  const companies = await api('/companies');
  custs.sort((a,b)=>a.name.localeCompare(b.name));
  const letters = [...new Set(custs.map(c=>c.name[0].toUpperCase()))].sort();
  return {
    html: `
    <div class="row-actions" style="margin-bottom:16px">
      <button class="btn" onclick="window.__addCust()">+ New Customer</button>
      <div class="spacer" style="flex:1"></div>
      <div style="display:flex;gap:4px;flex-wrap:wrap" id="az">${letters.map(l=>`<button class="btn sm ghost" onclick="window.__az('${l}')">${l}</button>`).join('')}</div>
      <input placeholder="Search name…" oninput="window.__srch(this.value)">
    </div>
    <div class="panel"><div class="tbl-wrap"><table>
      <tr><th>Name</th><th>Phone</th><th>Type</th><th>Booker</th><th>Discount</th><th>Companies</th><th>Status</th><th></th></tr>
      <tbody id="custRows">
      ${custs.map(c=>`<tr data-name="${esc(c.name.toLowerCase())}">
        <td><a href="#" onclick="window.__custDetail(${c.id});return false">${esc(c.name)}</a></td>
        <td>${esc(c.phone||'—')}</td><td>${esc(c.category||'—')}</td>
        <td>${esc(c.booker?.name||'—')}</td><td>${c.discount_pct}%</td>
        <td>${(c.companies||[]).map(x=>esc(x.name)).join(', ')}</td>
        <td>${c.is_active?'<span class="pill g">Active</span>':'<span class="pill r">Inactive</span>'}</td>
        <td><button class="btn sm ghost" onclick="window.__custDetail(${c.id})">Detail</button></td>
      </tr>`).join('')}
      </tbody>
    </table></div></div>
    <div id="custForm"></div>`,
    mount: () => {
      window.__az = (l) => { [...document.querySelectorAll('#custRows tr')].forEach(r=>{ r.style.display = r.dataset.name.startsWith(l.toLowerCase())?'':'none'; }); };
      window.__srch = (q) => { [...document.querySelectorAll('#custRows tr')].forEach(r=>{ r.style.display = r.dataset.name.includes(q.toLowerCase())?'':'none'; }); };
      window.__addCust = () => customerForm(null, bookers, companies);
      window.__custDetail = (id) => customerDetail(id);
    }
  };
}

async function customerForm(id, bookers, companies) {
  let c = null;
  if (id) c = await api(`/customers/${id}`);
  const f = document.getElementById('custForm');
  f.innerHTML = `<div class="panel"><div class="head">${id?'Edit Customer':'New Customer'}</div><div style="padding:18px">
    <div class="grid">
      <div class="field"><label>Name *</label><input id="cu_name" value="${c?esc(c.name):''}"></div>
      <div class="field"><label>Full Address</label><input id="cu_addr" value="${c?esc(c.address||''):''}"></div>
      <div class="field"><label>Contact Number</label><input id="cu_phone" value="${c?esc(c.phone||''):''}"></div>
      <div class="field"><label>Category / Type</label><select id="cu_cat">${CATS.map(x=>`<option value="${esc(x)}" ${c&&c.category===x?'selected':''}>${x||'Select category…'}</option>`).join('')}</select></div>
      <div class="field"><label>Approved Discount %</label><input id="cu_disc" type="number" step="0.1" value="${c?c.discount_pct:0}"></div>
      <div class="field"><label>Assigned Booker</label><select id="cu_booker"><option value="">— none —</option>${bookers.map(b=>`<option value="${b.id}" ${c&&c.booker_id===b.id?'selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
    </div>
    <div class="field" style="margin-top:12px"><label>Assign to Companies (invoice visibility per company)</label>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">
        ${companies.filter(cp=>cp.is_active).map(cp=>`<label style="display:flex;gap:5px;align-items:center"><input type="checkbox" class="cu_comp" value="${cp.id}" ${c&&(c.companies||[]).some(x=>x.id===cp.id)?'checked':''}> ${esc(cp.name)}</label>`).join('')}
      </div>
      <div class="muted" style="margin-top:4px">Multi-company customers cannot be assigned a single company booker until per-company reps exist.</div>
    </div>
    <div style="margin-top:14px;text-align:right">
      <button class="btn ghost" onclick="document.getElementById('custForm').innerHTML=''">Cancel</button>
      <button class="btn" onclick="window.__saveCust(${id||0})">Save</button>
    </div>
  </div></div>`;
  window.__saveCust = async (cid) => {
    const company_ids = [...document.querySelectorAll('.cu_comp:checked')].map(x=>+x.value);
    const body = {
      name: document.getElementById('cu_name').value, address: document.getElementById('cu_addr').value,
      phone: document.getElementById('cu_phone').value, category: document.getElementById('cu_cat').value,
      discount_pct: +document.getElementById('cu_disc').value||0, booker_id: +document.getElementById('cu_booker').value||null,
      company_ids,
    };
    try {
      if (cid) await api(`/customers/${cid}`, { method:'POST', body });
      else await api('/customers', { method:'POST', body });
      toast('Customer saved'); navigate('customers');
    } catch(e){ toast(e.message, true); }
  };
}

async function customerDetail(id) {
  const c = await api(`/customers/${id}`);
  const content = document.getElementById('content');
  const bookers = await api('/bookers');
  const companies = await api('/companies');
  content.innerHTML = `
  <div class="row-actions" style="margin-bottom:14px">
    <button class="btn ghost" onclick="window.__nav('customers')">← Back</button>
    <button class="btn" onclick="window.__editCust(${id})">Edit</button>
    <button class="btn ${c.is_active?'danger':'ok'}" onclick="window.__toggleCust(${id})">${c.is_active?'Mark Inactive':'Activate'}</button>
  </div>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
    <div class="panel"><div class="head">Customer Profile</div><div style="padding:16px">
      <div class="kv"><span>Name</span><b>${esc(c.name)}</b></div>
      <div class="kv"><span>Address</span><b>${esc(c.address||'—')}</b></div>
      <div class="kv"><span>Phone</span><b>${esc(c.phone||'—')}</b></div>
      <div class="kv"><span>Category / Type</span><b>${esc(c.category||'—')}</b></div>
      <div class="kv"><span>Assigned Booker / Rep</span><b>${esc(c.booker?.name||'Unassigned')}</b></div>
      <div class="kv"><span>Approved Discount</span><b>${c.discount_pct}%</b></div>
      <div class="kv"><span>Companies</span><b>${(c.companies||[]).map(x=>esc(x.name)).join(', ')||'—'}</b></div>
      <div class="kv"><span>Status</span><b>${c.is_active?'<span class="pill g">Active</span>':'<span class="pill r">Inactive</span>'}</b></div>
    </div></div>
    <div class="panel"><div class="head">Financial Context</div><div style="padding:16px">
      <div class="kv"><span>Total Sales</span><b>${fmtMoney(c.financials.sales)}</b></div>
      <div class="kv"><span>Recovered</span><b>${fmtMoney(c.financials.recovered)}</b></div>
      <div class="kv"><span>Returns</span><b>${fmtMoney(c.financials.returns)}</b></div>
      <div class="kv"><span>Outstanding</span><b style="color:${c.financials.outstanding>0?'var(--bad)':'var(--ok)'}">${fmtMoney(c.financials.outstanding)}</b></div>
    </div></div>
  </div>
  <div class="panel"><div class="head">Invoices</div><div class="tbl-wrap"><table>
    <tr><th>Invoice</th><th>Date</th><th>Company</th><th>Total</th><th></th></tr>
    ${(c.invoices||[]).map(i=>`<tr><td>${esc(i.invoice_no)}</td><td>${fmtDate(i.invoice_date)}</td><td>${esc(i.company_id)}</td><td>${fmtMoney(i.net_total)}</td><td><button class="btn sm ghost" onclick="window.__nav('invoices');setTimeout(()=>window.__viewInv&&window.__viewInv(${i.id}),300)">Open</button></td></tr>`).join('')||'<tr><td colspan=5 class="empty">No invoices</td></tr>'}
  </table></div></div>
  <div id="custForm"></div>`;
  window.__editCust = () => customerForm(id, bookers, companies);
  window.__toggleCust = async (iid) => {
    const active = !c.is_active;
    try { await api(`/customers/${iid}/status`, { method:'POST', body:{ active } }); toast(active?'Activated':'Marked inactive'); customerDetail(iid); } catch(e){ toast(e.message, true); }
  };
}
