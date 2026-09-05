import React, { useState, useEffect, useRef } from 'react';
import { createChatApi } from './api';
import Message from './Message';

const STORAGE_KEY = 'peopay360_ai_sessions_v3';
const API_BASE_URL = 'http://localhost:4500';

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

export default function App() {
  // ── Active Page / Portal Context ──
  const [activeTab, setActiveTab] = useState('overview');

  // ── Moveable Modal State ──
  const [isModalOpen, setIsModalOpen] = useState(true);
  const [isMaximized, setIsMaximized] = useState(false);
  const [showSessionsDrawer, setShowSessionsDrawer] = useState(false);

  // Modal position (x, y)
  const [modalPos, setModalPos] = useState({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const modalRef = useRef(null);

  // Position modal initially on right side of viewport on mount
  useEffect(() => {
    const defaultX = Math.max(16, window.innerWidth - 560);
    const defaultY = Math.max(24, Math.min(80, window.innerHeight - 700));
    setModalPos({ x: defaultX, y: defaultY });
  }, []);

  // ── User Context ──
  const user = {
    id: 'emp_001',
    name: 'Alex Morgan',
    role: 'Lead Fullstack Engineer',
    department: 'Engineering & Innovation',
    token: 'Bearer peopay360-jwt-token-demo-session-2026',
  };

  // ── Chat API Instance ──
  const [api] = useState(() =>
    createChatApi({
      baseUrl: API_BASE_URL,
      getAuthContext: () => ({
        token: user.token,
        employeeId: user.id,
      }),
    })
  );

  const [aiStatus, setAiStatus] = useState({ ready: false, aiEnabled: false, provider: 'gemini' });

  // ── Sessions & Chat State ──
  const [sessions, setSessions] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.error('Failed to load sessions:', e);
    }
    return [createNewSession()];
  });

  const [activeSessionId, setActiveSessionId] = useState(() => sessions[0]?.id || null);
  const [inputValue, setInputValue] = useState('');
  const [busy, setBusy] = useState(false);
  const messagesEndRef = useRef(null);

  // Persist sessions
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch (e) {
      console.error('Failed to persist sessions:', e);
    }
  }, [sessions]);

  // Check backend status
  useEffect(() => {
    api
      .status()
      .then((res) => {
        setAiStatus({
          ready: true,
          aiEnabled: !!res.aiEnabled,
          provider: res.provider || 'gemini',
        });
      })
      .catch(() => {
        setAiStatus({ ready: false, aiEnabled: false, provider: 'offline' });
      });
  }, [api]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];

  // Auto load ROOT quick actions
  useEffect(() => {
    if (activeSession && (!activeSession.quickActions || activeSession.quickActions.length === 0)) {
      api
        .quickActions('ROOT')
        .then((res) => {
          if (res?.quickActions?.length) {
            updateActiveSession((prev) => ({
              ...prev,
              quickActions: res.quickActions,
            }));
          }
        })
        .catch(() => {});
    }
  }, [activeSession?.id, api]);

  // Scroll to bottom
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

    const isFirstMsg = activeSession.messages.length === 0;
    const newTitle = isFirstMsg ? action.label : activeSession.title;

    updateActiveSession((prev) => ({
      ...prev,
      title: newTitle,
      messages: [...prev.messages, { role: 'user', type: 'TEXT', message: action.label }],
    }));

    setBusy(true);
    try {
      const result = await api.sendQuickAction(activeSession.conversationId, action.actionId, {});
      applyResultToActiveSession(result);
    } catch (err) {
      applyResultToActiveSession({
        type: 'ERROR',
        message: 'Failed to process quick action.',
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
        message: 'Failed to confirm action.',
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

  // ── Drag Handlers for Moveable Modal ──
  function handleDragStart(e) {
    if (isMaximized) return;
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('textarea')) return;

    draggingRef.current = true;
    const clientX = e.clientX || e.touches?.[0]?.clientX || 0;
    const clientY = e.clientY || e.touches?.[0]?.clientY || 0;

    dragOffsetRef.current = {
      x: clientX - modalPos.x,
      y: clientY - modalPos.y,
    };

    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
    window.addEventListener('touchmove', handleDragMove, { passive: false });
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

  function askAi(promptText) {
    setIsModalOpen(true);
    if (promptText) {
      handleSend(promptText);
    }
  }

  // Suggested Prompts (Clean typography, no emojis)
  const starterPrompts = [
    { label: 'Check leave balance', prompt: 'How many leaves do I have available?' },
    { label: 'Attendance summary', prompt: 'Show my attendance summary for this month' },
    { label: 'Latest payslip breakdown', prompt: 'Can you show me my latest payslip details?' },
    { label: 'Company policies', prompt: 'What is the policy for medical leave and remote work?' },
  ];

  // Quick navigation destinations
  const quickLinks = [
    { id: 'leave', label: 'Leave & Time Off', sub: 'Apply vacation & view balance' },
    { id: 'payroll', label: 'Payroll & Payslips', sub: 'Monthly gross, net, & deductions' },
    { id: 'attendance', label: 'Attendance Tracker', sub: 'Daily check-in logs & total hours' },
    { id: 'employees', label: 'Employee Directory', sub: 'Team structure & roles' },
    { id: 'contracts', label: 'Employment Contracts', sub: 'Terms, notices & active status' },
  ];

  return (
    <div className="md-app-root">
      {/* ── Background Organic Atmosphere Blur Shapes (Material You) ── */}
      <div className="md-ambient-bg" aria-hidden="true">
        <div className="md-blur-shape shape-primary"></div>
        <div className="md-blur-shape shape-secondary"></div>
        <div className="md-blur-shape shape-tertiary"></div>
      </div>

      {/* ── Material You Top App Bar ── */}
      <header className="md-top-app-bar">
        <div className="md-app-bar-brand">
          <div className="md-brand-mark">P</div>
          <div className="md-brand-details">
            <span className="md-brand-title">PeoplePay360</span>
            <span className="md-brand-subtitle">HR & Payroll Portal</span>
          </div>
        </div>

        <div className="md-app-bar-nav">
          <button
            className={`md-nav-pill ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button
            className={`md-nav-pill ${activeTab === 'leave' ? 'active' : ''}`}
            onClick={() => setActiveTab('leave')}
          >
            Leave
          </button>
          <button
            className={`md-nav-pill ${activeTab === 'payroll' ? 'active' : ''}`}
            onClick={() => setActiveTab('payroll')}
          >
            Payroll
          </button>
          <button
            className={`md-nav-pill ${activeTab === 'attendance' ? 'active' : ''}`}
            onClick={() => setActiveTab('attendance')}
          >
            Attendance
          </button>
          <button
            className={`md-nav-pill ${activeTab === 'employees' ? 'active' : ''}`}
            onClick={() => setActiveTab('employees')}
          >
            Directory
          </button>
          <button
            className={`md-nav-pill ${activeTab === 'contracts' ? 'active' : ''}`}
            onClick={() => setActiveTab('contracts')}
          >
            Contracts
          </button>
        </div>

        <div className="md-app-bar-actions">
          <span className="md-status-chip">
            <span className="md-chip-dot"></span>
            <span>Gemini 3.7 Online</span>
          </span>

          {!isModalOpen && (
            <button
              className="md-btn md-btn-filled"
              onClick={() => setIsModalOpen(true)}
            >
              Open AI Assistant
            </button>
          )}

          <div className="md-user-chip">
            <span className="md-user-avatar">AM</span>
            <span className="md-user-name">{user.name}</span>
          </div>
        </div>
      </header>

      {/* ── Host Surface Area (Material You) ── */}
      <main className="md-host-canvas">
        {activeTab === 'overview' && (
          <div className="md-overview-container">
            {/* Quick Hero Banner */}
            <div className="md-hero-surface">
              <div className="md-hero-content">
                <span className="md-hero-eyebrow">PeoplePay360 Intelligence</span>
                <h1 className="md-hero-heading">Welcome, {user.name}</h1>
                <p className="md-hero-desc">
                  Your moveable AI assistant is available anywhere on the screen. Use it to check leave balances, analyze payslips, query attendance records, or review company policies with Gemini 3.7.
                </p>
                <div className="md-hero-actions">
                  <button
                    className="md-btn md-btn-filled"
                    onClick={() => setIsModalOpen(true)}
                  >
                    Open Moveable Assistant
                  </button>
                  <button
                    className="md-btn md-btn-tonal"
                    onClick={() => askAi('How many leave days do I have left?')}
                  >
                    Check Leave Balance
                  </button>
                  <button
                    className="md-btn md-btn-outlined"
                    onClick={() => askAi('Explain my latest payslip')}
                  >
                    Review Payslip
                  </button>
                </div>
              </div>
            </div>

            {/* Quick Overview Tonal Cards */}
            <div className="md-card-grid">
              <div className="md-surface-card" onClick={() => askAi('How many leave days do I have available?')}>
                <div className="md-card-header">
                  <span className="md-card-title">Leave Balance</span>
                  <span className="md-card-badge">18 Days Available</span>
                </div>
                <p className="md-card-body">Annual allocation: 24 days. 4 days currently pending review.</p>
                <div className="md-card-action">Ask AI Assistant →</div>
              </div>

              <div className="md-surface-card" onClick={() => askAi('Show my attendance summary for this month')}>
                <div className="md-card-header">
                  <span className="md-card-title">Attendance</span>
                  <span className="md-card-badge">98.4% On Track</span>
                </div>
                <p className="md-card-body">168 hours logged in September. Average punch time: 09:08 AM.</p>
                <div className="md-card-action">Ask AI Assistant →</div>
              </div>

              <div className="md-surface-card" onClick={() => askAi('Can you show me my latest payslip details?')}>
                <div className="md-card-header">
                  <span className="md-card-title">Latest Payroll</span>
                  <span className="md-card-badge">$7,450.00 Net</span>
                </div>
                <p className="md-card-body">August 2026 salary processed. Gross $8,800.00 with standard deductions.</p>
                <div className="md-card-action">Ask AI Assistant →</div>
              </div>

              <div className="md-surface-card" onClick={() => askAi('What are the details of my employment contract?')}>
                <div className="md-card-header">
                  <span className="md-card-title">Contract</span>
                  <span className="md-card-badge">Active Permanent</span>
                </div>
                <p className="md-card-body">Lead Fullstack Engineer • Engineering & Innovation • 60-day notice.</p>
                <div className="md-card-action">Ask AI Assistant →</div>
              </div>
            </div>
          </div>
        )}

        {/* Tab views with clean Material You tonal surfaces */}
        {activeTab === 'leave' && (
          <div className="md-page-surface">
            <div className="md-page-header">
              <div>
                <h2 className="md-page-title">Leave & Time Off</h2>
                <p className="md-page-sub">Review your annual balance, past time-off history, and active requests.</p>
              </div>
              <button className="md-btn md-btn-filled" onClick={() => askAi('I want to apply for leave')}>
                Request Leave with AI
              </button>
            </div>
            <div className="md-table-surface">
              <table className="md-data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Requested Dates</th>
                    <th>Duration</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Annual Vacation</td>
                    <td>Dec 22, 2026 – Dec 26, 2026</td>
                    <td>5 days</td>
                    <td><span className="md-table-tag pending">Pending Approval</span></td>
                  </tr>
                  <tr>
                    <td>Medical Leave</td>
                    <td>Jul 14, 2026</td>
                    <td>1 day</td>
                    <td><span className="md-table-tag approved">Approved</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'payroll' && (
          <div className="md-page-surface">
            <div className="md-page-header">
              <div>
                <h2 className="md-page-title">Payroll & Compensation</h2>
                <p className="md-page-sub">Breakdown of gross earnings, tax withholdings, and net disbursements.</p>
              </div>
              <button className="md-btn md-btn-tonal" onClick={() => askAi('Explain my latest payslip')}>
                Explain Latest Payslip
              </button>
            </div>
            <div className="md-table-surface">
              <table className="md-data-table">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Gross Salary</th>
                    <th>Deductions</th>
                    <th>Net Disbursed</th>
                    <th>Disbursement Date</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>August 2026</td>
                    <td>$8,800.00</td>
                    <td>$1,350.00</td>
                    <td><strong>$7,450.00</strong></td>
                    <td>Aug 31, 2026</td>
                  </tr>
                  <tr>
                    <td>July 2026</td>
                    <td>$8,800.00</td>
                    <td>$1,350.00</td>
                    <td><strong>$7,450.00</strong></td>
                    <td>Jul 31, 2026</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'attendance' && (
          <div className="md-page-surface">
            <div className="md-page-header">
              <div>
                <h2 className="md-page-title">Attendance & Time Records</h2>
                <p className="md-page-sub">Biometric punches and verified presence for September 2026.</p>
              </div>
              <button className="md-btn md-btn-tonal" onClick={() => askAi('Show my attendance record for this month')}>
                Attendance Summary
              </button>
            </div>
            <div className="md-table-surface">
              <table className="md-data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Check In</th>
                    <th>Check Out</th>
                    <th>Duration</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Sep 05, 2026</td>
                    <td>09:05 AM</td>
                    <td>06:15 PM</td>
                    <td>9h 10m</td>
                    <td><span className="md-table-tag approved">Present</span></td>
                  </tr>
                  <tr>
                    <td>Sep 04, 2026</td>
                    <td>09:12 AM</td>
                    <td>06:00 PM</td>
                    <td>8h 48m</td>
                    <td><span className="md-table-tag approved">Present</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'employees' && (
          <div className="md-page-surface">
            <div className="md-page-header">
              <div>
                <h2 className="md-page-title">Employee Directory</h2>
                <p className="md-page-sub">PeoplePay360 team roster and department contacts.</p>
              </div>
            </div>
            <div className="md-table-surface">
              <table className="md-data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Title</th>
                    <th>Department</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Alex Morgan</strong></td>
                    <td>Lead Fullstack Engineer</td>
                    <td>Engineering</td>
                    <td><span className="md-table-tag approved">Active</span></td>
                  </tr>
                  <tr>
                    <td><strong>Sarah Jenkins</strong></td>
                    <td>Product Manager</td>
                    <td>Product</td>
                    <td><span className="md-table-tag approved">Active</span></td>
                  </tr>
                  <tr>
                    <td><strong>David Kumar</strong></td>
                    <td>Payroll Specialist</td>
                    <td>Finance & HR</td>
                    <td><span className="md-table-tag approved">Active</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'contracts' && (
          <div className="md-page-surface">
            <div className="md-page-header">
              <div>
                <h2 className="md-page-title">Employment Contract</h2>
                <p className="md-page-sub">Current terms of employment and formal agreements.</p>
              </div>
            </div>
            <div className="md-card-embed" style={{ padding: '24px' }}>
              <dl className="md-card-dl">
                <div className="md-card-row">
                  <dt>Employee</dt>
                  <dd>Alex Morgan (emp_001)</dd>
                </div>
                <div className="md-card-row">
                  <dt>Contract Type</dt>
                  <dd>Permanent Full-Time</dd>
                </div>
                <div className="md-card-row">
                  <dt>Department</dt>
                  <dd>Engineering & Innovation</dd>
                </div>
                <div className="md-card-row">
                  <dt>Notice Period</dt>
                  <dd>60 Days</dd>
                </div>
                <div className="md-card-row">
                  <dt>Work Arrangement</dt>
                  <dd>Hybrid (Flexible)</dd>
                </div>
              </dl>
            </div>
          </div>
        )}
      </main>

      {/* ── Material You Floating Action Button (FAB) (when modal is closed) ── */}
      {!isModalOpen && (
        <button
          className="md-fab"
          onClick={() => setIsModalOpen(true)}
          title="Open PeoplePay360 AI Assistant"
          aria-label="Open AI Assistant"
        >
          <span className="md-fab-text">Ask AI</span>
        </button>
      )}

      {/* ═══════════════════════════════════════════════════════════════
         ── MOVEABLE / DRAGGABLE AI CHATBOT MODAL (MATERIAL YOU) ──
         ═══════════════════════════════════════════════════════════════ */}
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
          {/* ── Modal Drag Handle Header ── */}
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
              {/* Toggle History Drawer */}
              <button
                className={`md-header-pill-btn ${showSessionsDrawer ? 'active' : ''}`}
                onClick={() => setShowSessionsDrawer(!showSessionsDrawer)}
                title="View previous chats"
              >
                History
              </button>

              {/* Start New Chat Session */}
              <button
                className="md-header-pill-btn"
                onClick={handleNewChat}
                title="Start a new chat session"
              >
                + New Chat
              </button>

              {/* Maximize / Restore */}
              <button
                className="md-header-icon-btn"
                onClick={() => setIsMaximized(!isMaximized)}
                title={isMaximized ? 'Restore size' : 'Maximize window'}
                aria-label={isMaximized ? 'Restore' : 'Maximize'}
              >
                {isMaximized ? '🗗' : '🗖'}
              </button>

              {/* ── Close Cross Button (✕) ── */}
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

          {/* ── Modal Content Body ── */}
          <div className="md-modal-body">
            {/* Collapsible Sessions Drawer */}
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

            {/* Main Interactive Chat Flow */}
            <div className="md-chat-viewport">
              {/* Direct Quick Links Bar */}
              <div className="md-quick-links-strip">
                <span className="md-quick-strip-label">Direct Portals:</span>
                <div className="md-quick-pills-row">
                  {quickLinks.map((ql) => (
                    <button
                      key={ql.id}
                      className={`md-quick-link-pill ${activeTab === ql.id ? 'active' : ''}`}
                      onClick={() => setActiveTab(ql.id)}
                      title={ql.sub}
                    >
                      {ql.label}
                    </button>
                  ))}
                </div>
              </div>

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
                    <div className="md-portal-jump-grid">
                      {quickLinks.slice(0, 4).map((ql) => (
                        <div
                          key={ql.id}
                          className="md-portal-jump-item"
                          onClick={() => setActiveTab(ql.id)}
                        >
                          <div className="md-jump-content">
                            <span className="md-jump-title">{ql.label}</span>
                            <span className="md-jump-sub">{ql.sub}</span>
                          </div>
                          <span className="md-jump-arrow">→</span>
                        </div>
                      ))}
                    </div>

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
                          onNavigate={(path) => {
                            const tab = path.replace('/', '').toLowerCase();
                            setActiveTab(tab || 'overview');
                          }}
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

              {/* Input Dock (Material 3 Filled Text Field) */}
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
    </div>
  );
}
