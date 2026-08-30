import { api, state, fmtMoney, esc } from './api.js';
import { navigate, toast } from './app.js';
import { openModal, closeModal } from './invoices.js';

const CUSTOMER_CATEGORIES = ['Retail', 'Salon', 'Daraz', 'Online', 'Wholesale'];

export async function viewCompanies() {
  const companies = await api('/companies');
  return {
    html: `
    <div class="row-actions" style="margin-bottom:16px">
      <button class="btn" onclick="window.__addCompany()">+ New Company</button>
      <div class="spacer" style="flex:1"></div>
    </div>
    <div class="panel">
      <div class="head">Companies <span class="pill b">${companies.length}</span></div>
      <div class="tbl-wrap"><table>
        <tr><th>Name</th><th>Code</th><th>Address</th><th>Phone</th><th>Email</th><th>Partner</th><th>Margin</th><th>Status</th><th></th></tr>
        ${companies.map(c=>`<tr>
          <td><a href="#" onclick="window.__editCompany(${c.id});return false">${esc(c.name)}</a></td>
          <td>${esc(c.code||'—')}</td><td>${esc(c.address||'—')}</td><td>${esc(c.phone||'—')}</td><td>${esc(c.email||'—')}</td>
          <td>${esc(c.partner_name||'—')}</td><td>${c.profit_margin_pct}%</td>
          <td>${c.is_active?'<span class="pill g">Active</span>':'<span class="pill r">Archived</span>'}</td>
          <td style="white-space:nowrap">
            <button class="btn sm ghost" onclick="window.__editCompany(${c.id})">Edit</button>
            <button class="btn sm danger" onclick="window.__deleteCompany(${c.id})">Delete</button>
          </td>
        </tr>`).join('')}
      </table></div>
    </div>`,
    mount: () => {
      window.__addCompany = () => companyForm(null);
      window.__editCompany = (id) => companyForm(id);
      window.__deleteCompany = (id) => deleteCompany(id);
    }
  };
}

function companyForm(id) {
  api('/companies').then(companies => {
    const c = id ? companies.find(x => x.id === id) : null;
    openModal(c ? `Edit Company — ${esc(c.name)}` : 'New Company', `
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
        <div class="field"><label>Company Name *</label><input id="co_name" value="${c?esc(c.name):''}"></div>
        <div class="field"><label>Code</label><input id="co_code" value="${c?esc(c.code||''):''}" placeholder="e.g. ERB-01"></div>
        <div class="field"><label>Address</label><input id="co_addr" value="${c?esc(c.address||''):''}"></div>
        <div class="field"><label>Phone</label><input id="co_phone" value="${c?esc(c.phone||''):''}"></div>
        <div class="field"><label>Email</label><input id="co_email" value="${c?esc(c.email||''):''}"></div>
        <div class="field"><label>Partner / Owner Name</label><input id="co_partner" value="${c?esc(c.partner_name||''):''}"></div>
        <div class="field"><label>Profit Margin %</label><input id="co_margin" type="number" step="0.1" value="${c?c.profit_margin_pct:0}"></div>
      </div>
      <div style="margin-top:16px;text-align:right">
        <button class="btn ghost" onclick="window.__closeModal()">Cancel</button>
        <button class="btn" onclick="window.__saveCompany(${id||0})">Save</button>
      </div>`, false);
    window.__saveCompany = async (cid) => {
      const body = {
        name: document.getElementById('co_name').value.trim(),
        code: document.getElementById('co_code').value.trim(),
        address: document.getElementById('co_addr').value.trim(),
        phone: document.getElementById('co_phone').value.trim(),
        email: document.getElementById('co_email').value.trim(),
        partner_name: document.getElementById('co_partner').value.trim(),
        profit_margin_pct: +document.getElementById('co_margin').value || 0,
      };
      if (!body.name) return toast('Company name is required', true);
      try {
        if (cid) await api(`/companies/${cid}`, { method: 'POST', body });
        else await api('/companies', { method: 'POST', body });
        toast('Company saved'); closeModal(); navigate('companies');
      } catch(e){ toast(e.message, true); }
    };
  });
}

function deleteCompany(id) {
  api('/companies').then(companies => {
    const c = companies.find(x => x.id === id);
    if (!c) return;
    if (!confirm(`Delete company "${c.name}" and ALL its data (invoices, products, bookers, customers)? This CANNOT be undone.`)) return;
    if (!confirm(`Final warning: "${c.name}" ke saare invoices/products/customers hamesha ke liye delete ho jayenge. Pakka delete karein?`)) return;
    api(`/companies/${id}/delete`, { method: 'POST' }).then(() => {
      toast('Company deleted'); navigate('companies');
    }).catch(e => toast(e.message, true));
  });
}

// Global company switcher + product/customer category helpers shared across app.
export function companySelector(companies) {
  return `<select onchange="window.__setCompany(this.value)">${companies.filter(c=>c.is_active).map(c=>`<option value="${c.id}" ${c.id===state.company_id?'selected':''}>${esc(c.name)}</option>`).join('')}</select>`;
}

export function categoryOptions(selected) {
  return `<select>${['', ...CUSTOMER_CATEGORIES].map(x=>`<option value="${esc(x)}" ${String(selected)==x?'selected':''}>${x||'Select category…'}</option>`).join('')}</select>`;
}

export { CUSTOMER_CATEGORIES };
