export async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return await res.blob();
}

export function fmtMoney(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n || 0);
}
export function fmtDate(s) { return s ? String(s).slice(0, 10) : '—'; }
export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export let state = { user: null, members: [], perms: [], company_id: null };
export async function refreshState() {
  const me = await api('/me');
  state.user = me.user;
  state.members = me.members;
  state.perms = me.perms;
  if (!state.company_id && me.members.length) state.company_id = me.members[0].company_id;
  return state;
}
export function isOwner() { return state.user && state.user.role === 'owner'; }
export function can(action, companyId) {
  if (isOwner()) return true;
  const cid = companyId || state.company_id;
  const member = state.members.find(m => m.company_id === cid);
  if (!member) return false;
  const perm = state.perms.find(p => p.company_id === cid && p.action === action);
  if (perm) return !!perm.allowed;
  const role = member.role;
  const defs = { owner: ['view','add','edit','delete','approve','export'], accountant:['view','add','edit','approve','export'], manager:['view','add','edit','approve','export'], staff:['view','add','export'], booker:['view','export'] };
  return (defs[role] || []).includes(action);
}
