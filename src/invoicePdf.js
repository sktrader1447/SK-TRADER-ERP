// A minimal but structured PDF generator for the branded sales-invoice template.
// Layout mirrors the supplied F-193.pdf: header branding, invoice meta, Bill-To,
// items table, totals, account details, footer note.

const P = { W: 595.28, H: 841.89, M: 40 }; // A4, 40pt margin
const HELV = '/F1', HELVB = '/F2';

function escPdf(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

// Parse JPEG dimensions from the SOFn marker.
export function jpegDims(buf) {
  let i = 2;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      const h = buf.readUInt16BE(i + 5);
      const w = buf.readUInt16BE(i + 7);
      return { width: w, height: h };
    }
    const len = buf.readUInt16BE(i + 2);
    i += 2 + len;
  }
  return { width: 120, height: 120 };
}

// rough width of text in a given font size (Helvetica avg ~0.5em)
function textWidth(s, size) { return String(s ?? '').length * size * 0.5; }

// ---- amount in words ----
const _ONES = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const _TENS = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
function _twoWords(n) {
  if (n < 20) return _ONES[n];
  return _TENS[Math.floor(n / 10)] + (n % 10 ? '-' + _ONES[n % 10] : '');
}
function _hundredWords(n) {
  if (n < 100) return _twoWords(n);
  return _ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + _twoWords(n % 100) : '');
}
export function amountInWords(amount, currency) {
  const num = Math.round(Number(amount || 0) * 100) / 100;
  const whole = Math.floor(num);
  const paisa = Math.round((num - whole) * 100);
  let n = whole;
  const crore = Math.floor(n / 1e7); n = n % 1e7;
  const lakh = Math.floor(n / 1e5); n = n % 1e5;
  const thousand = Math.floor(n / 1e3); n = n % 1e3;
  const parts = [];
  if (crore) parts.push(_twoWords(crore) + ' Crore');
  if (lakh) parts.push(_twoWords(lakh) + ' Lakh');
  if (thousand) parts.push(_twoWords(thousand) + ' Thousand');
  if (n) parts.push(_hundredWords(n));
  let w = parts.join(' ') || 'Zero';
  if (paisa) w += ' and ' + _twoWords(paisa) + ' Paisa';
  const rupee = currency === 'PKR' ? ' (Rupees)' : '';
  return (currency ? currency + rupee + ' ' : '') + w + ' Only';
}

