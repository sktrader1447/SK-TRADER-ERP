// Invoice template persistence. Stored in app_settings as JSON + base64 JPEG logo.

export const DEFAULT_TEMPLATE = {
  company_name: 'FREECIA PROFESSIONAL',
  company_address: 'R-640 SECTOR 11/C-1 NORTH KARACHI, KARACHI.',
  company_phone: '0300-1550311 / 0371-3511973',
  company_email: '',
  account_bank_name: 'UBL',
  account_title: 'SK TRADER',
  account_iban: 'PK07UNIL0109000348790838',
  account_easypaisa: '0371-3511973',
  default_terms: 'CASH',
  footer_note: 'NOTE: Please do not make any payment without obtaining a proper bill/invoice. Otherwise, the company will not be held responsible for any issues arising from the payment.',
  currency: 'PKR',
  show_logo: true,
  show_account_details: true,
  show_terms: true,
  show_rep: true,
  accent_color: '#1f2937',
};

export function getTemplate(db) {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key='invoice_template'`).get();
  let t = {};
  try { if (row?.value) t = JSON.parse(row.value); } catch (e) { t = {}; }
  return { ...DEFAULT_TEMPLATE, ...t };
}
export function saveTemplate(db, patch) {
  const cur = getTemplate(db);
  const next = { ...cur, ...patch };
  db.prepare(`INSERT INTO app_settings (key,value) VALUES ('invoice_template',?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(JSON.stringify(next));
  return next;
}
export function getLogo(db) {
  return db.prepare(`SELECT value FROM app_settings WHERE key='invoice_logo'`).get()?.value || null;
}
export function setLogo(db, base64Jpeg) {
  db.prepare(`INSERT INTO app_settings (key,value) VALUES ('invoice_logo',?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(base64Jpeg);
}
export function clearLogo(db) {
  db.prepare(`DELETE FROM app_settings WHERE key='invoice_logo'`).run();
}
