import nodemailer from 'nodemailer';

import { env } from './env.js';

/**
 * Sending payslips.
 *
 * Points at Mailpit in development, which accepts every message and shows it at
 * http://localhost:8025 instead of delivering it. That makes the send a real
 * SMTP conversation with a real PDF attached — demoable offline, with no
 * external mail provider and no risk of actually emailing anybody.
 */

let transport;

function getTransport() {
  // Created once, lazily: building it at import time would open a connection
  // during tests that never send anything.
  if (!transport) {
    const authenticated = Boolean(env.smtpUser && env.smtpPassword);

    transport = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      // Without credentials this is Mailpit, which speaks plain SMTP on 1025
      // and has no TLS to offer. With credentials it is a real provider, so the
      // connection must be upgraded before the password crosses the wire —
      // requireTLS makes nodemailer fail rather than fall back to plaintext.
      ...(authenticated
        ? { requireTLS: !env.smtpSecure, auth: { user: env.smtpUser, pass: env.smtpPassword } }
        : { ignoreTLS: true }),
    });
  }
  return transport;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function periodLabel(payslip) {
  const start = new Date(payslip.periodStart);
  return `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
}

/**
 * Emails one payslip with its PDF attached.
 *
 * Returns what happened rather than throwing, because sending a batch must not
 * stop at the first employee with a bad address: the caller reports which ones
 * went and which did not.
 */
export async function sendPayslipEmail({ payslip, pdf, filename }) {
  const to = payslip.employee.workEmail;
  if (!to) {
    return { ok: false, employee: payslip.employee.name, error: 'No work email address.' };
  }

  const period = periodLabel(payslip);

  try {
    await getTransport().sendMail({
      from: env.mailFrom,
      to,
      subject: `Payslip for ${period} — ${env.companyName}`,
      text: [
        `Hello ${payslip.employee.name},`,
        '',
        `Your payslip for ${period} is attached.`,
        '',
        `Reference: ${payslip.reference}`,
        `Net payable: ${Number(payslip.net).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
        '',
        'This is an automated message from the payroll system.',
        env.companyName,
      ].join('\n'),
      attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
    });

    return { ok: true, employee: payslip.employee.name, to };
  } catch (error) {
    return { ok: false, employee: payslip.employee.name, to, error: error.message };
  }
}
