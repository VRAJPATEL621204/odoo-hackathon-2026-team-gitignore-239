/**
 * Thin fetch wrapper for the standalone ai-chatbot service. The host app
 * supplies its own auth token/employeeId via getAuthContext — this file
 * never knows how PeoplePay360 stores those, keeping the two codebases
 * decoupled (see ../README.md "Integration" section).
 */
export function createChatApi({ baseUrl, getAuthContext }) {
  async function request(path, body) {
    const { token, employeeId } = getAuthContext();
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
        'X-Employee-Id': employeeId,
      },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  return {
    status: () => fetch(`${baseUrl}/api/chat/status`).then((r) => r.json()),
    quickActions: (menu = 'ROOT') => {
      const { token, employeeId } = getAuthContext();
      return fetch(`${baseUrl}/api/chat/quick-actions?menu=${menu}`, {
        headers: { Authorization: token, 'X-Employee-Id': employeeId },
      }).then((r) => r.json());
    },
    sendMessage: (conversationId, text) => request('/api/chat/message', { conversationId, text }),
    sendQuickAction: (conversationId, actionId, entities) =>
      request('/api/chat/quick-action', { conversationId, actionId, entities }),
    confirmAction: (conversationId, confirmationId) =>
      request('/api/chat/confirm', { conversationId, confirmationId }),
  };
}
