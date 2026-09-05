const { SYSTEM_PROMPT } = require('./system.prompt');

function formatHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return [];
  return history.map((h) => ({
    role: h.role === 'assistant' ? 'assistant' : 'user',
    content: h.content,
  }));
}

/**
 * For a resolved, backend-verified action: the LLM phrases verified numbers
 * with conversational context from recent turns.
 */
function buildVerifiedExplanationPrompt(userText, actionLabel, verifiedData, history = []) {
  const historyTurns = formatHistory(history.slice(-4));
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...historyTurns,
    {
      role: 'user',
      content:
        `User question: "${userText}"\n` +
        `Resolved via verified backend action: "${actionLabel}".\n` +
        `Verified data (the ONLY facts you may state): ${JSON.stringify(verifiedData)}\n` +
        'Write a clear, helpful, natural-language answer using these facts. Keep it concise.',
    },
  ];
}

/**
 * For GENERAL_HR / UNKNOWN: general reasoning grounded in knowledge-base
 * snippet and conversational memory.
 */
function buildGeneralAnswerPrompt(userText, knowledgeSnippet, history = []) {
  const historyTurns = formatHistory(history.slice(-4));
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...historyTurns,
    {
      role: 'user',
      content: knowledgeSnippet
        ? `Reference knowledge base: ${JSON.stringify(knowledgeSnippet)}\nUser question: "${userText}"\nAnswer using the reference material where relevant. If the question asks for account lookup, clarify that this is general guidance.`
        : `User question: "${userText}"\nThis is general HR guidance, not a lookup of the user's actual account — answer accordingly in a friendly and professional manner.`,
    },
  ];
}

module.exports = { buildVerifiedExplanationPrompt, buildGeneralAnswerPrompt };