export function hexToRgb(hex) {
  const h = (hex || '#1f2937').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

export class PdfDoc {
  constructor({ pageW = P.W, pageH = P.H, margin = P.M } = {}) {
    this.pageW = pageW; this.pageH = pageH; this.margin = margin;
    this.pages = [];        // each page: array of stream commands
    this.objs = [];
    this.currentPage = null;
    this.images = {};       // key -> {objIndex, width, height}
    this.newPage();
  }
  newPage() {
    this.currentPage = [];
    this.pages.push(this.currentPage);
  }
  // PDF y from top-down cursor
  cmd(...parts) { this.currentPage.push(parts.join(' ')); }
  text(s, x, y, { size = 10, bold = false, color = '#111827', align = 'left' } = {}) {
    if (s === undefined || s === null) return;
    s = String(s);
    const c = hexToRgb(color);
    let px = x;
    if (align === 'right') px = x - textWidth(s, size);
    if (align === 'center') px = x - textWidth(s, size) / 2;
    this.cmd(`BT ${bold ? HELVB : HELV} ${size} Tf ${c.r} ${c.g} ${c.b} rg 1 0 0 1 ${px.toFixed(2)} ${y.toFixed(2)} Tm (${escPdf(s)}) Tj ET`);
  }
  line(x1, y1, x2, y2, { width = 0.6, color = '#d1d5db' } = {}) {
    const c = hexToRgb(color);
    this.cmd(`${c.r} ${c.g} ${c.b} RG ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }
  rect(x, y, w, h, { fill, stroke = '#d1d5db', width = 0.6, radius = 0 } = {}) {
    if (fill) { const c = hexToRgb(fill); this.cmd(`${c.r} ${c.g} ${c.b} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`); }
    if (stroke) { const c = hexToRgb(stroke); this.cmd(`${c.r} ${c.g} ${c.b} RG ${width} w ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`); }
  }
  // top-down coordinate helpers
  textTD(s, x, yTop, opts) {
    // yTop is distance from top; convert to PDF bottom-up
    this.text(s, x, this.pageH - yTop, opts);
  }
  lineTD(x1, y1, x2, y2, opts) { this.line(x1, this.pageH - y1, x2, this.pageH - y2, opts); }
  rectTD(x, yTop, w, h, opts) { this.rect(x, this.pageH - (yTop + h), w, h, opts); }

  addJpeg(key, { width, height, data }) {
    // data: raw JPEG bytes (Buffer), width/height in pixels (for DCTDecode we provide them in the XObject)
    this.images[key] = { width, height, data };
  }
  image(key, x, yTop, w, h) {
    const img = this.images[key];
    if (!img) return;
    // x,y bottom-left in PDF coords
    const blX = x, blY = this.pageH - (yTop + h);
    this.cmd(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${blX.toFixed(2)} ${blY.toFixed(2)} cm /Img${key} Do Q`);
  }

  build() {
    // Assemble: fonts, images, pages, catalog, xref
    const objs = [];
    const push = (o) => { objs.push(o); return objs.length; };
    // font objects (objects 1,2)
    const fontObjs = {
      F1: push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`),
      F2: push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`),
    };
    // image objects
    const imgRefs = {};
    for (const key of Object.keys(this.images)) {
      const img = this.images[key];
      const dict = `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.data.length} >>`;
      push({ header: dict, stream: img.data });
      imgRefs[key] = objs.length;
    }
    const resDict = `<< /Font << /F1 ${fontObjs.F1} 0 R /F2 ${fontObjs.F2} 0 R >> /XObject << ${Object.keys(imgRefs).map(k => `/Img${k} ${imgRefs[k]} 0 R`).join(' ')} >> >>`;
    // pages
    const pageRefs = [];
    for (const page of this.pages) {
      const stream = page.join('\n');
      const cobj = push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
      const pobj = push(`<< /Type /Page /Parent ${0} 0 R /MediaBox [0 0 ${this.pageW} ${this.pageH}] /Resources ${resDict} /Contents ${cobj} 0 R >>`);
      pageRefs.push(pobj);
    }
    const pagesRef = push(`<< /Type /Pages /Kids [ ${pageRefs.map(p => `${p} 0 R`).join(' ')} ] /Count ${pageRefs.length} >>`);
    // fix Parent references in each page
    for (let i = 0; i < pageRefs.length; i++) {
      objs[pageRefs[i] - 1] = objs[pageRefs[i] - 1].replace('${0} 0 R', `${pagesRef} 0 R`);
    }
    const catalogRef = push(`<< /Type /Catalog /Pages ${pagesRef} 0 R >>`);
    const infoRef = push(`<< /Title (Invoice) /Producer (ERP Suite) >>`);

    // serialize
    let out = `%PDF-1.4\n`;
    const offsets = [0];
    let pos = out.length;
    objs.forEach((o, i) => {
      offsets.push(pos);
      if (typeof o === 'object' && o !== null && o.stream) {
        out += `${i + 1} 0 obj\n${o.header}\nstream\n`;
        // binary stream written via latin1
        out += o.stream.toString('latin1');
        out += `\nendstream\nendobj\n`;
      } else {
        out += `${i + 1} 0 obj\n${o}\nendobj\n`;
      }
      pos = out.length;
    });
    const xrefStart = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (let i = 0; i < objs.length; i++) out += String(offsets[i + 1]).padStart(10, '0') + ' 00000 n \n';
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogRef} 0 R /Info ${infoRef} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    return Buffer.from(out, 'latin1');
  }
}

