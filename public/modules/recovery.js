import { api, state, fmtMoney, fmtDate, esc } from './api.js';
import { navigate, toast } from './app.js';

export async function viewRecovery() {
  const [ws, accounts] = await Promise.all([
    api('/recovery-workspace' + (state.company_id ? `?company_id=${state.company_id}` : '')),
    api('/accounts'),
  ]);
  return {
    html: `
    <div class="panel">
      <div class="head">Recovery & Cheques Workspace <span class="pill b">${ws.length} open balances</span></div>
      <div class="tbl-wrap"><table>
        <tr><th>Invoice</th><th>Type</th><th>Company</th><th>Customer</th><th>Booker</th><th>Net</th><th>Outstanding</th><th>Open Cheques</th><th></th></tr>
        ${ws.map(i=>`<tr>
          <td>${esc(i.invoice_no)}</td>
          <td>${i.is_old_bill?'<span class="pill y">Old Bill</span>':'<span class="pill g">Sale</span>'}</td>
          <td>${esc(i.company_name)}</td><td>${esc(i.customer_name)}</td><td>${esc(i.booker_name||'')}</td>
          <td>${fmtMoney(i.net_total)}</td>
          <td style="color:${i.outstanding>0?'var(--bad)':'var(--ok)'};font-weight:700">${fmtMoney(i.outstanding)}</td>
          <td>${i.open_cheques?`<span class="pill b">${i.open_cheques}</span>`:'—'}</td>
          <td>${i.outstanding>0?`<button class="btn sm" onclick="window.__rec(${i.id})">Recover</button>`:'<span class="pill g">Cleared</span>'}</td>
        </tr>`).join('') || '<tr><td colspan=9 class="empty">No open invoices</td></tr>'}
      </table></div>
    </div>
    <div id="recForm"></div>`,
    mount: () => { window.__rec = (id) => recoveryForm(id); }
  };
}

async function recoveryForm(invId) {
  const inv = await api(`/invoices/${invId}`);
  const accounts = await api('/accounts');
  const f = document.getElementById('recForm');
  f.innerHTML = `<div class="panel"><div class="head">Recovery — ${esc(inv.invoice_no)} (${esc(inv.customer_name)}) <span class="sp"></span> Outstanding: ${fmtMoney(inv.outstanding)}</div>
  <div style="padding:18px">
    <div class="grid">
      <div class="field"><label>Account 1</label><select id="r_a1">${accounts.map(a=>`<option value="${a.id}">${esc(a.name)} (${a.type})</option>`).join('')}</select></div>
      <div class="field"><label>Amount 1</label><input id="r_m1" type="number" step="0.01"></div>
      <div class="field"><label>Account 2 (optional, distinct)</label><select id="r_a2"><option value="">— none —</option>${accounts.map(a=>`<option value="${a.id}">${esc(a.name)} (${a.type})</option>`).join('')}</select></div>
      <div class="field"><label>Amount 2</label><input id="r_m2" type="number" step="0.01"></div>
      <div class="field"><label>Date</label><input id="r_date" type="date" value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="field"><label>Note</label><input id="r_note"></div>
    </div>
    <div style="margin-top:14px;text-align:right">
      <button class="btn ghost" onclick="document.getElementById('recForm').innerHTML=''">Cancel</button>
      <button class="btn" onclick="window.__saveRec(${invId})">Post Recovery</button>
    </div>
  </div></div>`;
  window.__saveRec = async (id) => {
    const a1 = +document.getElementById('r_a1').value, m1 = +document.getElementById('r_m1').value;
    const a2 = document.getElementById('r_a2').value, m2 = +document.getElementById('r_m2').value;
    if (m1 <= 0) return toast('Enter amount 1', true);
    try {
      await api('/recovery/split', { method:'POST', body:{
        company_id: inv.company_id, invoice_id: id, customer_id: inv.customer_id,
        account_1: a1, amount_1: m1, account_2: a2?+a2:null, amount_2: a2?m2:0,
        recovered_at: document.getElementById('r_date').value, note: document.getElementById('r_note').value,
      }});
      toast('Recovery posted'); navigate('recovery');
    } catch(e){ toast(e.message, true); }
  };
}
