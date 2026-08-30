import { api, state, fmtMoney, esc } from './api.js';
import { navigate, toast } from './app.js';

export async function viewCommon() {
  const [expenses, payroll, employees, logistics, assets, ledger] = await Promise.all([
    api('/expenses'), api('/payroll'), api('/employees'), api('/logistics'), api('/assets'), api('/dist-ledger'),
  ]);
  return {
    html: `
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
      <div class="panel"><div class="head">Common Expenses <span class="pill p">Distribution Business</span></div>
        <div class="tbl-wrap"><table>
          <tr><th>Date</th><th>Expense</th><th>Category</th><th>Reference</th><th>Amount</th></tr>
          ${expenses.map(e=>`<tr><td>${esc((e.expense_date||'').slice(0,10))}</td><td>${esc(e.name)}</td><td>${esc(e.category||'')}</td><td>${esc(e.reference||'')}</td><td>${fmtMoney(e.amount)}</td></tr>`).join('')||'<tr><td colspan=5 class="empty">None</td></tr>'}
        </table></div>
        <div style="padding:14px;border-top:1px solid var(--line)"><div class="grid">
          <div class="field"><label>Expense</label><input id="x_name"></div>
          <div class="field"><label>Category</label><input id="x_cat"></div>
          <div class="field"><label>Date</label><input id="x_date" type="date" value="${new Date().toISOString().slice(0,10)}"></div>
          <div class="field"><label>Amount</label><input id="x_amt" type="number"></div>
          <div class="field"><label>Description</label><input id="x_desc"></div>
          <div class="field"><label>Reference</label><input id="x_ref"></div>
        </div><button class="btn" style="margin-top:10px" onclick="window.__addExp()">+ Add Expense</button></div>
      </div>

      <div class="panel"><div class="head">Payroll <span class="pill p">Distribution Business</span></div>
        <div class="tbl-wrap"><table>
          <tr><th>Period</th><th>Employee</th><th>Net</th><th>Bike/Fuel</th></tr>
          ${payroll.map(p=>`<tr><td>${esc(p.period)}</td><td>${esc(p.employee_name)}</td><td>${fmtMoney(p.net)}</td><td>${esc(p.rider_bike_info||'')}</td></tr>`).join('')||'<tr><td colspan=4 class="empty">None</td></tr>'}
        </table></div>
        <div style="padding:14px;border-top:1px solid var(--line)"><div class="grid">
          <div class="field"><label>Employee</label><select id="p_emp">${employees.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Period</label><input id="p_per" placeholder="2026-08"></div>
          <div class="field"><label>Allowances</label><input id="p_allow" type="number"></div>
          <div class="field"><label>Deductions</label><input id="p_ded" type="number"></div>
          <div class="field"><label>Advance</label><input id="p_adv" type="number"></div>
          <div class="field"><label>Fuel Allow.</label><input id="p_fuel" type="number"></div>
          <div class="field"><label>Maintenance</label><input id="p_maint" type="number"></div>
          <div class="field"><label>Rider Bike Info</label><input id="p_bike"></div>
        </div><button class="btn" style="margin-top:10px" onclick="window.__addPay()">+ Record Payroll</button></div>
      </div>

      <div class="panel"><div class="head">Logistics <span class="pill p">Distribution Business</span></div>
        <div class="tbl-wrap"><table>
          <tr><th>Date</th><th>Transport</th><th>Fuel</th><th>Mileage</th><th>Description</th></tr>
          ${logistics.map(l=>`<tr><td>${esc((l.date||'').slice(0,10))}</td><td>${esc(l.transportation||'')}</td><td>${l.fuel_consumption}</td><td>${l.mileage}</td><td>${esc(l.description||'')}</td></tr>`).join('')||'<tr><td colspan=5 class="empty">None</td></tr>'}
        </table></div>
        <div style="padding:14px;border-top:1px solid var(--line)"><div class="grid">
          <div class="field"><label>Date</label><input id="l_date" type="date" value="${new Date().toISOString().slice(0,10)}"></div>
          <div class="field"><label>Transportation</label><input id="l_trans"></div>
          <div class="field"><label>Fuel Consumption</label><input id="l_fuel" type="number"></div>
          <div class="field"><label>Mileage</label><input id="l_mile" type="number"></div>
          <div class="field"><label>Description</label><input id="l_desc"></div>
        </div><button class="btn" style="margin-top:10px" onclick="window.__addLog()">+ Add Logistics</button></div>
      </div>

      <div class="panel"><div class="head">Assets <span class="pill p">Distribution Business</span></div>
        <div class="tbl-wrap"><table>
          <tr><th>Name</th><th>Category</th><th>Value</th><th>Date</th></tr>
          ${assets.map(a=>`<tr><td>${esc(a.name)}</td><td>${esc(a.category||'')}</td><td>${fmtMoney(a.purchase_value)}</td><td>${esc((a.purchase_date||'').slice(0,10))}</td></tr>`).join('')||'<tr><td colspan=4 class="empty">None</td></tr>'}
        </table></div>
      </div>
    </div>

    <div class="panel"><div class="head">Distribution Business Ledger <span class="pill p">Separate from company ledgers</span></div>
      <div class="tbl-wrap"><table>
        <tr><th>Kind</th><th>Type</th><th>Amount</th><th>Note</th><th>Date</th></tr>
        ${ledger.map(l=>`<tr><td><span class="pill b">${esc(l.kind)}</span></td><td>${l.type==='out'?'<span style="color:var(--bad)">out</span>':'<span style="color:var(--ok)">in</span>'}</td><td>${fmtMoney(l.amount)}</td><td>${esc(l.note||'')}</td><td>${esc((l.created_at||'').slice(0,16))}</td></tr>`).join('')||'<tr><td colspan=5 class="empty">No entries</td></tr>'}
      </table></div>
    </div>`,
    mount: () => {
      window.__addExp = async () => {
        try { await api('/expenses', { method:'POST', body:{ name: document.getElementById('x_name').value, category: document.getElementById('x_cat').value, date: document.getElementById('x_date').value, amount: +document.getElementById('x_amt').value, description: document.getElementById('x_desc').value, reference: document.getElementById('x_ref').value, expense_date: document.getElementById('x_date').value } }); toast('Expense added'); navigate('common'); } catch(e){ toast(e.message, true); }
      };
      window.__addPay = async () => {
        try { await api('/payroll', { method:'POST', body:{ employee_id: +document.getElementById('p_emp').value, period: document.getElementById('p_per').value, allowances: +document.getElementById('p_allow').value, deductions: +document.getElementById('p_ded').value, advance: +document.getElementById('p_adv').value, fuel_allowance: +document.getElementById('p_fuel').value, maintenance_cost: +document.getElementById('p_maint').value, rider_bike_info: document.getElementById('p_bike').value } }); toast('Payroll recorded'); navigate('common'); } catch(e){ toast(e.message, true); }
      };
      window.__addLog = async () => {
        try { await api('/logistics', { method:'POST', body:{ date: document.getElementById('l_date').value, transportation: document.getElementById('l_trans').value, fuel_consumption: +document.getElementById('l_fuel').value, mileage: +document.getElementById('l_mile').value, description: document.getElementById('l_desc').value } }); toast('Logistics added'); navigate('common'); } catch(e){ toast(e.message, true); }
      };
    }
  };
}

