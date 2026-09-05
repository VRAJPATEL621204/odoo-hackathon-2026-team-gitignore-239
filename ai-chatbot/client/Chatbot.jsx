import React, { useEffect, useState } from 'react';
import ChatWindow from './ChatWindow';
import { createChatApi } from './api';

/**
 * Drop-in widget for the PeoplePay360 frontend. This is the one integration
 * surface between the two codebases — everything else about the chatbot
 * lives in this folder and is reached only over HTTP.
 *
 * Usage in the host app (e.g. a root layout component):
 *   <Chatbot
 *     apiBaseUrl={process.env.REACT_APP_AI_CHATBOT_URL}
 *     getAuthContext={() => ({ token: getAuthToken(), employeeId: currentUser.id })}
 *     onNavigate={(path) => navigate(path)}
 *   />
 *
 * If the ai-chatbot service is down or unreachable, `status()` rejects and
 * this component renders nothing — the host app is completely unaffected.
 */
export default function Chatbot({ apiBaseUrl, getAuthContext, onNavigate }) {
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [api] = useState(() => createChatApi({ baseUrl: apiBaseUrl, getAuthContext }));

  useEffect(() => {
    let cancelled = false;
    api
      .status()
      .then((res) => {
        if (cancelled) return;
        setAvailable(true);
        setAiEnabled(!!res.aiEnabled);
      })
      .catch(() => {
        // Service unreachable — fail closed, entry point stays hidden.
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (!available) return null;

  return (
    <div className="ai-chatbot-widget">
      {open ? (
        <div className="ai-chatbot-panel">
          <div className="ai-chatbot-header">
            <span>PeoplePay360 Assistant</span>
            {!aiEnabled && <span className="ai-chatbot-badge">Quick actions only</span>}
            <button onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>
          <ChatWindow api={api} onNavigate={onNavigate} />
        </div>
      ) : (
        <button className="ai-chatbot-launcher" onClick={() => setOpen(true)}>
          Chat
        </button>
      )}
    </div>
  );
}
