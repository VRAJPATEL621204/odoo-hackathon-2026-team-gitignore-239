/**
 * Central privacy/data-minimization gate. Every response, tool result, log
 * line, and LLM prompt payload must pass through here. See ai-chatbot spec
 * §9 — this file is the enforcement point for that section.
 */

const SECRET_KEY_PATTERN = /pass(word)?|token|secret|api[_-]?key|reset[_-]?link|otp|pin/i;

// Fields that must be masked (never removed entirely, since "last 4 digits"
// is often still useful) before data leaves the adapter layer.
const MASK_LAST4_PATTERN = /bank[_-]?account|account[_-]?number|national[_-]?id|ssn|aadhaar|pan[_-]?number|card[_-]?number/i;

// Fields that must never appear anywhere outside auth flows the chatbot
// doesn't participate in — dropped entirely, not masked.
const DROP_PATTERN = /pass(word)?(hash)?|token|secret|api[_-]?key|reset[_-]?link|otp/i;

const CREDENTIAL_INTENT_PATTERN =
  /\b(reset|change|forgot|recover)\b.{0,20}\bpassword\b|\bpassword\b.{0,20}\b(reset|change|forgot|recover)\b|\bmy password\b|\b2fa\b|\botp\b|\bapi[_-]?key\b|\bsecurity token\b|\bsession token\b/i;

function isCredentialRequest(text = '') {
  return CREDENTIAL_INTENT_PATTERN.test(text);
}

function maskValue(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return value;
  const str = String(value);
  if (str.length <= 4) return '****';
  return `****${str.slice(-4)}`;
}

/**
 * Recursively walks a plain object/array (as returned by the PeoplePay360
 * adapter) and masks or drops sensitive fields by key name. Never mutates
 * the input.
 */
function maskSensitiveFields(input) {
  if (Array.isArray(input)) return input.map(maskSensitiveFields);
  if (input && typeof input === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(input)) {
      if (DROP_PATTERN.test(key)) continue;
      if (MASK_LAST4_PATTERN.test(key)) {
        out[key] = maskValue(value);
      } else {
        out[key] = maskSensitiveFields(value);
      }
    }
    return out;
  }
  return input;
}

/**
 * Strips anything an LLM provider (including local Ollama) must never see,
 * on top of the masking already applied by the adapter. Defense in depth —
 * this runs again right before a prompt payload is built.
 */
function sanitizeForLLM(data) {
  return maskSensitiveFields(data);
}

/**
 * Redacts secret-shaped values out of free text before it is logged or sent
 * to a provider. Used for error messages, stack traces, and user text.
 */
function redact(text) {
  if (typeof text !== 'string') return text;
  return text.replace(new RegExp(`("?(?:${SECRET_KEY_PATTERN.source})"?\\s*[:=]\\s*)("[^"]*"|'[^']*'|\\S+)`, 'gi'), '$1"[REDACTED]"');
}

/**
 * Last-line-of-defense scan on any payload about to leave this service
 * (API response to the client, or a log line). Returns a redacted deep copy.
 */
function scanOutgoing(payload) {
  const masked = maskSensitiveFields(payload);
  const json = JSON.stringify(masked);
  return JSON.parse(redact(json));
}

module.exports = {
  isCredentialRequest,
  maskSensitiveFields,
  sanitizeForLLM,
  redact,
  scanOutgoing,
};