export async function viewAllocation() {
  const [plans, companies] = await Promise.all([api('/allocation-plans'), api('/companies')]);
  const active = companies.filter(c=>c.is_active);
  const full = await Promise.all(plans.map(p => api(`/allocation-plans/${p.id}`)));
  return {
    html: `
    <div class="panel"><div class="head">Expense Allocation Plans <span class="pill y">Report-only · must total 100%</span></div>
      <div style="padding:18px">
        <div class="field"><label>Plan Name</label><input id="al_name" placeholder="e.g. Q3 2026 Common Allocation"></div>
        <div style="margin-top:10px;display:grid;gap:8px">
          ${active.map(c=>`<div style="display:flex;align-items:center;gap:10px;max-width:360px"><label style="flex:1">${esc(c.name)}</label><input type="number" step="0.1" class="al_pct" data-cid="${c.id}" placeholder="%"></div>`).join('')}
        </div>
        <div style="margin-top:12px" class="muted">Total must equal exactly 100%.</div>
        <button class="btn" style="margin-top:8px" onclick="window.__saveAlloc()">Create Plan</button>
      </div>
    </div>
    <div class="panel"><div class="head">Saved Plans</div><div class="tbl-wrap"><table>
      <tr><th>Name</th><th>Created</th><th>Allocation</th><th></th></tr>
      ${full.map((p,i)=>`<tr><td>${esc(p.name)}</td><td>${esc((p.created_at||'').slice(0,16))}</td><td>${p.items.map(it=>`${esc(it.company_name)} ${it.percentage}%`).join(', ')}</td><td><button class="btn sm ghost" onclick="window.__usePlan(${p.id})">Set Active</button></td></tr>`).join('')||'<tr><td colspan=4 class="empty">No plans yet</td></tr>'}
    </table></div></div>`,
    mount: () => {
      window.__saveAlloc = async () => {
        const items = [...document.querySelectorAll('.al_pct')].map(x => ({ company_id: +x.dataset.cid, percentage: +x.value || 0 })).filter(i=>i.percentage>0);
        try { await api('/allocation-plans', { method:'POST', body:{ name: document.getElementById('al_name').value, items } }); toast('Plan created'); navigate('allocation'); } catch(e){ toast(e.message, true); }
      };
      window.__usePlan = (id) => { toast('Plan set as active (latest plan used in profitability)'); };
    }
  };
}

