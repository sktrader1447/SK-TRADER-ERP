import { api, state, fmtMoney, esc, can } from './api.js';
import { navigate, toast } from './app.js';

export async function viewInventory() {
  const [prods, movs] = await Promise.all([
    api('/products' + (state.company_id ? `?company_id=${state.company_id}` : '')),
    api('/inventory-movements'),
  ]);
  prods.sort((a,b)=>a.name.localeCompare(b.name));
  const letters = [...new Set(prods.map(p=>p.name[0].toUpperCase()))].sort();
  return {
    html: `
    <div class="row-actions" style="margin-bottom:16px">
      <button class="btn" onclick="window.__addProd()">+ New Product</button>
      <div class="spacer" style="flex:1"></div>
      <div style="display:flex;gap:4px;flex-wrap:wrap" id="az2">${letters.map(l=>`<button class="btn sm ghost" onclick="window.__az2('${l}')">${l}</button>`).join('')}</div>
      <input placeholder="Search name/SKU…" oninput="window.__srch2(this.value)">
    </div>
    <div class="panel"><div class="tbl-wrap"><table>
      <tr><th>Item</th><th>SKU</th><th>Purchase</th><th>Salon</th><th>Retail</th><th>Online</th><th>Stock</th><th>Damaged</th><th>Status</th><th></th></tr>
      <tbody id="prodRows">
      ${prods.map(p=>`<tr data-name="${esc((p.name+' '+p.sku).toLowerCase())}">
        <td>${esc(p.name)}</td><td>${esc(p.sku)}</td><td>${fmtMoney(p.purchase_rate)}</td><td>${fmtMoney(p.salon_rate)}</td><td>${fmtMoney(p.retail_rate)}</td><td>${fmtMoney(p.online_rate)}</td>
        <td style="color:${p.stock<10?'var(--bad)':'var(--ink)'};font-weight:${p.stock<10?'700':'400'}">${p.stock}</td><td>${p.damaged_stock}</td>
        <td>${p.is_active?'<span class="pill g">Active</span>':'<span class="pill r">Archived</span>'}</td>
        <td class="row-actions">
          <button class="btn sm ghost" onclick="window.__editProd(${p.id})">Edit</button>
          <button class="btn sm danger" onclick="window.__archiveProd(${p.id})">Delete/Archive</button>
        </td>
      </tr>`).join('')}
      </tbody>
    </table></div></div>
    <div class="panel"><div class="head">Recent Stock Movements</div><div class="tbl-wrap"><table>
      <tr><th>Item</th><th>Qty</th><th>Type</th><th>Ref</th><th>Note</th><th>Date</th></tr>
      ${movs.slice(0,50).map(m=>`<tr><td>${esc(m.product_name)}</td><td style="color:${m.qty<0?'var(--bad)':'var(--ok)'}">${m.qty}</td><td>${esc(m.type)}</td><td>${esc(m.ref||'')}</td><td>${esc(m.note||'')}</td><td>${esc((m.created_at||'').slice(0,16))}</td></tr>`).join('')}
    </table></div></div>
    <div id="prodForm"></div>`,
    mount: () => {
      window.__az2 = (l) => { [...document.querySelectorAll('#prodRows tr')].forEach(r=>{ r.style.display = r.dataset.name.startsWith(l.toLowerCase())?'':'none'; }); };
      window.__srch2 = (q) => { [...document.querySelectorAll('#prodRows tr')].forEach(r=>{ r.style.display = r.dataset.name.includes(q.toLowerCase())?'':'none'; }); };
      window.__addProd = () => productForm(null);
      window.__editProd = (id) => productForm(id);
      window.__archiveProd = (id) => archiveProduct(id);
    }
  };
}

async function productForm(id) {
  const prods = await api('/products');
  const p = prods.find(x=>x.id===id);
  const f = document.getElementById('prodForm');
  f.innerHTML = `<div class="panel"><div class="head">${id?'Edit Product':'New Product'}</div><div style="padding:18px">
    <div class="grid">
      <div class="field"><label>Name *</label><input id="pr_name" value="${p?esc(p.name):''}"></div>
      <div class="field"><label>SKU</label><input id="pr_sku" value="${p?esc(p.sku):''}"></div>
      <div class="field"><label>Unit</label><input id="pr_unit" value="${p?esc(p.unit||''):''}"></div>
      <div class="field"><label>Purchase Rate</label><input id="pr_pur" type="number" value="${p?p.purchase_rate:0}"></div>
      <div class="field"><label>Salon Rate</label><input id="pr_sal" type="number" value="${p?p.salon_rate:0}"></div>
      <div class="field"><label>Retail Rate</label><input id="pr_ret" type="number" value="${p?p.retail_rate:0}"></div>
      <div class="field"><label>Online Rate</label><input id="pr_net" type="number" value="${p?p.online_rate:0}"></div>
      ${p?`<div class="field"><label>Opening Stock</label><input id="pr_stock" type="number" value="${p.stock}" readonly></div>`:''}
    </div>
    <div style="margin-top:14px;text-align:right">
      <button class="btn ghost" onclick="document.getElementById('prodForm').innerHTML=''">Cancel</button>
      <button class="btn" onclick="window.__saveProd(${id||0})">Save</button>
    </div></div></div>`;
  window.__saveProd = async (pid) => {
    const body = {
      company_id: state.company_id, name: document.getElementById('pr_name').value, sku: document.getElementById('pr_sku').value,
      unit: document.getElementById('pr_unit').value, purchase_rate: +document.getElementById('pr_pur').value||0,
      salon_rate: +document.getElementById('pr_sal').value||0, retail_rate: +document.getElementById('pr_ret').value||0,
      online_rate: +document.getElementById('pr_net').value||0,
    };
    try {
      if (pid) await api(`/products/${pid}`, { method:'POST', body });
      else await api('/products', { method:'POST', body });
      toast('Product saved'); navigate('inventory');
    } catch(e){ toast(e.message, true); }
  };
}

async function archiveProduct(id) {
  const prods = await api('/products');
  const p = prods.find(x=>x.id===id);
  const msg = p.is_active ? `Archive ${p.name}? Historical invoices, stock movements and audit records are retained; it will be removed from new-use lists.` : `Re-activate ${p.name}?`;
  if (!confirm(msg)) return;
  try { await api(`/products/${id}/archive`, { method:'POST', body:{ active: !p.is_active } }); toast(p.is_active?'Archived':'Activated'); navigate('inventory'); } catch(e){ toast(e.message, true); }
}
