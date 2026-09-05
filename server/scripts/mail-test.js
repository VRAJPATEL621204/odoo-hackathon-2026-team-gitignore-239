import nodemailer from 'nodemailer';

import { env } from '../src/lib/env.js';

/**
 * Checks the mail configuration and, optionally, sends one test message.
 *
 * A failed payslip send reports "could not send" from deep inside a batch,
 * which says nothing about why. This runs the same connection on its own and
 * prints the provider's actual refusal, which is what identifies the problem:
 * a wrong password reads differently from a blocked port.
 *
 *   npm run mail:test                  verify the connection only
 *   npm run mail:test you@example.com  verify, then send a real message there
 */

const recipient = process.argv[2];
const authenticated = Boolean(env.smtpUser && env.smtpPassword);

console.log('Mail configuration');
console.log(`  host      ${env.smtpHost}:${env.smtpPort}`);
console.log(`  secure    ${env.smtpSecure} ${env.smtpSecure ? '(TLS from the start)' : '(STARTTLS upgrade)'}`);
console.log(`  user      ${env.smtpUser || '(none)'}`);
console.log(`  password  ${env.smtpPassword ? `${env.smtpPassword.length} characters` : '(none)'}`);
console.log(`  from      ${env.mailFrom}`);
console.log(`  mode      ${authenticated ? 'authenticated provider' : 'unauthenticated (Mailpit)'}\n`);

if (!authenticated && env.smtpHost !== 'localhost') {
  console.error('SMTP_USER or SMTP_PASSWORD is empty, but the host is not local.');
  console.error('A real provider will refuse an unauthenticated connection.\n');
}

// A Gmail App Password is 16 characters. Google shows it in four groups of
// four, and pasting it with the spaces is the usual reason a correct password
// is rejected.
if (env.smtpHost.includes('gmail') && env.smtpPassword) {
  if (/\s/.test(env.smtpPassword)) {
    console.error('The password contains spaces. Remove them: Google shows the App Password');
    console.error('in four groups of four, but it must be entered as 16 characters.\n');
  } else if (env.smtpPassword.length !== 16) {
    console.error(`The password is ${env.smtpPassword.length} characters. A Google App Password is 16.`);
    console.error('A normal account password will not work — create one at');
    console.error('https://myaccount.google.com/apppasswords\n');
  }
}

const transport = nodemailer.createTransport({
  host: env.smtpHost,
  port: env.smtpPort,
  secure: env.smtpSecure,
  ...(authenticated
    ? { requireTLS: !env.smtpSecure, auth: { user: env.smtpUser, pass: env.smtpPassword } }
    : { ignoreTLS: true }),
  connectionTimeout: 10000,
  greetingTimeout: 10000,
});

try {
  await transport.verify();
  console.log('Connection and login succeeded.');
} catch (error) {
  console.error('Connection failed.');
  console.error(`  ${error.message}`);

  // The three failures worth naming, because each has a different fix.
  if (error.code === 'EAUTH') {
    console.error('\n  The server rejected the credentials. For Gmail this is almost always');
    console.error('  a normal password used instead of an App Password, or 2-Step');
    console.error('  Verification not being enabled on the account.');
  }
  if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKET') {
    console.error('\n  The connection never completed. A firewall, antivirus or network');
    console.error('  blocking outbound port 587 is the usual cause. Port 465 with');
    console.error('  SMTP_SECURE=true sometimes gets through where 587 does not.');
  }
  process.exit(1);
}

if (!recipient) {
  console.log('\nPass an address to send a test message: npm run mail:test you@example.com');
  process.exit(0);
}

try {
  const info = await transport.sendMail({
    from: env.mailFrom,
    to: recipient,
    subject: `Test message from ${env.companyName}`,
    text: 'If you are reading this, the payroll application can send email.',
  });
  console.log(`\nSent to ${recipient}. Message id ${info.messageId}`);
} catch (error) {
  console.error(`\nThe connection worked but the send failed: ${error.message}`);
  process.exit(1);
}
