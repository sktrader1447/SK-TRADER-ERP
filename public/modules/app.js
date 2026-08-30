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
  document.getElementById('companyChip').textContent = state.company_id ? (state.members.find(m=>m.company_id===state.company_id)?.company_name || 'Company') : 'All Companies';
  document.getElementById('userChip').textContent = state.user ? state.user.full_name : '';
}

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
  // try to login as owner for demo if not authenticated
  try {
    await refreshState();
  } catch (e) {
    const creds = [['owner','owner123'],['acc','acc123'],['mgr','mgr123'],['staff','staff123']];
    for (const [u,p] of creds) {
      const r = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:u,password:p}) });
      if (r.ok) break;
    }
    await refreshState();
  }
  window.__nav = (id) => navigate(id);
  renderNav();
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