export async function viewProfitability() {
  const data = await api('/profitability' + (state.company_id ? `?company_id=${state.company_id}` : ''));
  const totalSales = data.rows.reduce((s,r)=>s+r.sales,0);
  const totalProfit = data.rows.reduce((s,r)=>s+r.profit_loss,0);
  return `
  <div class="cards">
    <div class="stat"><div class="lbl">Common Distribution Cost</div><div class="val">${fmtMoney(data.dist_cost)}</div></div>
    <div class="stat"><div class="lbl">Active Plan</div><div class="val" style="font-size:16px">${esc(data.plan?.name||'None')}</div></div>
    <div class="stat"><div class="lbl">Total Company Sales</div><div class="val">${fmtMoney(totalSales)}</div></div>
    <div class="stat"><div class="lbl">Net Profit / Loss</div><div class="val" style="color:${totalProfit>=0?'var(--ok)':'var(--bad)'}">${fmtMoney(totalProfit)}</div></div>
  </div>
  <div class="panel"><div class="head">Company Profitability <span class="pill p">Sales − allocated common cost</span></div>
    <div class="tbl-wrap"><table>
      <tr><th>Company</th><th>Partner</th><th>Sales</th><th>Margin %</th><th>Margin Value</th><th>Alloc %</th><th>Alloc Value</th><th>Profit / Loss</th></tr>
      ${data.rows.map(r=>`<tr>
        <td><b>${esc(r.company_name)}</b></td><td>${esc(r.partner_name||'—')}</td>
        <td>${fmtMoney(r.sales)}</td><td>${r.profit_margin_pct}%</td>
        <td>${fmtMoney(r.margin_value)}</td><td>${r.alloc_pct}%</td>
        <td>-${fmtMoney(r.alloc_value)}</td>
        <td style="color:${r.profit_loss>=0?'var(--ok)':'var(--bad)'};font-weight:800">${fmtMoney(r.profit_loss)}</td>
      </tr>`).join('')}
    </table></div>
  </div>
  <div class="panel"><div class="head">Booker Sales & Recovery by Company</div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
    ${data.rows.map(r=>`<div style="padding:14px"><div class="muted" style="font-weight:700;margin-bottom:8px">${esc(r.company_name)}</div>
      <table><tr><th>Booker</th><th>Sales</th><th>Returns</th><th>Net</th></tr>${r.bookerSales.map(b=>`<tr><td>${esc(b.name||'Unassigned')}</td><td>${fmtMoney(b.sales)}</td><td style="color:var(--bad)">-${fmtMoney(b.returns)}</td><td style="font-weight:700">${fmtMoney(b.net_sales)}</td></tr>`).join('')||'<tr><td colspan=4 class="empty">No sales</td></tr>'}</table>
    </div>`).join('')}
    </div>
  </div>`;
}
