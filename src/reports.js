// Report document construction: PDF and Excel exports with metadata header.
// Avoids external binaries by producing well-formed documents directly.

const now = () => new Date().toISOString();
const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

export function reportMeta(opts) {
  const n = new Date();
  return {
    report_title: opts.title || 'ERP Report',
    report_type: opts.type || '',
    company_name: opts.company_name || 'All Companies',
    date_range: `${opts.date_from || '...'} — ${opts.date_to || '...'}`,
    report_number: opts.report_number || `RP-${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`,
    reference_number: opts.reference_number || '',
    generation_time: n.toLocaleString(),
  };
}

// --- PDF (minimal valid PDF via raw object stream) ---
function escPdf(s) {
  return String(s ?? '').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
}

export function buildPdf({ meta, columns, rows, filename = 'report.pdf' }) {
  return pdfMinimal({ title: meta.report_title, metaText: `${meta.company_name} | ${meta.date_range} | #${meta.report_number}`, columns, rows });
}

function pdfMinimal({ title, metaText, columns, rows }) {
  let objs = [];
  const push = (obj) => { objs.push(obj); return objs.length; };
  const kids = [];
  const nCols = Math.min(columns.length, 8);
  const colW = (515) / Math.max(nCols,1);
  const fontRef = push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);
  let pages = [];
  const addPage = (lines) => {
    const contentObj = push(`<< /Length ${lines.length} >>\nstream\n${lines.join('\n')}\nendstream`);
    const pageObj = push(`<< /Type /Page /Parent ${pageTreeRef} /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 ${fontRef} 0 R >> >> /Contents ${contentObj} 0 R >>`);
    kids.push(pageObj);
  };
  let pageTreeRef = 0;
  const rootRef = push(`<< /Type /Pages /Kids [  ] /Count 0 >>`);
  pageTreeRef = rootRef;

  // build line content
  let y = 790;
  let lines = [];
  lines.push(`BT /F1 16 Tf 40 ${y} Td (${escPdf(title)}) Tj ET`); y -= 22;
  lines.push(`BT /F1 9 Tf 40 ${y} Td (${escPdf(metaText)}) Tj ET`); y -= 16;
  lines.push(`BT /F1 9 Tf 40 ${y} Td (Generated ${escPdf(now())}) Tj ET`); y -= 20;
  // header row
  for (let i=0;i<nCols;i++){
    lines.push(`BT /F1 8 Tf ${(40+i*colW).toFixed(1)} ${y} Td (${escPdf(columns[i].label).slice(0,22)}) Tj ET`);
  }
  y -= 14;
  let rc = 0;
  for (const r of rows) {
    if (y < 50) { pages.push(lines); lines = []; y = 800; }
    if (rc > 1500) break;
    for (let i=0;i<nCols;i++){
      lines.push(`BT /F1 8 Tf ${(40+i*colW).toFixed(1)} ${y} Td (${escPdf(r[columns[i].key]).slice(0,Math.floor(colW/5))}) Tj ET`);
    }
    y -= 12; rc++;
  }
  pages.push(lines);

  // assemble pages
  const pageObjs = [];
  for (const pl of pages) {
    const content = `BT /F1 9 Tf\n` + pl.join('\n') + `\nET`;
    const cObj = push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const pObj = push(`<< /Type /Page /Parent ${rootRef} 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 ${fontRef} 0 R >> >> /Contents ${cObj} 0 R >>`);
    pageObjs.push(pObj);
  }
  // rebuild root with kids
  const kidsRefs = pageObjs.map(p=>`${p} 0 R`).join(' ');
  // need to update root object index; simpler: we used rootRef earlier as placeholder, override it
  // Since objs is array indexed 1.., replace root object string
  objs[rootRef-1] = `<< /Type /Pages /Kids [ ${kidsRefs} ] /Count ${pageObjs.length} >>`;

  const catalogRef = push(`<< /Type /Catalog /Pages ${rootRef} 0 R >>`);
  const header = `%PDF-1.4\n`;
  let body = '';
  objs.forEach((o,i)=>{ body += `${i+1} 0 obj\n${o}\nendobj\n`; });
  const offsets = [];
  let pos = header.length;
  offsets.push(pos);
  // compute offsets properly
  let stream = header;
  objs.forEach((o,i)=>{ stream += `${i+1} 0 obj\n${o}\nendobj\n`; });
  // xref
  let xrefStart = stream.length;
  let xref = `xref\n0 ${objs.length+1}\n0000000000 65535 f \n`;
  let cum = header.length;
  for (let i=0;i<objs.length;i++){
    xref += String(cum).padStart(10,'0') + ' 00000 n \n';
    cum += `\n${i+1} 0 obj\n${objs[i]}\nendobj\n`.length;
  }
  stream += xref + `trailer\n<< /Size ${objs.length+1} /Root ${catalogRef} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(stream, 'latin1');
}

// --- Excel (SpreadsheetML 2003 XML, opens in Excel & LibreOffice) ---
export function buildExcel({ meta, columns, rows, filename = 'report.xlsx', companyLogo }) {
  const sheetName = String(meta.report_type || 'Report').replace(/[\\*?:/\[\]]/g,' ').slice(0,31);
  let body = '';
  body += `<Row><Cell ss:StyleID="Title"><Data ss:Type="String">${esc(meta.report_title)}</Data></Cell></Row>`;
  body += `<Row><Cell ss:StyleID="Meta"><Data ss:Type="String">${esc(meta.company_name)} | ${esc(meta.date_range)}</Data></Cell></Row>`;
  body += `<Row><Cell ss:StyleID="Meta"><Data ss:Type="String">Report # ${esc(meta.report_number)} | Ref # ${esc(meta.reference_number)} | ${esc(meta.generation_time)}</Data></Cell></Row>`;
  body += `<Row/>`;
  let head = '<Row>';
  for (const c of columns) head += `<Cell ss:StyleID="Head"><Data ss:Type="String">${esc(c.label)}</Data></Cell>`;
  head += '</Row>';
  body += head;
  for (const r of rows) {
    let row = '<Row>';
    for (const c of columns) {
      const v = r[c.key];
      const isNumeric = typeof v === 'number' ||
        (typeof v === 'string' && v.trim() !== '' && /^-?[\d.,]+$/.test(v.trim()));
      if (isNumeric) {
        const num = Number(String(v).replace(/,/g,''));
        row += `<Cell><Data ss:Type="Number">${Number.isNaN(num)?0:num}</Data></Cell>`;
      } else {
        row += `<Cell><Data ss:Type="String">${esc(v)}</Data></Cell>`;
      }
    }
    row += '</Row>';
    body += row;
  }
  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Title" ss:Name="Title"><Font ss:Bold="1" ss:Size="14"/></Style>
  <Style ss:ID="Meta"><Font ss:Size="10" ss:Color="#666666"/></Style>
  <Style ss:ID="Head"><Font ss:Bold="1"/><Interior ss:Color="#DCE6F1" ss:Pattern="Solid"/></Style>
 </Styles>
 <Worksheet ss:Name="${sheetName}">
  <Table>
   ${body}
  </Table>
 </Worksheet>
</Workbook>`;
  return Buffer.from(xml, 'utf8');
}
