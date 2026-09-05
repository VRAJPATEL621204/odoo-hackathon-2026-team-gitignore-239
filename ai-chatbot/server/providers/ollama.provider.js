const config = require('../../config/config');

/**
 * messages: [{ role: 'system'|'user'|'assistant', content: string }]
 * Returns plain text. Throws on failure/timeout — caller decides fallback.
 */
async function generate(messages, options = {}) {
  const { baseUrl, model, timeoutMs } = config.ollama;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          temperature: options.temperature ?? 0.3,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`OLLAMA_HTTP_${res.status}`);
    }

    const data = await res.json();
    const text = data?.message?.content || '';
    if (!text) throw new Error('OLLAMA_EMPTY_RESPONSE');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { generate, name: 'ollama' };
