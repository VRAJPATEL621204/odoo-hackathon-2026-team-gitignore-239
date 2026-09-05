const { redact } = require('../services/privacy.service');

/**
 * Last-resort catch-all. Guarantees the chatbot never leaks a stack trace
 * or raw error to the client, and never lets an uncaught exception here
 * escape into (or crash) the main PeoplePay360 process — this service runs
 * independently, but this is the local backstop regardless.
 */
function errorHandler(err, req, res, _next) {
  console.error('[ai-chatbot] unhandled error:', redact(err?.message || String(err)));
  res.status(200).json({
    success: false,
    type: 'ERROR',
    message: 'The assistant hit an unexpected problem. Please try again.',
    data: null,
    sources: [],
  });
}

module.exports = { errorHandler };
