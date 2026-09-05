const config = require('../../config/config');
const gemini = require('./gemini.provider');
const ollama = require('./ollama.provider');
const { redact } = require('../services/privacy.service');

const PROVIDERS = { gemini, ollama };

/**
 * Single entry point every service in this codebase must use to talk to an
 * LLM. Enforces AI_ENABLED, picks the configured provider, and falls back
 * Gemini -> Ollama (or the reverse, whichever isn't primary) on failure.
 * Never throws — always resolves to a result object so callers can't crash
 * the rest of the chatbot (and, transitively, can never affect the main app).
 */
async function generate(messages, options = {}) {
  if (!config.aiEnabled) {
    return { ok: false, code: 'AI_DISABLED', text: null, providerUsed: null };
  }

  const primaryName = PROVIDERS[config.aiProvider] ? config.aiProvider : 'gemini';
  const fallbackName = primaryName === 'gemini' ? 'ollama' : 'gemini';

  const order = [primaryName, fallbackName];
  const errors = [];

  for (const name of order) {
    const provider = PROVIDERS[name];
    if (!provider) continue;
    try {
      const text = await provider.generate(messages, options);
      return { ok: true, text, providerUsed: name };
    } catch (err) {
      errors.push({ provider: name, error: redact(err.message) });
    }
  }

  return { ok: false, code: 'ALL_PROVIDERS_FAILED', text: null, providerUsed: null, errors };
}

module.exports = { generate };
