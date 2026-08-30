import { api, state, esc, can, isOwner } from './api.js';
import { toast } from './app.js';

export async function viewPeople() {
  const members = state.members;
  return {
    html: `
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
      <div class="panel"><div class="head">Bookers</div>
        <div class="tbl-wrap"><table><tr><th>Name</th><th>Company</th><th>Phone</th><th>Status</th></tr>
          ${(await api('/bookers')).map(b=>`<tr><td>${esc(b.name)}</td><td>${esc(b.company_id)}</td><td>${esc(b.phone||'')}</td><td>${b.is_active?'<span class="pill g">Active</span>':'<span class="pill r">Inactive</span>'}</td></tr>`).join('')}
        </table></div>
      </div>
      <div class="panel"><div class="head">Employees <span class="pill p">Distribution Business</span></div>
        <div class="tbl-wrap"><table><tr><th>Name</th><th>Role</th><th>Phone</th></tr>
          ${(await api('/employees')).map(e=>`<tr><td>${esc(e.name)}</td><td>${esc(e.role||'')}</td><td>${esc(e.phone||'')}</td></tr>`).join('')}
        </table></div>
      </div>
    </div>
    <div class="panel"><div class="head">Staff Authority Requests <span class="pill b">Owner approval</span></div>
      <div class="tbl-wrap"><table>
        <tr><th>User</th><th>Company</th><th>Action</th><th>Reason</th><th>Status</th><th></th></tr>
        ${(await api('/authority-requests')).map(r=>`<tr>
          <td>${esc(r.user_name)}</td><td>${esc(r.company_name)}</td><td>${esc(r.requested_action)}</td><td>${esc(r.reason||'')}</td>
          <td>${r.status==='pending'?'<span class="pill y">pending</span>':r.status==='approved'?'<span class="pill g">approved</span>':'<span class="pill r">rejected</span>'}</td>
          <td>${r.status==='pending'&&isOwner()?`<div class="row-actions"><button class="btn sm ok" onclick="window.__decide(${r.id},true)">Approve</button><button class="btn sm danger" onclick="window.__decide(${r.id},false)">Reject</button></div>`:''}</td>
        </tr>`).join('')||'<tr><td colspan=6 class="empty">No requests</td></tr>'}
      </table></div>
    </div>`,
    mount: () => {
      window.__decide = async (id, approve) => {
        try { await api(`/authority-requests/${id}/decide`, { method:'POST', body:{ approve } }); toast(approve?'Approved':'Rejected'); location.reload(); } catch(e){ toast(e.message, true); }
      };
    }
  };
}

export async function viewPermissions() {
  const companies = await api('/companies');
  const first = state.company_id || companies[0].id;
  const [members, perms] = await Promise.all([api(`/companies/${first}/members`), api(`/companies/${first}/permissions`)]);
  const actions = ['view','add','edit','delete','approve','export'];
  return {
    html: `
    <div class="panel"><div class="head">Owner-Managed Permissions</div><div style="padding:14px">
      <div class="field"><label>Company</label><select onchange="window.__loadPerm(this.value)">${companies.filter(c=>c.is_active).map(c=>`<option value="${c.id}" ${c.id===first?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div style="margin-top:12px" class="tbl-wrap"><table>
        <tr><th>User</th>${actions.map(a=>`<th>${a}</th>`).join('')}</tr>
        ${members.map(m=>{
          const row = perms.filter(p=>p.user_id===m.user_id);
          return `<tr><td>${esc(m.full_name)} <span class="muted">(${esc(m.company_role)})</span></td>
            ${actions.map(a=>{
              const p = row.find(x=>x.action===a);
              const allowed = p ? !!p.allowed : (['view'].includes(a)||['add','export'].includes(a)&&m.company_role!=='staff'? true : m.company_role==='owner');
              return `<td><input type="checkbox" class="perm" data-uid="${m.user_id}" data-act="${a}" ${allowed?'checked':''} ${m.company_role==='owner'?'disabled':''}></td>`;
            }).join('')}
          </tr>`;
        }).join('')}
      </table></div>
      <div style="margin-top:12px;text-align:right"><button class="btn" onclick="window.__savePerms()">Save Permissions</button></div>
    </div></div>`,
    mount: () => {
      window.__loadPerm = async (cid) => { state.company_id = +cid; location.reload(); };
      window.__savePerms = async () => {
        const permissions = [...document.querySelectorAll('.perm')].map(x => ({ user_id: +x.dataset.uid, action: x.dataset.act, allowed: x.checked }));
        try { await api(`/companies/${state.company_id}/permissions`, { method:'POST', body:{ permissions } }); toast('Permissions saved'); } catch(e){ toast(e.message, true); }
      };
    }
  };
}
