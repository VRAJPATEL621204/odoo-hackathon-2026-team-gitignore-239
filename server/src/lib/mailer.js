import nodemailer from 'nodemailer';

import { env } from './env.js';

/**
 * Sending payslips.
 *
 * Uses the SMTP provider configured through the environment. The same
 * transport handles local providers and production email services.
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
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      // Authenticated providers must upgrade the connection before the password
      // crosses the wire. requireTLS makes nodemailer fail rather than fall
      // back to plaintext.
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
