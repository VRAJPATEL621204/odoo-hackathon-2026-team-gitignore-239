import React, { useState } from 'react';

export default function InputBox({ onSend, disabled }) {
  const [value, setValue] = useState('');

  function submit(e) {
    e.preventDefault();
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue('');
  }

  return (
    <form className="ai-chatbot-input" onSubmit={submit}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ask a question, e.g. 'How many leaves do I have?'"
        disabled={disabled}
      />
      <button type="submit" disabled={disabled || !value.trim()}>
        Send
      </button>
    </form>
  );
}