// ---------------- invoice layout ----------------
export function buildInvoicePdf({ template, invoice, lines, logo, company }) {
  const d = new PdfDoc();
  const t = template || {};
  const co = company || {};
  if (logo && t.show_logo !== false) {
    try {
      const buf = Buffer.from(logo, 'base64');
      const dims = jpegDims(buf);
      d.addJpeg('logo', { width: dims.width, height: dims.height, data: buf });
      t.logo = true;
    } catch (e) { t.logo = false; }
  }
  const T = (key, def) => (t[key] !== undefined && t[key] !== '' ? t[key] : def);
  const accent = T('accent_color', '#1f2937');
  const num = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n) => `${T('currency', 'PKR')} ${num(n)}`;
  const top = { x: d.margin, right: d.pageW - d.margin };
  const centerX = d.pageW / 2;
  let y = d.margin;

  // ---- header ----
  // top-left: distribution logo
  if (t.logo && template.show_logo !== false) {
    const logoSide = 48;
    d.image('logo', top.x, y, logoSide, logoSide);
  }
  // top-right: INVOICE title + meta
  const metaTop = d.margin + 4;
  d.textTD('INVOICE', top.right, metaTop, { size: 22, bold: true, align: 'right', color: accent });
  d.textTD(`Invoice # : ${invoice.invoice_no}`, top.right, metaTop + 28, { size: 10, align: 'right', bold: true });
  d.textTD(`Date : ${invoice.invoice_date}`, top.right, metaTop + 42, { size: 10, align: 'right' });
  // top-center: the selected company's name + its address/phone
  const coName = co.name || T('company_name', '');
  const coAddr = co.address || T('company_address', '');
  const coPhone = co.phone || T('company_phone', '');
  const coEmail = co.email || T('company_email', '');
  let cy = d.margin + 4;
  if (coName) d.textTD(coName, centerX, cy, { size: 17, bold: true, color: accent, align: 'center' });
  cy += 20;
  if (coAddr) { d.textTD(coAddr, centerX, cy, { size: 9, color: '#4b5563', align: 'center' }); cy += 12; }
  if (coPhone) { d.textTD(coPhone, centerX, cy, { size: 9, color: '#4b5563', align: 'center' }); cy += 12; }
  if (coEmail) { d.textTD(coEmail, centerX, cy, { size: 9, color: '#4b5563', align: 'center' }); cy += 12; }

  y = Math.max(y, metaTop + 60, cy + 8);
  // divider
  d.lineTD(top.x, y, top.right, y, { width: 1, color: accent });
  y += 10;

  // ---- Bill To (left) ----
  const billColW = (top.right - top.x) * 0.55;
  d.textTD('BILL TO', top.x, y, { size: 8.5, bold: true, color: '#6b7280' });
  y += 14;
  d.textTD(invoice.customer_name || '', top.x, y, { size: 11, bold: true }); y += 14;
  if (invoice.customer_address) { d.textTD(invoice.customer_address, top.x, y, { size: 9, color: '#4b5563' }); y += 12; }
  if (invoice.customer_phone) { d.textTD(invoice.customer_phone, top.x, y, { size: 9, color: '#4b5563' }); y += 12; }
  const billY = y + 6;

  // ---- right column: Terms & Rep + Account details ----
  const rightX = top.x + billColW;
  let ry = d.margin + 20;
  if (template.show_terms !== false) { d.textTD(`Terms : ${T('default_terms', 'CASH')}`, rightX, ry, { size: 9 }); ry += 14; }
  if (template.show_rep !== false && invoice.booker_name) { d.textTD(`Rep : ${invoice.booker_name}`, rightX, ry, { size: 9 }); ry += 14; }
  y = Math.max(y, ry);

  // ---- account details box ----
  let yAfterBill = Math.max(y, billY);
  if (template.show_account_details !== false && (t.account_bank || t.account_easypaisa)) {
    yAfterBill += 8;
    d.rectTD(top.x, yAfterBill, top.right - top.x, 52, { fill: '#f9fafb', stroke: '#e5e7eb' });
    d.textTD('ACCOUNT DETAILS', top.x + 10, yAfterBill + 6, { size: 7.5, bold: true, color: '#6b7280' });
    let ay = yAfterBill + 18;
    if (t.account_bank) d.textTD(`${t.account_bank_name || 'Bank'} : ${t.account_title || ''}  ${t.account_iban || ''}`, top.x + 10, ay, { size: 8.5, color: '#374151' });
    if (t.account_easypaisa) { ay += 12; d.textTD(`EASYPAISA : ${t.account_easypaisa}`, top.x + 10, ay, { size: 8.5, color: '#374151' }); }
    yAfterBill += 62;
  }
  y = yAfterBill;
  d.lineTD(top.x, y, top.right, y, { width: 0.8, color: '#e5e7eb' });
  y += 8;

  // ---- items table ----
  const colX = {
    item: top.x, qty: top.right - 150, rate: top.right - 90, amount: top.right,
  };
  const rowH = 20;
  const headerH = 20;
  // header
  d.rectTD(top.x, y, top.right - top.x, headerH, { fill: accent });
  d.textTD('Item', colX.item + 8, y + 6, { size: 8.5, bold: true, color: '#ffffff' });
  d.textTD('Qty', colX.qty - 4, y + 6, { size: 8.5, bold: true, color: '#ffffff', align: 'right' });
  d.textTD('Rate', colX.rate - 4, y + 6, { size: 8.5, bold: true, color: '#ffffff', align: 'right' });
  d.textTD('Amount', colX.amount - 8, y + 6, { size: 8.5, bold: true, color: '#ffffff', align: 'right' });
  y += headerH;
  // rows
  const maxItemW = colX.qty - top.x - 16;
  let rowIndex = 0;
  for (const l of lines) {
    const desc = l.description || '';
    // wrap desc
    const wrapped = wrapText(desc, maxItemW, 8.5);
    const rh = Math.max(rowH, 10 + wrapped.length * 12);
    if (y + rh > d.pageH - 60) { d.newPage(); y = d.margin; }
    const stripe = rowIndex % 2 === 0 ? '#fafbfc' : '#ffffff';
    d.rectTD(top.x, y, top.right - top.x, rh, { fill: stripe, stroke: '#e5e7eb' });
    let ly = y + 6;
    for (const w of wrapped) { d.textTD(w, colX.item + 8, ly, { size: 8.5, color: '#374151' }); ly += 12; }
    d.textTD(String(l.qty), colX.qty - 4, y + rh / 2 - 3, { size: 8.5, align: 'right' });
    d.textTD(num(l.rate), colX.rate - 4, y + rh / 2 - 3, { size: 8.5, align: 'right' });
    d.textTD(num(l.amount), colX.amount - 8, y + rh / 2 - 3, { size: 8.5, align: 'right', bold: true });
    y += rh;
    rowIndex++;
  }
  // qty count
  d.textTD(`SUB-TOTAL  (${lines.length} items)`, top.x + 8, y + 4, { size: 8.5, bold: true });
  // totals right block
  const sub = lines.reduce((s, l) => s + (l.amount || 0), 0);
  const discAmt = invoice.discount_amount || 0;
  const discPct = invoice.discount_pct || 0;
  const deliv = invoice.delivery_charge || 0;
  const net = invoice.net_total || (sub - discAmt + deliv);
  const tlX = colX.qty;
  let ty = y + 4;
  d.textTD('SUB-TOTAL', tlX, ty, { size: 9, align: 'right', bold: true }); d.textTD(num(sub), colX.amount - 8, ty, { size: 9, align: 'right' }); ty += 16;
  if (discAmt) { d.textTD(`DISCOUNT ${discPct}%`, tlX, ty, { size: 9, align: 'right', color: '#b91c1c' }); d.textTD(`-${num(discAmt)}`, colX.amount - 8, ty, { size: 9, align: 'right', color: '#b91c1c' }); ty += 16; }
  if (deliv) { d.textTD('DELIVERY', tlX, ty, { size: 9, align: 'right' }); d.textTD(num(deliv), colX.amount - 8, ty, { size: 9, align: 'right' }); ty += 16; }
  d.rectTD(colX.qty - 8, ty - 6, colX.amount - colX.qty + 8, 26, { fill: accent });
  d.textTD('GRAND TOTAL', tlX, ty + 4, { size: 10, align: 'right', bold: true, color: '#ffffff' });
  d.textTD(money(net), colX.amount - 8, ty + 4, { size: 10, align: 'right', bold: true, color: '#ffffff' });

  // ---- amount in words ----
  const words = amountInWords(net, T('currency', 'PKR'));
  const wordsY = ty + 34;
  d.textTD('Amount in words :', top.x + 8, wordsY, { size: 8.5, bold: true, color: '#374151' });
  const maxWordsW = top.right - top.x - 24;
  const wordsLines = wrapText(words, maxWordsW, 8.5);
  let wy = wordsY + 12;
  for (const wl of wordsLines) { d.textTD(wl, top.x + 8, wy, { size: 8.5, color: '#374151' }); wy += 12; }
  y = Math.max(y, wy);

  // ---- footer note ----
  if (T('footer_note', '')) {
    y += 20;
    d.lineTD(top.x, y, top.right, y, { width: 0.8, color: '#e5e7eb' });
    y += 8;
    const note = T('footer_note').replace(/^NOTE:\s*/i, '');
    d.textTD('NOTE:', top.x, y, { size: 8, bold: true, color: '#6b7280' });
    d.textTD(note, top.x + 34, y, { size: 8, color: '#6b7280' });
  }
  return d.build();
}

function wrapText(s, maxW, size) {
  const words = String(s ?? '').split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (textWidth(test, size) <= maxW || !cur) cur = test;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}
