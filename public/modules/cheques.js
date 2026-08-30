import { api, state, fmtMoney, fmtDate, esc, can } from './api.js';
import { navigate, toast } from './app.js';

export async function viewCheques() {
  const [cheques, custs, accs] = await Promise.all([
    api('/cheques' + (state.company_id ? `?company_id=${state.company_id}` : '')),
    api('/customers' + (state.company_id ? `?company_id=${state.company_id}` : '')),
    api('/accounts'),
  ]);
  return {
    html: `
    <div class="row-actions" style="margin-bottom:16px">
      <button class="btn" onclick="window.__addCheque()">+ Record Cheque</button>
      <select onchange="window.__filterStatus(this.value)" style="margin-left:auto">
        <option value="">All statuses</option><option>pending</option><option>deposited</option><option>cleared</option><option>bounced</option><option>cancelled</option>
      </select>
    </div>
    <div class="panel">
      <div class="head">Cheque Register <span class="pill b">${cheques.length}</span></div>
      <div id="chequeList">
        ${cheques.map(c=>chequeCard(c)).join('') || '<div class="empty">No cheques recorded</div>'}
      </div>
    </div>
    <div id="chequeForm"></div>`,
    mount: () => {
      window.__filterStatus = async (st) => {
        const data = await api('/cheques' + (state.company_id ? `?company_id=${state.company_id}` : '') + (st?`&status=${st}`:''));
        document.getElementById('chequeList').innerHTML = data.map(chequeCard).join('') || '<div class="empty">No cheques</div>';
      };
      window.__chequeStatus = async (id, st) => {
        try { await api(`/cheques/${id}/status`, { method:'POST', body:{ status: st } }); toast('Updated'); navigate('cheques'); } catch(e){ toast(e.message, true); }
      };
      window.__chequeEdit = (id) => editCheque(id);
      window.__chequeCancel = (id) => cancelCheque(id);
      window.__addCheque = () => addCheque();
    }
  };
}

function chequeCard(c) {
  return `
  <div style="padding:14px 18px;border-bottom:1px solid var(--line)">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <b>${esc(c.cheque_number)}</b>
      <span class="pill ${c.status==='cleared'?'g':c.status==='bounced'?'r':c.status==='cancelled'?'gry':c.status==='deposited'?'b':'y'}">${c.status}</span>
      <span style="margin-left:auto;font-weight:800">${fmtMoney(c.amount)}</span>
    </div>
    <div style="margin-top:8px;color:var(--mut);font-size:13px;display:grid;gap:4px">
      <div>Bank: <b style="color:var(--ink)">${esc(c.bank||'—')}</b></div>
      <div>Customer: <b style="color:var(--ink)">${esc(c.customer_name||'—')}</b> · Invoice: <b style="color:var(--ink)">${esc(c.invoice_no||'—')}</b> · Booker: <b style="color:var(--ink)">${esc(c.booker_name||'—')}</b></div>
      <div>Issue ${fmtDate(c.issue_date)} · Due <b>${fmtDate(c.due_date)}</b> · Deposit ${fmtDate(c.deposit_date)} · Clear ${fmtDate(c.clearance_date)}</div>
    </div>
    <div class="row-actions" style="margin-top:10px">
      ${c.status==='pending'?'<button class="btn sm ghost" onclick="window.__chequeStatus('+c.id+',\'deposited\')">Deposit</button><button class="btn sm ok" onclick="window.__chequeStatus('+c.id+',\'deposited\')">→</button>':''}
      ${c.status==='pending'?'<button class="btn sm danger" onclick="window.__chequeCancel('+c.id+')">Cancel</button>':''}
      ${c.status==='deposited'?'<button class="btn sm ok" onclick="window.__chequeStatus('+c.id+',\'cleared\')">Clear</button><button class="btn sm warn" onclick="window.__chequeStatus('+c.id+',\'bounced\')">Bounce</button>':''}
      ${c.status==='bounced'?'<button class="btn sm danger" onclick="window.__chequeCancel('+c.id+')">Cancel</button>':''}
      <button class="btn sm ghost" onclick="window.__chequeEdit('+c.id+')">Edit</button>
    </div>
  </div>`;
}

