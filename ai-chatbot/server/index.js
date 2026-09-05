const express = require('express');
const cors = require('cors');

const path = require('path');
const config = require('../config/config');
const chatRoutes = require('./routes/chat.routes');
const { errorHandler } = require('./middleware/error');

const app = express();

const allowedOrigins = [
  config.allowedOrigin,
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      return callback(null, true);
    }
    callback(null, true);
  },
  credentials: true,
}));
app.use(express.json({ limit: '256kb' }));

// Static files for client
const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));

app.get('/health', (req, res) => res.json({ ok: true, aiEnabled: config.aiEnabled }));
app.use('/api/chat', chatRoutes);

// Fallback to client index.html for non-API routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/health') return next();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`[ai-chatbot] listening on port ${config.port} (AI_ENABLED=${config.aiEnabled}, provider=${config.aiProvider})`);
});
