import { api, state, fmtMoney, fmtDate, esc } from './api.js';
import { toast } from './app.js';

const TYPES = {
  sales: { label: 'Sales', cols: ['company_name','invoice_no','invoice_date','customer_name','booker_name','net_total'] },
  stock: { label: 'Stock', cols: ['company_name','name','sku','stock','damaged_stock','retail_rate'] },
  receivables: { label: 'Receivables', cols: ['company_name','invoice_no','invoice_date','customer_name','booker_name','net_total','paid','outstanding'] },
  cashflow: { label: 'Cashflow', cols: ['account_name','type','amount','ref','created_at'] },
  expense: { label: 'Expenses', cols: ['expense_date','name','category','description','reference','amount'] },
  booker: { label: 'Booker Performance', cols: ['company_name','name','sales','returns','net_sales','recovered'] },
  item: { label: 'Item-wise', cols: ['item_name','sku','invoice_no','invoice_date','qty','rate','amount','item_type'] },
};

export async function viewReports() {
  let type = 'sales';
  const companies = await api('/companies');
  const q = state.company_id ? `?company_id=${state.company_id}` : '';
  const typeName = (t) => TYPES[t].label;
  async function load(t) {
    type = t;
    const url = `/reports/${t}` + (state.company_id ? `?company_id=${state.company_id}` : '');
    const rows = await api(url);
    render(rows);
  }
  const isMoney = (c) => ['amount','net_total','rate','outstanding','paid','sales','recovered','returns','net_sales','margin_value','alloc_value','profit_loss'].includes(c);
  function render(rows) {
    const cols = TYPES[type].cols;
    // flatten booker report (nested per-company sales[])
    let tableRows = rows;
    if (type === 'booker') {
      tableRows = [];
      rows.forEach(company => (company.sales || []).forEach(s => {
        const rec = (company.recovery || []).find(r => r.name === s.name);
        tableRows.push({ company_name: company.company_name || '', name: s.name || 'Unassigned', sales: s.sales, returns: s.returns, net_sales: s.net_sales, recovered: rec ? rec.recovered : 0 });
      }));
    }
    const metaTitle = typeName(type) + ' Report';
    document.getElementById('reportBody').innerHTML = `
      <div class="panel"><div class="head">${metaTitle}</div>
        <div style="padding:14px;font-size:12px;color:var(--mut)">
          Company: <b>${state.members.find(m=>m.company_id===state.company_id)?.company_name||'All'}</b> · Date range: All · Report # ${Date.now().toString().slice(-8)} · Generated ${new Date().toLocaleString()}
        </div>
        <div class="tbl-wrap"><table>
          <tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr>
          ${tableRows.map(r=>`<tr>${cols.map(c=>`<td>${isMoney(c)?fmtMoney(r[c]):esc(r[c])}</td>`).join('')}</tr>`).join('')}
        </table></div>
        <div style="padding:14px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn sm" onclick="window.__exp('pdf')">Download PDF</button>
          <button class="btn sm ghost" onclick="window.__exp('xlsx')">Download Excel</button>
          <button class="btn sm warn" onclick="window.print()">Print</button>
        </div>
      </div>`;
    window.__exp = (fmt) => { const url = `/api/reports/${type}/export?format=${fmt}` + (state.company_id?`&company_id=${state.company_id}`:'') + `&title=${encodeURIComponent(metaTitle)}&company_name=${encodeURIComponent(state.members.find(m=>m.company_id===state.company_id)?.company_name||'All Companies')}`; window.open(url, '_blank'); };
  }
  await load(type);
  return {
    html: `
    <div class="panel"><div class="head">Reports</div><div style="padding:14px;display:flex;gap:8px;flex-wrap:wrap">
      ${Object.keys(TYPES).map(t=>`<button class="btn sm ghost" onclick="window.__repType('${t}')">${typeName(t)}</button>`).join('')}
      <div class="spacer" style="flex:1"></div>
      <select onchange="window.__repCompany(this.value)">${state.members.map(m=>`<option value="${m.company_id}" ${m.company_id===state.company_id?'selected':''}>${esc(m.company_name)}</option>`).join('')}</select>
    </div></div>
    <div id="reportBody"></div>`,
    mount: () => {
      window.__repType = (t) => load(t);
      window.__repCompany = async (v) => { state.company_id = +v; window.__repType(type); };
      load(type);
    }
  };
}