async function addCheque() {
  const custs = await api('/customers' + (state.company_id ? `?company_id=${state.company_id}` : ''));
  const invs = (await api('/invoices' + (state.company_id ? `?company_id=${state.company_id}` : ''))).filter(i => i.outstanding > 0);
  const f = document.getElementById('chequeForm');
  f.innerHTML = `<div class="panel"><div class="head">Record Cheque</div><div style="padding:18px">
    <div class="grid">
      <div class="field"><label>Cheque No *</label><input id="c_no"></div>
      <div class="field"><label>Bank</label><input id="c_bank"></div>
      <div class="field"><label>Amount *</label><input id="c_amt" type="number" step="0.01"></div>
      <div class="field"><label>Issue Date</label><input id="c_issue" type="date"></div>
      <div class="field"><label>Due Date</label><input id="c_due" type="date"></div>
      <div class="field"><label>Customer</label><select id="c_cust"><option value="">— none —</option>${custs.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Invoice</label><select id="c_inv"><option value="">— none —</option>${invs.map(i=>`<option value="${i.id}">${esc(i.invoice_no)} (${esc(i.customer_name)})</option>`).join('')}</select></div>
    </div>
    <div style="margin-top:14px;text-align:right">
      <button class="btn ghost" onclick="document.getElementById('chequeForm').innerHTML=''">Cancel</button>
      <button class="btn" onclick="window.__saveCheque()">Save Cheque</button>
    </div></div></div>`;
  window.__saveCheque = async () => {
    try {
      await api('/cheques', { method:'POST', body:{
        company_id: state.company_id, cheque_number: document.getElementById('c_no').value, bank: document.getElementById('c_bank').value,
        amount: +document.getElementById('c_amt').value, issue_date: document.getElementById('c_issue').value, due_date: document.getElementById('c_due').value,
        customer_id: +document.getElementById('c_cust').value || null, invoice_id: +document.getElementById('c_inv').value || null,
      }});
      toast('Cheque recorded'); navigate('cheques');
    } catch(e){ toast(e.message, true); }
  };
}

async function editCheque(id) {
  const cheques = await api('/cheques');
  const c = cheques.find(x => x.id === id);
  const f = document.getElementById('chequeForm');
  f.innerHTML = `<div class="panel"><div class="head">Edit Cheque ${esc(c.cheque_number)} <span class="pill b">${c.status}</span></div><div style="padding:18px">
    <div class="grid">
      <div class="field"><label>Cheque No</label><input id="e_no" value="${esc(c.cheque_number)}"></div>
      <div class="field"><label>Bank</label><input id="e_bank" value="${esc(c.bank||'')}"></div>
      <div class="field"><label>Amount</label><input id="e_amt" type="number" value="${c.amount}"></div>
      <div class="field"><label>Issue</label><input id="e_issue" type="date" value="${fmtDate(c.issue_date)}"></div>
      <div class="field"><label>Due</label><input id="e_due" type="date" value="${fmtDate(c.due_date)}"></div>
      <div class="field"><label>Deposit</label><input id="e_dep" type="date" value="${fmtDate(c.deposit_date)}"></div>
      <div class="field"><label>Clearance</label><input id="e_clear" type="date" value="${fmtDate(c.clearance_date)}"></div>
      <div class="field" style="grid-column:1/-1"><label>Audit reason</label><input id="e_reason"></div>
    </div>
    <div style="margin-top:14px;text-align:right"><button class="btn ghost" onclick="document.getElementById('chequeForm').innerHTML=''">Cancel</button><button class="btn" onclick="window.__saveChequeEdit(${id})">Save</button></div>
  </div></div>`;
  window.__saveChequeEdit = async (cid) => {
    try {
      await api(`/cheques/${cid}/edit`, { method:'POST', body:{
        cheque_number: document.getElementById('e_no').value, bank: document.getElementById('e_bank').value, amount: +document.getElementById('e_amt').value,
        issue_date: document.getElementById('e_issue').value, due_date: document.getElementById('e_due').value,
        deposit_date: document.getElementById('e_dep').value, clearance_date: document.getElementById('e_clear').value,
        audit_reason: document.getElementById('e_reason').value,
      }});
      toast('Cheque updated'); navigate('cheques');
    } catch(e){ toast(e.message, true); }
  };
}

async function cancelCheque(id) {
  const cheques = await api('/cheques');
  const c = cheques.find(x => x.id === id);
  if (c.status === 'cleared') {
    toast('Cleared cheques require reversal to cancel — this restores outstanding', true);
  }
  const reason = prompt(`Cancel cheque ${c.cheque_number}? Reason (required):`);
  if (!reason) return;
  try { await api(`/cheques/${id}/cancel`, { method:'POST', body:{ audit_reason: reason } }); toast('Cancelled'); navigate('cheques'); } catch(e){ toast(e.message, true); }
}
