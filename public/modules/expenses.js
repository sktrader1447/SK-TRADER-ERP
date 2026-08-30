import { api, state, fmtMoney, fmtDate, esc } from './api.js';
import { navigate, toast } from './app.js';

export async function viewExpenses() {
  const [expenses, heads, accounts, companies] = await Promise.all([
    api('/expenses'), api('/expense-heads'), api('/accounts'), api('/companies'),
  ]);
  const activeCompanies = companies.filter(c => c.is_active);
  const headOpts = heads.map(h => `<option value="${h.id}">${esc(h.name)}</option>`).join('');
  const accOpts = accounts.map(a => `<option value="${a.id}">${esc(a.name)} <span class="muted">(${esc(a.type)})</span></option>`).join('');
  return {
    html: `
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(380px,1fr))">

      <div class="panel"><div class="head">Add Expense <span class="pill p">Full entry</span></div>
        <div style="padding:16px">
          <div class="grid">
            <div class="field"><label>Expense</label><input id="ex_name"></div>
            <div class="field"><label>Date</label><input id="ex_date" type="date" value="${new Date().toISOString().slice(0,10)}"></div>
            <div class="field"><label>Amount</label><input id="ex_amt" type="number" step="0.01"></div>
            <div class="field"><label>Reference</label><input id="ex_ref"></div>
            <div class="field"><label>Head of Account</label>
              <select id="ex_head">${headOpts}<option value="">— (none) —</option></select>
            </div>
            <div class="field"><label>Payment Account</label>
              <select id="ex_acc">${accOpts}</select>
            </div>
            <div class="field"><label>Description</label><input id="ex_desc"></div>
          </div>

          <div style="display:flex;gap:8px;align-items:center;margin:10px 0">
            <input id="new_head" placeholder="New head of account name" style="flex:1">
            <button class="btn sm ghost" onclick="window.__addHead()">+ Add Head</button>
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin:10px 0">
            <input id="new_acc" placeholder="New account name (e.g. Easypaisa - Main)" style="flex:1">
            <select id="new_acc_type"><option value="cash">Cash</option><option value="bank">Bank</option><option value="mobile">Mobile/Easypaisa</option></select>
            <button class="btn sm ghost" onclick="window.__addAcc()">+ Add Account</button>
          </div>

          <div class="muted" style="margin-top:12px;font-weight:700">Company % sharing <span id="ex_pct_badge"></span></div>
          <div style="display:grid;gap:8px;margin-top:8px">
            ${activeCompanies.map(c=>`<div style="display:flex;align-items:center;gap:10px;max-width:380px"><label style="flex:1">${esc(c.name)}</label><input type="number" step="0.1" min="0" max="100" class="ex_pct" data-cid="${c.id}" value="0" oninput="window.__pctChk()">%</div>`).join('')}
          </div>
          <div class="muted" style="margin-top:6px">Total must equal exactly 100%.</div>
          <button class="btn" style="margin-top:12px" onclick="window.__saveExp()">Save Expense</button>
        </div>
      </div>

      <div class="panel"><div class="head">Expense Record</div>
        <div class="tbl-wrap"><table>
          <tr><th>Date</th><th>Expense</th><th>Head</th><th>Account</th><th>Amount</th><th>Company Split</th></tr>
          ${expenses.map(e=>`<tr>
            <td>${fmtDate(e.expense_date)}</td><td>${esc(e.name)}</td>
            <td>${esc(e.head_name||'—')}</td><td>${esc(e.account_name||'—')}</td>
            <td>${fmtMoney(e.amount)}</td>
            <td>${e.allocations?.length?e.allocations.map(a=>`${esc(a.company_name)} ${a.percentage}%`).join(', '):'<span class="muted">—</span>'}</td>
          </tr>`).join('')||'<tr><td colspan=6 class="empty">No expenses yet</td></tr>'}
        </table></div>
      </div>

      <div class="panel"><div class="head">Heads of Account</div>
        <div class="tbl-wrap"><table>
          <tr><th>Head</th></tr>
          ${heads.map(h=>`<tr><td>${esc(h.name)}</td></tr>`).join('')}
        </table></div>
      </div>

      <div class="panel"><div class="head">Payment Accounts <span class="pill p">Cash / Bank / Easypaisa</span></div>
        <div class="tbl-wrap"><table>
          <tr><th>Account</th><th>Type</th></tr>
          ${accounts.map(a=>`<tr><td>${esc(a.name)}</td><td><span class="pill b">${esc(a.type)}</span></td></tr>`).join('')}
        </table></div>
      </div>
    </div>`,
    mount: () => {
      window.__pctChk = () => {
        const pcts = [...document.querySelectorAll('.ex_pct')].map(x=>+x.value||0);
        const total = pcts.reduce((s,v)=>s+v,0);
        const badge = document.getElementById('ex_pct_badge');
        if (badge) { badge.textContent = `→ ${total}%`; badge.style.color = Math.abs(total-100)<0.0001 ? 'var(--ok)' : 'var(--bad)'; }
      };
      window.__addHead = async () => {
        const name = document.getElementById('new_head').value.trim();
        if (!name) return toast('Enter a head name', true);
        try { await api('/expense-heads', { method:'POST', body:{ name } }); toast('Head added'); navigate('expenses'); } catch(e){ toast(e.message, true); }
      };
      window.__addAcc = async () => {
        const name = document.getElementById('new_acc').value.trim();
        if (!name) return toast('Enter an account name', true);
        try { await api('/accounts', { method:'POST', body:{ name, type: document.getElementById('new_acc_type').value } }); toast('Account added'); navigate('expenses'); } catch(e){ toast(e.message, true); }
      };
      window.__saveExp = async () => {
        const allocations = [...document.querySelectorAll('.ex_pct')].map(x => ({ company_id:+x.dataset.cid, percentage:+x.value||0 })).filter(a=>a.percentage>0);
        const total = allocations.reduce((s,a)=>s+a.percentage,0);
        if (allocations.length && Math.abs(total-100)>0.0001) return toast(`Allocation must total exactly 100% (got ${total}%)`, true);
        try {
          await api('/expenses', { method:'POST', body:{
            name: document.getElementById('ex_name').value,
            expense_date: document.getElementById('ex_date').value,
            amount: +document.getElementById('ex_amt').value,
            reference: document.getElementById('ex_ref').value,
            head_id: +document.getElementById('ex_head').value || null,
            account_id: +document.getElementById('ex_acc').value || null,
            description: document.getElementById('ex_desc').value,
            allocations,
          }});
          toast('Expense recorded');
          navigate('expenses');
        } catch(e){ toast(e.message, true); }
      };
    }
  };
}
