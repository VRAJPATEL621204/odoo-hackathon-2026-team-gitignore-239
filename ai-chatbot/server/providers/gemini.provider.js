const config = require('../../config/config');

const FALLBACK_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
];

/**
 * messages: [{ role: 'system'|'user'|'assistant', content: string }]
 * Returns plain text. Throws on failure/timeout — caller decides fallback.
 */
async function generate(messages, options = {}) {
  const { apiKey, model, timeoutMs } = config.gemini;
  if (!apiKey) {
    throw new Error('GEMINI_NOT_CONFIGURED');
  }

  const systemMsg = messages.find((m) => m.role === 'system');
  const turns = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const body = {
    contents: turns,
    ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
    generationConfig: {
      temperature: options.temperature ?? 0.3,
      maxOutputTokens: options.maxOutputTokens ?? 1024,
    },
  };

  const modelsToTry = Array.from(new Set([model, ...FALLBACK_MODELS].filter(Boolean)));
  let lastError = null;

  for (const m of modelsToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        lastError = new Error(`GEMINI_HTTP_${res.status}`);
        continue;
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
      if (!text) {
        lastError = new Error('GEMINI_EMPTY_RESPONSE');
        continue;
      }
      return text;
    } catch (err) {
      lastError = err;
      if (err.name === 'AbortError') {
        throw err;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error('GEMINI_FAILED');
}

module.exports = { generate, name: 'gemini' };
