import { verifyPassword } from './db.js';

// Default allowed actions per role (fallback when no explicit permission row).
export const ROLE_DEFAULTS = {
  owner: ['view', 'add', 'edit', 'delete', 'approve', 'export'],
  accountant: ['view', 'add', 'edit', 'approve', 'export'],
  manager: ['view', 'add', 'edit', 'approve', 'export'],
  staff: ['view', 'add', 'export'],
  booker: ['view', 'export'],
};
export const ACTIONS = ['view', 'add', 'edit', 'delete', 'approve', 'export'];

export function authenticate(req, res, next) {
  const uid = req.cookies && req.cookies.uid ? parseInt(req.cookies.uid, 10) : null;
  if (!uid) return res.status(401).json({ error: 'Not authenticated' });
  const user = req.db.prepare('SELECT * FROM users WHERE id=? AND is_active=1').get(uid);
  if (!user) return res.status(401).json({ error: 'Invalid session' });
  req.user = user;
  next();
}

// Company context: either explicit ?company_id= or "all" for common/owner queries.
export function resolveCompanies(req) {
  const q = req.query.company_id || req.body.company_id || req.headers['x-company-id'];
  if (q === 'all') return { all: true, ids: null };
  if (q) return { all: false, ids: [parseInt(q, 10)] };
  // default: companies the user is a member of
  const rows = req.db.prepare(
    'SELECT company_id FROM company_memberships WHERE user_id=?'
  ).all(req.user.id);
  return { all: false, ids: rows.map(r => r.company_id) };
}

export function isOwner(user) {
  return user.role === 'owner';
}

// Determine whether a user may perform `action` for a company.
export function may(db, user, companyId, action) {
  if (isOwner(user)) return true;
  // must be a member
  const member = db.prepare(
    'SELECT role FROM company_memberships WHERE user_id=? AND company_id=?'
  ).get(user.id, companyId);
  if (!member) return false;
  // explicit override
  const perm = db.prepare(
    'SELECT allowed FROM user_permissions WHERE user_id=? AND company_id=? AND action=?'
  ).get(user.id, companyId, action);
  if (perm) return !!perm.allowed;
  // role default
  return (ROLE_DEFAULTS[user.role] || []).includes(action);
}

// Middleware that requires membership in at least one of the requested companies
// for `action`. For 'all' scope, checks all companies user belongs to.
export function requirePermission(action) {
  return (req, res, next) => {
    if (isOwner(req.user)) return next();
    const ctx = resolveCompanies(req);
    let ok = false;
    if (ctx.all) {
      const members = req.db.prepare(
        'SELECT company_id FROM company_memberships WHERE user_id=?'
      ).all(req.user.id);
      ok = members.every(m => may(req.db, req.user, m.company_id, action));
    } else {
      ok = ctx.ids.every(cid => may(req.db, req.user, cid, action));
    }
    if (!ok) return res.status(403).json({ error: `Permission denied: ${action}` });
    req.companyCtx = ctx;
    next();
  };
}

export function login(db, username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user) return null;
  if (!verifyPassword(user.password_hash, password)) return null;
  if (!user.is_active) return null;
  return user;
}
