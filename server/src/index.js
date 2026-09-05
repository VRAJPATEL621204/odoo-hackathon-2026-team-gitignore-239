import { env } from './lib/env.js';
import { prisma } from './lib/prisma.js';
import { createApp } from './app.js';

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`PeoplePay360 API listening on http://localhost:${env.port}`);
});

/**
 * Close the HTTP server and the database pool on shutdown so `node --watch`
 * restarts and Ctrl+C both release the port and the connections cleanly.
 */
async function shutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down.`);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
