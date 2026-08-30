import { api, state, fmtMoney, fmtDate, esc } from './api.js';
import { navigate, toast } from './app.js';

export async function viewDashboard() {
  const d = await api('/dashboard' + (state.company_id ? `?company_id=${state.company_id}` : ''));
  const t = d.totals;
  const today = new Date().toISOString().slice(0,10);
  const html = `
  <div class="row-actions" style="margin-bottom:16px">
    <button class="btn" onclick="window.__nav('invoices')">+ New Invoice</button>
    <button class="btn ghost" onclick="window.__newCompany()">+ New Company</button>
  </div>

  <div class="cards">
    <div class="stat"><div class="lbl">Invoice Total</div><div class="val">${fmtMoney(t.invoice_total)}</div><div class="sub">${t.posted_count} posted</div></div>
    <div class="stat"><div class="lbl">Recovered</div><div class="val">${fmtMoney(t.recovered + t.payments + t.cleared_cheques)}</div><div class="sub">recovery + payments</div></div>
    <div class="stat"><div class="lbl">Total Outstanding</div><div class="val" style="color:${t.outstanding>0?'var(--bad)':'var(--ok)'}">${fmtMoney(t.outstanding)}</div><div class="sub">incl. old bills</div></div>
    <div class="stat"><div class="lbl">Cheques Open</div><div class="val">${d.cheques.length}</div><div class="sub">${d.cheques.filter(c=>c.overdue).length} overdue</div></div>
  </div>

  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
    <div class="panel">
      <div class="head">⏰ Due / Overdue Cheques</div>
      <div class="tbl-wrap"><table>
        <tr><th>Cheque</th><th>Customer</th><th>Amount</th><th>Due</th><th>Status</th></tr>
        ${d.cheques.length?d.cheques.map(c=>`<tr><td>${esc(c.cheque_number)}</td><td>${esc(c.customer_name||'')}</td><td>${fmtMoney(c.amount)}</td><td>${fmtDate(c.due_date)}</td><td><span class="pill ${c.overdue?'r':c.due_date===today?'y':'b'}">${c.overdue?'OVERDUE':'due'}</span></td></tr>`).join(''):`<tr><td colspan=5 class="empty">No open cheques</td></tr>`}
      </table></div>
    </div>

    <div class="panel">
      <div class="head">⚠️ Low Stock (&lt; 10 units)</div>
      <div class="tbl-wrap"><table>
        <tr><th>Item</th><th>SKU</th><th>Stock</th></tr>
        ${d.lowStock.length?d.lowStock.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.sku)}</td><td style="color:var(--bad);font-weight:700">${p.stock}</td></tr>`).join(''):`<tr><td colspan=3 class="empty">All stocked</td></tr>`}
      </table></div>
    </div>

    <div class="panel">
      <div class="head">🏆 Top Selling Items</div>
      <div class="tbl-wrap"><table>
        <tr><th>Item</th><th>Qty</th><th>Amount</th></tr>
        ${d.topItems.length?d.topItems.map(p=>`<tr><td>${esc(p.name)}</td><td>${p.qty}</td><td>${fmtMoney(p.amt)}</td></tr>`).join(''):`<tr><td colspan=3 class="empty">No sales</td></tr>`}
      </table></div>
    </div>

    <div class="panel">
      <div class="head">👤 Booker Leaderboard</div>
      <div class="tbl-wrap"><table>
        <tr><th>Booker</th><th>Sales</th><th>Returns</th><th>Net</th></tr>
        ${d.bookerSales.length?d.bookerSales.map(b=>`<tr><td>${esc(b.name||'Unassigned')}</td><td>${fmtMoney(b.sales)}</td><td style="color:var(--bad)">-${fmtMoney(b.ret)}</td><td style="font-weight:700">${fmtMoney(b.net_sales)}</td></tr>`).join(''):`<tr><td colspan=4 class="empty">No data</td></tr>`}
      </table></div>
    </div>

    <div class="panel" style="grid-column:1/-1">
      <div class="head">📅 Monthly Sales & Recovery Trend</div>
      <div style="padding:16px;display:flex;flex-direction:column;gap:10px">
      ${d.monthly.map(m=>`
        <div>
          <div class="muted" style="font-weight:600;margin-bottom:4px">${esc(d.companies.find(c=>c.id===m.company_id)?.name||'Company '+m.company_id)}</div>
          <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">
            ${Object.keys(m.salesByMonth).sort().map(k=>`<div class="stat"><div class="lbl">${k} sales</div><div class="val" style="font-size:16px">${fmtMoney(m.salesByMonth[k])}</div></div>`).join('')||'<div class="muted">No sales recorded</div>'}
          </div>
        </div>`).join('')}
      </div>
    </div>
  </div>
  `;
  return html;
}

window.__newCompany = () => navigate('companies');
