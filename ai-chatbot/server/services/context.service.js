const config = require('../../config/config');

/**
 * Lightweight, in-memory, per-conversation context.
 * Stores routing hints (last intent/action/period, pending confirmation)
 * and sliding-window conversation history for multi-turn conversational memory.
 * Never stores raw credentials. In-memory only with TTL.
 */
const store = new Map(); // conversationId -> { data, expiresAt }
const MAX_HISTORY_TURNS = 8;

function get(conversationId) {
  if (!conversationId) return {};
  const entry = store.get(conversationId);
  if (!entry) return {};
  if (Date.now() > entry.expiresAt) {
    store.delete(conversationId);
    return {};
  }
  return entry.data;
}

function set(conversationId, patch) {
  if (!conversationId) return patch;
  const current = get(conversationId);
  const data = { ...current, ...patch };
  store.set(conversationId, { data, expiresAt: Date.now() + config.contextTtlMs });
  return data;
}

function addTurn(conversationId, role, content) {
  if (!conversationId || !content) return;
  const current = get(conversationId);
  const history = Array.isArray(current.history) ? [...current.history] : [];
  history.push({ role, content, timestamp: Date.now() });
  // Keep only the most recent N turns
  const trimmed = history.slice(-MAX_HISTORY_TURNS);
  set(conversationId, { history: trimmed });
}

function getHistory(conversationId) {
  const data = get(conversationId);
  return Array.isArray(data.history) ? data.history : [];
}

function setPendingConfirmation(conversationId, pending) {
  return set(conversationId, {
    pendingConfirmation: { ...pending, expiresAt: Date.now() + config.confirmationTtlMs },
  });
}

function popPendingConfirmation(conversationId) {
  const current = get(conversationId);
  const pending = current.pendingConfirmation;
  if (!pending) return null;
  set(conversationId, { pendingConfirmation: null });
  if (Date.now() > pending.expiresAt) return null;
  return pending;
}

function summarize(conversationId) {
  const { lastIntent, lastAction, lastPeriod, history } = get(conversationId);
  const parts = [];
  if (lastIntent) parts.push(`lastIntent=${lastIntent}`);
  if (lastAction) parts.push(`lastAction=${lastAction}`);
  if (lastPeriod) parts.push(`lastPeriod=${lastPeriod}`);
  if (Array.isArray(history) && history.length > 0) {
    const recent = history.slice(-2).map((h) => `${h.role}: ${h.content.slice(0, 40)}`).join(' | ');
    parts.push(`recentConversation="${recent}"`);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

// Periodic sweep so long-running processes don't accumulate stale entries.
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (now > entry.expiresAt) store.delete(id);
  }
}, Math.min(config.contextTtlMs, 5 * 60 * 1000)).unref();

module.exports = {
  get,
  set,
  addTurn,
  getHistory,
  setPendingConfirmation,
  popPendingConfirmation,
  summarize,
};
