import React from 'react';

export default function QuickActions({ actions, onSelect }) {
  if (!actions || !actions.length) return null;
  return (
    <div className="ai-chatbot-quick-actions">
      {actions.map((a) => (
        <button key={a.key} className="ai-chatbot-btn ai-chatbot-btn--quick" onClick={() => onSelect(a)}>
          <span className="ai-chatbot-quick-key">{a.key}</span> {a.label}
        </button>
      ))}
    </div>
  );
}
