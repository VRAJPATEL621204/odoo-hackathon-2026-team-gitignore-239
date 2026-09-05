/**
 * Thin fetch wrapper for the AI Chatbot service.
 * Supports token / session forwarding to port 4500.
 */
const defaultBaseUrl =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_AI_CHATBOT_URL) ||
  (typeof window !== 'undefined' && window.location && window.location.hostname
    ? `${window.location.protocol}//${window.location.hostname}:4500`
    : 'http://localhost:4500');

export function createChatApi({ baseUrl = defaultBaseUrl, getAuthContext } = {}) {
  async function request(path, body) {
    const { token, employeeId } = (getAuthContext ? getAuthContext() : {}) || {};
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token || 'Bearer peopay360-session',
        'X-Employee-Id': String(employeeId || '1'),
      },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  return {
    status: () => fetch(`${baseUrl}/api/chat/status`).then((r) => r.json()).catch(() => ({ ok: false })),
    quickActions: (menu = 'ROOT') => {
      const { token, employeeId } = (getAuthContext ? getAuthContext() : {}) || {};
      return fetch(`${baseUrl}/api/chat/quick-actions?menu=${menu}`, {
        headers: {
          Authorization: token || 'Bearer peopay360-session',
          'X-Employee-Id': String(employeeId || '1'),
        },
      }).then((r) => r.json());
    },
    sendMessage: (conversationId, text) => request('/api/chat/message', { conversationId, text }),
    sendQuickAction: (conversationId, actionId, entities) =>
      request('/api/chat/quick-action', { conversationId, actionId, entities }),
    confirmAction: (conversationId, confirmationId) =>
      request('/api/chat/confirm', { conversationId, confirmationId }),
  };
}
