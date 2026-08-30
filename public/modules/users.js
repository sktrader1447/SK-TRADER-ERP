import { api, esc } from './api.js';
import { navigate, toast } from './app.js';

const ACTIONS = ['view','add','edit','delete','approve','export'];

export async function viewUsers() {
  const [users, companies] = await Promise.all([api('/users'), api('/companies')]);
  const active = companies.filter(c => c.is_active);
  return {
    html: `
    <div class="panel">
      <div class="head">👤 Users & Access <span class="pill b">${users.length}</span>
        <div class="sp"></div>
        <button class="btn ghost" onclick="window.__changeOwnPass()">Change My Password</button>
        <button class="btn" onclick="window.__showCreateUser()">+ New User</button>
      </div>
      <div class="tbl-wrap"><table>
        <tr><th>Name</th><th>Username</th><th>Role</th><th>Phone</th><th>Companies</th><th>Status</th><th></th></tr>
        <tbody>
        ${users.map(u=>{
          const companyNames = u.members.map(m => companies.find(c=>c.id===m.company_id)?.name || ('#'+m.company_id)).join(', ') || '—';
          const hasExplicit = u.perms.length;
          return `<tr>
            <td><b>${esc(u.full_name)}</b></td>
            <td>${esc(u.username)}</td>
            <td><span class="pill ${u.role==='owner'?'p':u.role==='accountant'?'b':u.role==='manager'?'g':'gry'}">${u.role}</span></td>
            <td>${esc(u.phone||'—')}</td>
            <td>${esc(companyNames)}</td>
            <td>${u.is_active?'<span class="pill g">Active</span>':'<span class="pill r">Inactive</span>'}</td>
            <td><div class="row-actions">
              ${u.id!==1?`<button class="btn sm ghost" onclick="window.__toggleUser(${u.id})">${u.is_active?'Disable':'Enable'}</button>`:''}
              <button class="btn sm ghost" onclick="window.__resetPass(${u.id}, '${esc(u.username)}')">Reset Password</button>
            </div></td>
          </tr>`;
        }).join('')}
        </tbody>
      </table></div>
    </div>
    <div id="userForm"></div>`,
    mount: () => {
      window.__showCreateUser = () => createUserForm(active);
      window.__toggleUser = async (id) => {
        const users = await api('/users');
        const u = users.find(x=>x.id===id);
        const active = !u.is_active;
        try { await api(`/users/${id}/status`, { method:'POST', body:{ active } }); toast(active?'Enabled':'Disabled'); viewUsers(); } catch(e){ toast(e.message, true); }
      };
      window.__resetPass = (id, username) => {
        const pw = prompt(`New password for "${username}" (min 4 chars):`);
        if (pw === null) return;
        if (!pw || pw.length < 4) return toast('Password must be at least 4 characters', true);
        api(`/users/${id}/password`, { method:'POST', body:{ password: pw } })
          .then(() => toast(`Password reset for ${username}`))
          .catch(e => toast(e.message, true));
      };
      window.__changeOwnPass = () => {
        const cur = prompt('Enter current password:');
        if (cur === null) return;
        const npw = prompt('Enter new password (min 4 chars):');
        if (npw === null) return;
        if (!npw || npw.length < 4) return toast('New password must be at least 4 characters', true);
        api('/me/password', { method:'POST', body:{ current_password: cur, new_password: npw } })
          .then(() => toast('Password changed successfully'))
          .catch(e => toast(e.message, true));
      };
    }
  };
}

