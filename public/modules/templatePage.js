import { api, esc } from './api.js';
import { toast } from './app.js';

export async function viewTemplate() {
  const t = await api('/invoice-template');
  const fields = [
    { k: 'company_name', l: 'Company Name', def: 'FREECIA PROFESSIONAL' },
    { k: 'company_address', l: 'Company Address', ta: true },
    { k: 'company_phone', l: 'Company Phone' },
    { k: 'company_email', l: 'Company Email' },
    { k: 'default_terms', l: 'Default Terms (e.g. CASH)', def: 'CASH' },
    { k: 'currency', l: 'Currency (e.g. PKR)', def: 'PKR' },
    { k: 'account_bank_name', l: 'Bank Name' },
    { k: 'account_title', l: 'Account Title' },
    { k: 'account_iban', l: 'Bank IBAN / Account No' },
    { k: 'account_easypaisa', l: 'Easypaisa / Wallet No' },
  ];
  return {
    html: `
    <div class="panel"><div class="head">🎨 Invoice Template <span class="pill b">Branding & Layout</span>
      <div class="sp"></div>
      <button class="btn ghost" onclick="window.__previewPdf()">Preview PDF</button>
      <button class="btn" onclick="window.__saveTemplate()">Save Template</button>
    </div>
    <div style="padding:18px;display:grid;gap:20px;grid-template-columns:1fr 1fr">
      <div>
        <div class="head" style="padding:0 0 8px;font-size:14px">Header & Account Details</div>
        <div class="muted" style="font-size:11px;margin-bottom:10px">Top-center shows the <b>selected company's</b> name/address/phone automatically. The fields below are fallback values used when a company has no address/phone set.</div>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
          ${fields.map(f => `
            <div class="field" style="grid-column:${f.ta?'1/-1':'auto'}">
              <label>${f.l}</label>
              ${f.ta ? `<textarea id="t_${f.k}" rows="2">${esc(t[f.k] ?? f.def ?? '')}</textarea>`
                      : `<input id="t_${f.k}" value="${esc(t[f.k] ?? f.def ?? '')}">`}
            </div>`).join('')}
        </div>

        <div class="head" style="padding:12px 0 8px;font-size:14px">Layout Options</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          ${[['show_logo','Show Logo'],['show_account_details','Show Account Details'],['show_terms','Show Terms'],['show_rep','Show Rep']].map(([k,l])=>`
            <label style="display:flex;gap:5px;align-items:center"><input type="checkbox" id="t_${k}" ${t[k]===false?'':'checked'}> ${l}</label>`).join('')}
        </div>

        <div class="field" style="margin-top:14px"><label>Accent Color</label>
          <input type="color" id="t_accent_color" value="${esc(t.accent_color||'#1f2937')}" style="width:60px;height:34px;padding:2px">
        </div>

        <div class="head" style="padding:12px 0 8px;font-size:14px">Logo</div>
        <div class="field"><label>Company Logo (JPEG/PNG — converted to JPEG)</label>
          <input type="file" id="t_logo" accept="image/jpeg,image/png,image/webp">
        </div>
        <div class="row-actions" style="margin-top:8px">
          <button class="btn sm ghost" onclick="window.__uploadLogo()">Upload Logo</button>
          ${t.has_logo ? `<button class="btn sm danger" onclick="window.__removeLogo()">Remove Logo</button>` : ''}
          <span class="muted">${t.has_logo ? '✓ logo set' : 'No logo uploaded'}</span>
        </div>

        <div class="field" style="margin-top:14px"><label>Footer Note</label>
          <textarea id="t_footer_note" rows="3">${esc(t.footer_note||'')}</textarea>
        </div>
      </div>

      <div>
        <div class="head" style="padding:0 0 8px;font-size:14px">Live Preview</div>
        <div id="tplPreview" style="border:1px solid var(--line);border-radius:10px;background:#fff;padding:14px"></div>
      </div>
    </div></div>`,
    mount: () => {
      const renderPreview = () => {
        const g = (k) => document.getElementById('t_' + k).value;
        const accent = document.getElementById('t_accent_color').value;
        const el = document.getElementById('tplPreview');
        el.innerHTML = `
          <div style="display:grid;grid-template-columns:70px 1fr 120px;gap:8px;align-items:start">
            <div style="width:48px;height:48px;border:1px dashed #cbd5e1;border-radius:6px;display:grid;place-items:center;font-size:9px;color:#94a3b8;text-align:center;background:#fff">${document.getElementById('t_logo')?.files?.[0]?.name ? 'LOGO ✓' : 'YOUR LOGO'}</div>
            <div style="text-align:center;min-width:0">
              <div style="font-size:17px;font-weight:800;color:${accent};line-height:1.1">${esc(g('company_name')||'Company')}</div>
              <div style="font-size:11px;color:#6b7280">${esc(g('company_address')||'')}</div>
              <div style="font-size:11px;color:#6b7280">${esc(g('company_phone')||'')}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:20px;font-weight:800;color:${accent};line-height:1.1">INVOICE</div>
              <div style="font-size:11px"><b>Invoice # : F-193</b></div>
              <div style="font-size:11px">Date : 8/1/2026</div>
            </div>
          </div>
          <div class="muted" style="font-size:10px;text-align:center;margin-top:4px">↑ Header shows your selected company's name & details at center, your distribution logo at top-left</div>
          <div style="height:2px;background:${accent};margin:10px 0"></div>
          <div style="font-size:11px;color:#6b7280;font-weight:700">BILL TO</div>
          <div style="font-size:13px;font-weight:700">TRENDS SALON</div>
          <div style="font-size:11px;color:#4b5563">KDA GULSHAN BRANCH · 0310-2787081</div>
          ${document.getElementById('t_show_rep').checked ? `<div style="font-size:12px;margin-top:6px">Terms : ${esc(g('default_terms'))} &nbsp; Rep : RUBAB</div>` : `<div style="font-size:12px;margin-top:6px">Terms : ${esc(g('default_terms'))}</div>`}
          <table style="width:100%;font-size:11px;margin-top:10px;border-collapse:collapse">
            <tr style="background:${accent};color:#fff"><th style="padding:6px;text-align:left">Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>
            <tr style="background:#fafbfc"><td style="padding:6px">KERATIN RECONSTRUCTING 1000ML</td><td style="text-align:center">2</td><td style="text-align:center">24,500</td><td style="text-align:right">49,000</td></tr>
            <tr><td style="padding:6px">FREECIA BLEACH POWDER 500 GM JAR</td><td style="text-align:center">5</td><td style="text-align:center">4,950</td><td style="text-align:right">24,750</td></tr>
          </table>
          <div style="margin-top:8px;text-align:right;font-size:11px">
            <div>SUB-TOTAL <b>73,750</b></div>
            <div style="color:#b91c1c">DISCOUNT 10% -7,375</div>
            <div style="background:${accent};color:#fff;font-weight:800;padding:5px;display:inline-block;min-width:150px">GRAND TOTAL <b>${esc(g('currency')||'PKR')} 66,375.00</b></div>
          </div>
          ${document.getElementById('t_show_account_details').checked ? `<div style="margin-top:10px;background:#f9fafb;padding:8px;font-size:10px;color:#374151">ACCOUNT DETAILS<br>${esc(g('account_bank_name')||'')} : ${esc(g('account_title')||'')} ${esc(g('account_iban')||'')}<br>EASYPAISA : ${esc(g('account_easypaisa')||'')}</div>` : ''}
          <div style="margin-top:10px;font-size:9px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:6px">${esc(g('footer_note')||'')}</div>
        `;
      };
      const fields = ['company_name','company_address','company_phone','company_email','default_terms','currency','account_bank_name','account_title','account_iban','account_easypaisa','footer_note','accent_color','show_logo','show_account_details','show_terms','show_rep'];
      fields.forEach(k => {
        const el = document.getElementById('t_' + k);
        if (el) el.addEventListener('input', renderPreview);
      });
      renderPreview();
      window.__saveTemplate = async () => {
        const body = {};
        ['company_name','company_address','company_phone','company_email','default_terms','currency','account_bank_name','account_title','account_iban','account_easypaisa','footer_note'].forEach(k => body[k] = document.getElementById('t_' + k).value);
        body.accent_color = document.getElementById('t_accent_color').value;
        ['show_logo','show_account_details','show_terms','show_rep'].forEach(k => body[k] = document.getElementById('t_' + k).checked);
        try { await api('/invoice-template', { method:'POST', body }); toast('Template saved'); } catch(e){ toast(e.message, true); }
      };
      window.__previewPdf = () => window.open('/api/invoice-template/preview.pdf', '_blank');
      window.__uploadLogo = async () => {
        const file = document.getElementById('t_logo').files[0];
        if (!file) return toast('Select a logo image first', true);
        const img = await loadImage(file);
        // convert to JPEG base64
        const canvas = document.createElement('canvas');
        const max = 300;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
        try { await api('/invoice-template/logo', { method:'POST', body:{ data } }); toast('Logo uploaded'); viewTemplate(); } catch(e){ toast(e.message, true); }
      };
      window.__removeLogo = async () => { try { await api('/invoice-template/logo', { method:'DELETE' }); toast('Logo removed'); viewTemplate(); } catch(e){ toast(e.message, true); } };
    }
  };
}

function loadImage(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = r.result; };
    r.onerror = rej; r.readAsDataURL(file);
  });
}
