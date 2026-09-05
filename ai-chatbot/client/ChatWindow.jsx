import React, { useEffect, useRef, useState } from 'react';
import Message from './Message';
import QuickActions from './QuickActions';
import InputBox from './InputBox';

export default function ChatWindow({ api, onNavigate }) {
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [quickActions, setQuickActions] = useState([]);
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    api.quickActions('ROOT').then((res) => setQuickActions(res.quickActions || []));
  }, [api]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function applyResult(result) {
    setConversationId(result.conversationId);
    setMessages((prev) => [...prev, { role: 'bot', ...result }]);
    setQuickActions(result.quickActions || []);
  }

  async function handleSend(text) {
    setMessages((prev) => [...prev, { role: 'user', type: 'TEXT', message: text }]);
    setBusy(true);
    try {
      const result = await api.sendMessage(conversationId, text);
      applyResult(result);
    } finally {
      setBusy(false);
    }
  }

  async function handleQuickAction(action) {
    setMessages((prev) => [...prev, { role: 'user', type: 'TEXT', message: action.label }]);
    setBusy(true);
    try {
      const result = await api.sendQuickAction(conversationId, action.actionId, {});
      applyResult(result);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm(confirmationId) {
    setBusy(true);
    try {
      const result = await api.confirmAction(conversationId, confirmationId);
      applyResult(result);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ai-chatbot-window">
      <div className="ai-chatbot-messages">
        {messages.map((m, i) => (
          <Message key={i} msg={m} onConfirm={handleConfirm} onNavigate={onNavigate} />
        ))}
        <div ref={endRef} />
      </div>
      <QuickActions actions={quickActions} onSelect={handleQuickAction} />
      <InputBox onSend={handleSend} disabled={busy} />
    </div>
  );
}
