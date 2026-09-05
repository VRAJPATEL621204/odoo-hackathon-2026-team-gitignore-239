import React, { useState, useEffect, useRef } from 'react';
import { createChatApi } from './api.js';
import Message from './Message.jsx';
import './ai-chatbot.css';

const STORAGE_KEY = 'peopay360_standalone_sessions';

function createNewSession() {
  const id = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  return {
    id,
    title: 'New Conversation',
    conversationId: null,
    messages: [],
    quickActions: [],
    createdAt: new Date().toISOString(),
  };
}

/**
 * Standalone Moveable Material You AI Chatbot Widget
 * 
 * Embedded directly into PeoplePay360 with zero interference to existing pages.
 */
export default function AiChatbotWidget({
  apiUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_AI_CHATBOT_URL) || 'http://localhost:4500',
  user = { id: '1', name: 'User', token: '' },
  onNavigate = (path) => { window.location.pathname = path; },
  defaultOpen = false,
  quickLinks = [
    { id: 'leave', label: 'Leave', fullTitle: 'Leave & Time Off', path: '/time-off/requests', sub: 'Apply vacation & view balance' },
    { id: 'payroll', label: 'Payroll', fullTitle: 'Payroll & Payslips', path: '/payroll/payslips', sub: 'Gross, net & deductions' },
    { id: 'attendance', label: 'Attendance', fullTitle: 'Attendance Tracker', path: '/attendance', sub: 'Daily check-in logs' },
    { id: 'employees', label: 'Employees', fullTitle: 'Employee Directory', path: '/employees', sub: 'Team structure & roles' },
    { id: 'contracts', label: 'Contracts', fullTitle: 'Employment Contracts', path: '/contracts', sub: 'Terms & active agreements' },
  ],
}) {
  const [isModalOpen, setIsModalOpen] = useState(defaultOpen);
  const [isMaximized, setIsMaximized] = useState(false);
  const [showSessionsDrawer, setShowSessionsDrawer] = useState(false);
  // Minimized to a small edge tab when the "Ask AI" pill is in the way of
  // page content; clicking the tab restores the pill without opening the chat.
  const [isMinimized, setIsMinimized] = useState(false);

  // Position state (moveable)
  const [modalPos, setModalPos] = useState({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const modalRef = useRef(null);

  // Initial position: Bottom-right corner
  useEffect(() => {
    const defaultX = Math.max(16, window.innerWidth - 540);
    const defaultY = Math.max(24, window.innerHeight - 680);
    setModalPos({ x: defaultX, y: defaultY });
  }, []);

  // API instance configured with auth context
  const [api] = useState(() =>
    createChatApi({
      baseUrl: apiUrl,
      getAuthContext: () => ({
        token: user?.token || 'Bearer peopay360-session',
        employeeId: String(user?.id || '1'),
      }),
    })
  );

  // Sessions state persisted to localStorage
  const [sessions, setSessions] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.error('Failed to load chat sessions:', e);
    }
    return [createNewSession()];
  });

  const [activeSessionId, setActiveSessionId] = useState(() => sessions[0]?.id || null);
  const [inputValue, setInputValue] = useState('');
  const [busy, setBusy] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch (e) {
      console.error('Failed to persist chat sessions:', e);
    }
  }, [sessions]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];

  useEffect(() => {
    if (activeSession && activeSession.messages.length === 0) {
      api
        .quickActions('ROOT')
        .then((res) => {
          if (res.quickActions) {
            updateActiveSession((prev) => ({
              ...prev,
              quickActions: res.quickActions,
            }));
          }
        })
        .catch(() => {});
    }
  }, [activeSessionId]);

  useEffect(() => {
    if (isModalOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeSession?.messages, busy, isModalOpen]);

  function updateActiveSession(updater) {
    setSessions((prev) =>
      prev.map((s) => (s.id === activeSessionId ? updater(s) : s))
    );
  }

  function handleNewChat() {
    const newSess = createNewSession();
    setSessions((prev) => [newSess, ...prev]);
    setActiveSessionId(newSess.id);
    setInputValue('');
    setShowSessionsDrawer(false);
  }

  function handleDeleteSession(e, sessionId) {
    e.stopPropagation();
    if (sessions.length <= 1) {
      const fresh = createNewSession();
      setSessions([fresh]);
      setActiveSessionId(fresh.id);
      return;
    }
    const filtered = sessions.filter((s) => s.id !== sessionId);
    setSessions(filtered);
    if (activeSessionId === sessionId) {
      setActiveSessionId(filtered[0].id);
    }
  }

  function applyResultToActiveSession(result) {
    updateActiveSession((prev) => {
      const newMessages = [...prev.messages, { role: 'bot', ...result }];
      return {
        ...prev,
        conversationId: result.conversationId || prev.conversationId,
        messages: newMessages,
        quickActions: result.quickActions || prev.quickActions || [],
      };
    });
  }

  async function handleSend(textToSend) {
    const text = (textToSend || inputValue).trim();
    if (!text || busy || !activeSession) return;

    const isFirstUserMsg = !activeSession.messages.some((m) => m.role === 'user');
    const newTitle = isFirstUserMsg
      ? text.length > 26
        ? text.substring(0, 26) + '...'
        : text
      : activeSession.title;

    updateActiveSession((prev) => ({
      ...prev,
      title: newTitle,
      messages: [...prev.messages, { role: 'user', type: 'TEXT', message: text }],
    }));

    setInputValue('');
    setBusy(true);

    try {
      const result = await api.sendMessage(activeSession.conversationId, text);
      applyResultToActiveSession(result);
    } catch (err) {
      applyResultToActiveSession({
        type: 'ERROR',
        message: 'Unable to connect to AI engine on port 4500.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleQuickAction(action) {
    if (busy || !activeSession) return;

    updateActiveSession((prev) => ({
      ...prev,
      messages: [...prev.messages, { role: 'user', type: 'TEXT', message: action.label }],
    }));

    setBusy(true);

    try {
      const result = await api.sendQuickAction(activeSession.conversationId, action.actionId);
      applyResultToActiveSession(result);
    } catch (err) {
      applyResultToActiveSession({
        type: 'ERROR',
        message: 'Unable to reach backend action service.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm(confirmationId) {
    if (busy || !activeSession) return;

    setBusy(true);

    try {
      const result = await api.confirmAction(activeSession.conversationId, confirmationId);
      applyResultToActiveSession(result);
    } catch (err) {
      applyResultToActiveSession({
        type: 'ERROR',
        message: 'Action confirmation failed.',
      });
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ── Drag Handlers ──
  function handleDragStart(e) {
    if (e.target.closest('button, input, textarea, a, .md-sessions-drawer')) return;
    if (isMaximized) return;

    draggingRef.current = true;
    const clientX = e.clientX || e.touches?.[0]?.clientX || 0;
    const clientY = e.clientY || e.touches?.[0]?.clientY || 0;

    dragOffsetRef.current = {
      x: clientX - modalPos.x,
      y: clientY - modalPos.y,
    };

    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
    window.addEventListener('touchmove', handleDragMove);
    window.addEventListener('touchend', handleDragEnd);
  }

  function handleDragMove(e) {
    if (!draggingRef.current) return;

    const clientX = e.clientX || e.touches?.[0]?.clientX || 0;
    const clientY = e.clientY || e.touches?.[0]?.clientY || 0;

    const modalWidth = modalRef.current?.offsetWidth || 500;
    const modalHeight = modalRef.current?.offsetHeight || 600;

    const newX = Math.max(12, Math.min(window.innerWidth - modalWidth - 12, clientX - dragOffsetRef.current.x));
    const newY = Math.max(12, Math.min(window.innerHeight - 80, clientY - dragOffsetRef.current.y));

    setModalPos({ x: newX, y: newY });
  }

  function handleDragEnd() {
    draggingRef.current = false;
    window.removeEventListener('mousemove', handleDragMove);
    window.removeEventListener('mouseup', handleDragEnd);
    window.removeEventListener('touchmove', handleDragMove);
    window.removeEventListener('touchend', handleDragEnd);
  }

  const starterPrompts = [
    { label: 'Check leave balance', prompt: 'How many leaves do I have available?' },
    { label: 'Attendance summary', prompt: 'Show my attendance summary for this month' },
    { label: 'Latest payslip breakdown', prompt: 'Can you show me my latest payslip details?' },
    { label: 'Company policies', prompt: 'What is the policy for medical leave and remote work?' },
  ];

  return (
    <>
      {/* ── Material 3 Floating Action Button (when modal is closed) ── */}
      {!isModalOpen && isMinimized && (
        <button
          className="md-fab-bubble"
          onClick={() => setIsMinimized(false)}
          title="Show AI Assistant"
          aria-label="Show AI Assistant"
        >
          <span className="md-fab-bubble-mark" aria-hidden="true" />
        </button>
      )}

      {!isModalOpen && !isMinimized && (
        <div className="md-fab-dock">
          <button
            className="md-fab"
            onClick={() => setIsModalOpen(true)}
            title="Open PeoplePay360 AI Assistant"
            aria-label="Open AI Assistant"
          >
            <span className="md-fab-text">Ask AI</span>
          </button>
          <button
            className="md-fab-close"
            onClick={(event) => {
              event.stopPropagation();
              setIsMinimized(true);
            }}
            title="Minimize"
            aria-label="Minimize AI Assistant button"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Moveable Modal Window ── */}
      {isModalOpen && (
        <div
          ref={modalRef}
          className={`md-modal-window ${isMaximized ? 'maximized' : ''}`}
          style={
            !isMaximized
              ? {
                  transform: `translate3d(${modalPos.x}px, ${modalPos.y}px, 0)`,
                }
              : {}
          }
        >
          {/* Header & Drag Handle */}
          <div
            className="md-modal-header"
            onMouseDown={handleDragStart}
            onTouchStart={handleDragStart}
            title="Click and drag to move window"
          >
            <div className="md-header-left">
              <span className="md-drag-indicator" aria-hidden="true"></span>
              <div className="md-title-stack">
                <span className="md-modal-title">PeoplePay360 Assistant</span>
                <span className="md-model-tag">Gemini 3.7</span>
              </div>
            </div>

            <div className="md-header-right">
              <button
                className={`md-header-pill-btn ${showSessionsDrawer ? 'active' : ''}`}
                onClick={() => setShowSessionsDrawer(!showSessionsDrawer)}
                title="View previous chats"
              >
                History
              </button>

              <button
                className="md-header-pill-btn"
                onClick={handleNewChat}
                title="Start a new chat session"
              >
                + New Chat
              </button>

              <button
                className="md-header-icon-btn"
                onClick={() => setIsMaximized(!isMaximized)}
                title={isMaximized ? 'Restore size' : 'Maximize window'}
                aria-label={isMaximized ? 'Restore' : 'Maximize'}
              >
                {isMaximized ? '🗗' : '🗖'}
              </button>

              <button
                className="md-header-close-btn"
                onClick={() => setIsModalOpen(false)}
                title="Close Assistant"
                aria-label="Close Assistant"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Modal Content Body */}
          <div className="md-modal-body">
            {/* History Drawer */}
            {showSessionsDrawer && (
              <div className="md-sessions-drawer">
                <div className="md-drawer-top">
                  <span className="md-drawer-heading">Conversations ({sessions.length})</span>
                  <button className="md-btn-sm-tonal" onClick={handleNewChat}>
                    + New
                  </button>
                </div>
                <div className="md-drawer-list">
                  {sessions.map((sess) => {
                    const isActive = sess.id === activeSession?.id;
                    return (
                      <div
                        key={sess.id}
                        className={`md-session-row ${isActive ? 'active' : ''}`}
                        onClick={() => {
                          setActiveSessionId(sess.id);
                          setShowSessionsDrawer(false);
                        }}
                      >
                        <span className="md-session-dot"></span>
                        <span className="md-session-title" title={sess.title}>
                          {sess.title}
                        </span>
                        <button
                          className="md-session-delete"
                          onClick={(e) => handleDeleteSession(e, sess.id)}
                          title="Delete conversation"
                          aria-label="Delete"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Chat Viewport */}
            <div className="md-chat-viewport">
              {/* Quick Navigation Links */}
              {quickLinks?.length > 0 && (
                <div className="md-quick-links-strip">
                  <span className="md-quick-strip-label">Portals:</span>
                  <div className="md-quick-pills-row">
                    {quickLinks.map((ql) => (
                      <button
                        key={ql.id}
                        className="md-quick-link-pill"
                        onClick={() => onNavigate(ql.path || `/${ql.id}`)}
                        title={ql.sub}
                      >
                        {ql.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Messages Scroll Area */}
              <div className="md-messages-area">
                {!activeSession || activeSession.messages.length === 0 ? (
                  <div className="md-empty-card">
                    <span className="md-empty-eyebrow">PeoplePay360 HR Intelligence</span>
                    <h3 className="md-empty-title">How can I help you today?</h3>
                    <p className="md-empty-desc">
                      I can help you review your leave balances, calculate payslip details, inspect daily attendance punches, or clarify company workplace policies.
                    </p>

                    {/* Quick Portal Jump Cards */}
                    {quickLinks?.length > 0 && (
                      <div className="md-portal-jump-grid">
                        {quickLinks.slice(0, 4).map((ql) => (
                          <div
                            key={ql.id}
                            className="md-portal-jump-item"
                            onClick={() => onNavigate(ql.path || `/${ql.id}`)}
                          >
                            <div className="md-jump-content">
                              <span className="md-jump-title">{ql.fullTitle || ql.label}</span>
                              <span className="md-jump-sub">{ql.sub}</span>
                            </div>
                            <span className="md-jump-arrow">→</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Starter Prompts */}
                    <div className="md-starter-section">
                      <span className="md-starter-label">Suggested Questions:</span>
                      <div className="md-starter-pills">
                        {starterPrompts.map((p, i) => (
                          <button
                            key={i}
                            className="md-starter-chip"
                            onClick={() => handleSend(p.prompt)}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="md-messages-list">
                    {activeSession.messages.map((m, idx) => (
                      <div
                        key={idx}
                        className={`md-msg-row ${m.role === 'user' ? 'user-row' : 'bot-row'}`}
                      >
                        <div className="md-msg-author-header">
                          <span className="md-author-badge">
                            {m.role === 'user' ? 'You' : 'PeoplePay360 Assistant'}
                          </span>
                        </div>
                        <Message
                          msg={m}
                          onConfirm={handleConfirm}
                          onNavigate={(path) => onNavigate(path)}
                        />
                      </div>
                    ))}

                    {busy && (
                      <div className="md-msg-row bot-row">
                        <div className="md-msg-author-header">
                          <span className="md-author-badge">PeoplePay360 Assistant</span>
                        </div>
                        <div className="md-thinking-pill">
                          <span className="md-pulse-dot"></span>
                          <span className="md-pulse-dot"></span>
                          <span className="md-pulse-dot"></span>
                          <span className="md-thinking-text">Gemini is thinking...</span>
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* Quick Actions Strip */}
              {activeSession?.quickActions && activeSession.quickActions.length > 0 && (
                <div className="md-action-chips-dock">
                  {activeSession.quickActions.map((a) => (
                    <button
                      key={a.key}
                      className="md-chip-btn"
                      onClick={() => handleQuickAction(a)}
                      disabled={busy}
                    >
                      <span className="md-chip-num">{a.key}</span>
                      <span>{a.label}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Material 3 Filled Text Field Input */}
              <div className="md-input-dock">
                <div className="md-filled-input-container">
                  <textarea
                    className="md-filled-input-field"
                    placeholder="Ask a question... (Enter to send)"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    disabled={busy}
                  />
                  <button
                    className="md-input-send-btn"
                    onClick={() => handleSend()}
                    disabled={busy || !inputValue.trim()}
                    title="Send message"
                    aria-label="Send"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="22" y1="2" x2="11" y2="13"></line>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
