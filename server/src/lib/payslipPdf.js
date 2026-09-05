import PDFDocument from 'pdfkit';

import { env } from './env.js';
import { formatDateOnly } from './dates.js';

/**
 * Renders a payslip as a PDF.
 *
 * The document is built in memory and returned as a Buffer, because it is both
 * streamed to the browser and attached to an email, and generating it twice
 * would risk the two disagreeing.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return `${String(date.getUTCDate()).padStart(2, '0')}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

/**
 * Indian-format rupees without the ₹ sign.
 *
 * pdfkit's built-in Helvetica is WinAnsi-encoded and has no rupee glyph, so
 * printing ₹ would produce a blank box. "INR" in the column header carries the
 * currency instead.
 */
function money(value) {
  return Number(value ?? 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** A label and value pair, as the payslip header uses throughout. */
function field(doc, label, value, x, y, width) {
  doc.fontSize(8).fillColor('#666666').text(label.toUpperCase(), x, y, { width });
  doc.fontSize(10).fillColor('#111111').text(String(value ?? '—'), x, y + 11, { width });
}

export function renderPayslipPdf(payslip) {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  const finished = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.fontSize(16).fillColor('#111111').text(env.companyName, left, 48);
  doc.fontSize(11).fillColor('#555555').text('Payslip', { align: 'left' });

  doc
    .fontSize(10)
    .fillColor('#555555')
    .text(payslip.reference, left, 50, { width, align: 'right' })
    .text(
      `${formatDate(payslip.periodStart)} to ${formatDate(payslip.periodEnd)}`,
      left,
      64,
      { width, align: 'right' }
    );

  doc.moveTo(left, 96).lineTo(left + width, 96).strokeColor('#dddddd').stroke();

  const column = width / 3;
  field(doc, 'Employee', payslip.employee.name, left, 110, column);
  field(doc, 'Department', payslip.employee.department?.name ?? '—', left + column, 110, column);
  field(doc, 'Salary Structure', payslip.structure.name, left + column * 2, 110, column);

  field(doc, 'Contract', payslip.contract?.reference ?? 'None', left, 150, column);
  field(
    doc,
    'Worked / Total Days',
    `${payslip.workedDays} / ${payslip.totalDays}`,
    left + column,
    150,
    column
  );
  field(doc, 'Status', payslip.status, left + column * 2, 150, column);

  // The salary computation, one row per rule, in the order the rules ran.
  let y = 200;
  doc.fontSize(11).fillColor('#111111').text('Salary computation', left, y);
  y += 20;

  const columns = { rule: left, category: left + 220, code: left + 340, amount: left + width };

  doc.fontSize(8).fillColor('#666666');
  doc.text('RULE', columns.rule, y);
  doc.text('CATEGORY', columns.category, y);
  doc.text('CODE', columns.code, y);
  doc.text('AMOUNT (INR)', columns.rule, y, { width, align: 'right' });

  y += 14;
  doc.moveTo(left, y).lineTo(left + width, y).strokeColor('#dddddd').stroke();
  y += 8;

  doc.fontSize(10);
  for (const line of payslip.lines ?? []) {
    // A long structure runs past the bottom of the page; continue on the next.
    if (y > doc.page.height - 140) {
      doc.addPage();
      y = 60;
    }

    doc.fillColor('#111111').text(line.name, columns.rule, y, { width: 210 });
    doc.fillColor('#555555').text(line.category, columns.category, y, { width: 110 });
    doc.text(line.code, columns.code, y, { width: 100 });
    doc
      .fillColor(Number(line.amount) < 0 ? '#b3261e' : '#111111')
      .text(money(line.amount), columns.rule, y, { width, align: 'right' });
    y += 18;
  }

  y += 6;
  doc.moveTo(left, y).lineTo(left + width, y).strokeColor('#dddddd').stroke();
  y += 12;

  const total = (label, value, bold = false) => {
    doc.fontSize(bold ? 12 : 10).fillColor('#111111');
    doc.text(label, columns.rule, y);
    doc.text(money(value), columns.rule, y, { width, align: 'right' });
    y += bold ? 22 : 18;
  };

  total('Basic', payslip.basic);
  total('Gross', payslip.gross);
  total('Net payable', payslip.net, true);

  if (payslip.warnings?.length > 0) {
    y += 6;
    doc.fontSize(9).fillColor('#b3261e').text('Warnings', columns.rule, y);
    y += 14;
    for (const warning of payslip.warnings) {
      doc.fontSize(9).fillColor('#b3261e').text(`• ${warning}`, columns.rule, y, { width });
      y += 13;
    }
  }

  doc
    .fontSize(8)
    .fillColor('#888888')
    .text(
      `Generated ${formatDateOnly(new Date())} · computer generated, no signature required.`,
      left,
      doc.page.height - 70,
      { width, align: 'center' }
    );

  doc.end();
  return finished;
}

/** The filename a downloaded payslip is saved under. */
export function payslipFilename(payslip) {
  const safeName = payslip.employee.name.replace(/[^A-Za-z0-9]+/g, '-');
  const safeReference = payslip.reference.replace(/\//g, '-');
  return `${safeReference}-${safeName}.pdf`;
}
