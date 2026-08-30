import { api, refreshState, state, isOwner, can, fmtMoney, esc } from './api.js';
import { viewDashboard } from './dashboard.js';
import { viewInvoices } from './invoices.js';
import { viewCheques } from './cheques.js';
import { viewRecovery } from './recovery.js';
import { viewCustomers } from './customers.js';
import { viewInventory } from './inventory.js';
import { viewCommon } from './common.js';
import { viewPurchases } from './purchases.js';
import { viewExpenses } from './expenses.js';
import { viewReports } from './reports.js';
import { viewPeople, viewPermissions } from './people.js';
import { viewTemplate } from './templatePage.js';
import { viewUsers } from './users.js';
import { viewCompanies } from './companies.js';

const navGroups = [
  { label: 'Business', items: [
    { id: 'dashboard', icon: '▦', label: 'Dashboard' },
    { id: 'invoices', icon: '🧾', label: 'Invoices' },
    { id: 'purchases', icon: '🛒', label: 'Purchases & Ledger' },
    { id: 'recovery', icon: '💱', label: 'Recovery & Cheques' },
    { id: 'cheques', icon: '🏦', label: 'Cheque Register' },
    { id: 'customers', icon: '👥', label: 'Customers' },
    { id: 'inventory', icon: '📦', label: 'Inventory' },
  ]},
  { label: 'Distribution Business', items: [
    { id: 'common', icon: '🏬', label: 'Common Ops' },
    { id: 'expenses', icon: '💸', label: 'Expenses & Accounts' },
    { id: 'allocation', icon: '⚖️', label: 'Allocation Plans' },
    { id: 'profitability', icon: '📈', label: 'Profitability' },
  ]},
  { label: 'Admin', items: [
    { id: 'reports', icon: '📊', label: 'Reports' },
    { id: 'template', icon: '🎨', label: 'Invoice Template' },
    { id: 'companies', icon: '🏢', label: 'Companies' },
    { id: 'users', icon: '👤', label: 'Users & Access' },
    { id: 'people', icon: '🧑‍💼', label: 'People' },
    { id: 'permissions', icon: '🔐', label: 'Permissions' },
  ]},
];

let current = 'dashboard';

export function navigate(id) {
  current = id;
  renderNav();
  renderPage();
  window.scrollTo(0, 0);
}

function renderNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = navGroups.map(g => `
    <div class="group">${g.label}</div>
    ${g.items.map(i => `<button class="${current===i.id?'active':''}" onclick="window.__nav('${i.id}')">
      <span class="ic">${i.icon}</span><span>${i.label}</span></button>`).join('')}
  `).join('');
  // global company selector in topbar
  const chip = document.getElementById('companyChip');
  const members = state.members || [];
  if (members.length > 1) {
    chip.innerHTML = `<select id="gloCompany" onchange="window.__setCompany(this.value)" style="font-size:12px;padding:4px 8px;border-radius:7px;border:1px solid var(--line)">${members.map(m=>`<option value="${m.company_id}" ${m.company_id===state.company_id?'selected':''}>${esc(m.company_name)}</option>`).join('')}</select>`;
  } else if (members.length === 1) {
    chip.textContent = members[0].company_name;
  } else {
    chip.textContent = 'All Companies';
  }
  document.getElementById('userChip').textContent = state.user ? state.user.full_name : '';
}

window.__setCompany = (v) => {
  state.company_id = +v;
  navigate(current);
};

const views = {
  dashboard: viewDashboard,
  invoices: viewInvoices,
  cheques: viewCheques,
  recovery: viewRecovery,
  customers: viewCustomers,
  inventory: viewInventory,
  purchases: viewPurchases,
  expenses: viewExpenses,
  common: viewCommon,
  allocation: () => import('./common.js').then(m => m.viewAllocation()),
  profitability: () => import('./common.js').then(m => m.viewProfitability()),
  reports: viewReports,
  template: viewTemplate,
  companies: viewCompanies,
  users: viewUsers,
  people: viewPeople,
  permissions: viewPermissions,
};

async function renderPage() {
  const el = document.getElementById('content');
  el.innerHTML = '<div class="empty">Loading…</div>';
  const titles = { dashboard:'Dashboard', invoices:'Invoices', purchases:'Purchases & Purchase Ledger', recovery:'Recovery & Cheques', cheques:'Cheque Register', customers:'Customers', inventory:'Inventory', common:'Distribution Business', expenses:'Expenses & Accounts', allocation:'Expense Allocation Plans', profitability:'Company Profitability', reports:'Reports', template:'Invoice Template', users:'Users & Access', people:'People', permissions:'Permissions' };
  document.getElementById('pageTitle').textContent = titles[current] || 'ERP';
  const fn = views[current];
  try {
    const h = await fn();
    if (typeof h === 'string') el.innerHTML = h;
    else if (h && typeof h.then === 'function') el.innerHTML = await h;
    else if (h && h.el) { el.innerHTML = h.el; h.mount && h.mount(el); }
    else if (h && h.html) { el.innerHTML = h.html; h.mount && h.mount(el); }
  } catch (e) {
    el.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`;
  }
}

async function boot() {
  window.__nav = (id) => navigate(id);
  // Always render the menu first so the app is never a blank screen.
  renderNav();
  let bootErr = null;
  try {
    await refreshState();
  } catch (e) {
    // Not authenticated yet -> try the demo accounts, then refresh again.
    let ok = false;
    const creds = [['owner','owner123'],['acc','acc123'],['mgr','mgr123'],['staff','staff123']];
    for (const [u,p] of creds) {
      try {
        const r = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:u,password:p}) });
        if (r.ok) { ok = true; break; }
      } catch (_) { /* network error */ }
    }
    try {
      await refreshState();
    } catch (err) {
      bootErr = err;
    }
  }
  // Update header labels from whatever state we have.
  renderNav();
  if (bootErr) {
    const el = document.getElementById('content');
    el.innerHTML = `<div class="panel" style="max-width:560px;margin:40px auto">
      <div class="head">⚠️ Backend se connect nahi ho sakta</div>
      <div style="padding:16px;line-height:1.7;font-size:14px">
        Menu tayyar hai, lekin server ka <code>/api</code> jawab nahi de raha.
        Ye aksar hosting par <code>better-sqlite3</code> (native module) sahi install na hone se hota hai.
        <br><br><b>Kya karein:</b> Hosting ke <b>Logs</b> me dekhein — wahan asal error milega (mujhe bhejo to fix kar sakta hoon).
        <br><br>Error: <code>${esc(bootErr.message || bootErr)}</code>
      </div></div>`;
    return;
  }
  renderPage();
}

window.toggleSide = () => {
  document.getElementById('side').classList.toggle('open');
  document.getElementById('scrim').classList.toggle('show');
};
window.closeSide = () => {
  document.getElementById('side').classList.remove('open');
  document.getElementById('scrim').classList.remove('show');
};

export function toast(msg, isErr) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.className = '', 3200);
}

boot();