function createUserForm(companies) {
  const f = document.getElementById('userForm');
  f.innerHTML = `<div class="panel"><div class="head">+ Create New User</div><div style="padding:18px">
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
      <div class="field"><label>Full Name *</label><input id="u_name"></div>
      <div class="field"><label>Username *</label><input id="u_username"></div>
      <div class="field"><label>Password *</label><input id="u_pass" type="password"></div>
      <div class="field"><label>Phone</label><input id="u_phone"></div>
      <div class="field"><label>Role</label><select id="u_role">
        <option value="staff">Staff</option><option value="manager">Manager</option><option value="accountant">Accountant</option><option value="booker">Booker</option>
      </select></div>
    </div>

    <div class="head" style="padding:14px 0 8px;font-size:14px">Assign to Companies</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px">
      ${companies.map(c=>`<label style="display:flex;gap:5px;align-items:center;border:1px solid var(--line);padding:6px 10px;border-radius:8px">
        <input type="checkbox" class="u_comp" value="${c.id}" onchange="window.__compToggle(${c.id}, this.checked)"> ${esc(c.name)}
      </label>`).join('') || '<span class="muted">No active companies</span>'}
    </div>

    <div class="head" style="padding:6px 0 8px;font-size:14px">Access Level</div>
    <div style="display:flex;gap:18px;margin-bottom:10px">
      <label style="display:flex;gap:6px;align-items:center"><input type="radio" name="u_mode" value="full" checked> <b>Full Access</b> <span class="muted">(role-based default: view/add/edit/approve/export)</span></label>
      <label style="display:flex;gap:6px;align-items:center"><input type="radio" name="u_mode" value="limited" onchange="window.__modeLimited()"> <b>Limited Access</b> <span class="muted">(choose per-company actions below)</span></label>
    </div>

    <div id="permTable" style="display:none">
      <div class="muted" style="margin-bottom:6px">Select permissions per company & action for this user:</div>
      <div class="tbl-wrap"><table>
        <tr><th>Company</th>${ACTIONS.map(a=>`<th>${a}</th>`).join('')}<th>Check All</th></tr>
        ${companies.map(c=>`<tr>
          <td><b>${esc(c.name)}</b></td>
          ${ACTIONS.map(a=>`<td><input type="checkbox" class="u_perm" data-cid="${c.id}" data-act="${a}" ${a==='view'?'checked':''}></td>`).join('')}
          <td><button class="btn sm ghost" onclick="window.__checkAll(${c.id})">All</button> <button class="btn sm ghost" onclick="window.__checkNone(${c.id})">None</button></td>
        </tr>`).join('') || '<tr><td colspan="8" class="empty">No active companies</td></tr>'}
      </table></div>
      <div class="muted" style="margin-top:6px">Actions not checked will be explicitly denied for this user in that company.</div>
    </div>

    <div style="margin-top:16px;text-align:right">
      <button class="btn ghost" onclick="document.getElementById('userForm').innerHTML=''">Cancel</button>
      <button class="btn" onclick="window.__saveUser()">Create User</button>
    </div>
  </div></div>`;

  window.__compToggle = (cid, checked) => {
    // when a company is unchecked, hide its permission rows
    if (!checked) {
      document.querySelectorAll(`.u_perm[data-cid="${cid}"]`).forEach(cb=>{ cb.disabled = true; cb.checked = false; });
    } else {
      document.querySelectorAll(`.u_perm[data-cid="${cid}"]`).forEach(cb=>{ cb.disabled = false; });
    }
  };
  window.__modeLimited = () => { document.getElementById('permTable').style.display = 'block'; };
  window.__checkAll = (cid) => { document.querySelectorAll(`.u_perm[data-cid="${cid}"]`).forEach(cb=>cb.checked=true); };
  window.__checkNone = (cid) => { document.querySelectorAll(`.u_perm[data-cid="${cid}"]`).forEach(cb=>cb.checked=false); };
  window.__saveUser = async () => {
    const mode = document.querySelector('input[name=u_mode]:checked').value;
    const compIds = [...document.querySelectorAll('.u_comp:checked')].map(x=>+x.value);
    if (!compIds.length) return toast('Assign at least one company', true);
    const companiesList = compIds.map(cid => ({ company_id: cid, role: document.getElementById('u_role').value }));
    let permissions = [];
    if (mode === 'limited') {
      permissions = [...document.querySelectorAll('.u_perm')]
        .filter(cb => !cb.disabled)
        .map(cb => ({ company_id: +cb.dataset.cid, action: cb.dataset.act, allowed: cb.checked }));
    }
    const body = {
      username: document.getElementById('u_username').value.trim(),
      password: document.getElementById('u_pass').value,
      full_name: document.getElementById('u_name').value.trim(),
      role: document.getElementById('u_role').value,
      phone: document.getElementById('u_phone').value.trim(),
      companies: companiesList,
      access_mode: mode,
      permissions,
    };
    if (!body.username || !body.password || !body.full_name) return toast('Name, username and password are required', true);
    try {
      await api('/users', { method:'POST', body });
      toast('User created'); navigate('users');
    } catch(e){ toast(e.message, true); }
  };
}
