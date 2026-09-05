const express = require('express');
const config = require('../../config/config');
const { attachContext } = require('../middleware/auth');
const chatService = require('../services/chat.service');

const router = express.Router();

// Unauthenticated — lets the host frontend decide whether to render the
// chatbot entry point at all (spec §15).
router.get('/status', (req, res) => {
  res.json({ aiEnabled: config.aiEnabled, provider: config.aiProvider });
});

router.get('/quick-actions', attachContext, (req, res) => {
  const menu = chatService.getQuickActionMenu(req.query.menu);
  res.json({ success: true, type: 'QUICK_ACTIONS', quickActions: menu });
});

router.post('/message', attachContext, async (req, res, next) => {
  try {
    const { conversationId, text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ success: false, type: 'ERROR', message: 'A "text" field is required.' });
    }
    const result = await chatService.handleMessage({ conversationId, text, ctx: req.ctx });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/quick-action', attachContext, async (req, res, next) => {
  try {
    const { conversationId, actionId, entities } = req.body;
    if (!actionId || typeof actionId !== 'string') {
      return res.status(400).json({ success: false, type: 'ERROR', message: 'An "actionId" field is required.' });
    }
    const result = await chatService.handleQuickAction({ conversationId, actionId, entities, ctx: req.ctx });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/confirm', attachContext, async (req, res, next) => {
  try {
    const { conversationId, confirmationId } = req.body;
    if (!conversationId || !confirmationId) {
      return res.status(400).json({ success: false, type: 'ERROR', message: 'conversationId and confirmationId are required.' });
    }
    const result = await chatService.handleConfirm({ conversationId, confirmationId, ctx: req.ctx });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
