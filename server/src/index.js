require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const express = require('express');
const crypto = require('crypto');
const session = require('express-session');
const BetterSqlite3Store = require('better-sqlite3-session-store')(session);
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// CORS — allow Chrome/Edge extension origins only
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && /^chrome-extension:\/\/[a-z]{32}$/.test(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    // Chrome Private Network Access: required for extensions accessing local/LAN servers
    if (req.headers['access-control-request-private-network']) {
      res.header('Access-Control-Allow-Private-Network', 'true');
    }
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Body parsing (limit payload size to prevent DoS; 10mb for backup imports)
app.use(express.json({ limit: '10mb' }));

// Session middleware (SQLite-backed store)
app.use(
  session({
    store: new BetterSqlite3Store({
      client: db,
      expired: {
        clear: true,
        intervalMs: 900000 // 15 min cleanup
      }
    }),
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 1 week
      httpOnly: true,
      sameSite: 'lax'
    }
  })
);

// Static files (Web UI)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/extension', require('./routes/extension'));
app.use('/api/backups', require('./routes/backup'));
app.use('/api', require('./routes/api'));

// Start backup scheduler
const backupService = require('./services/backup');
backupService.startScheduler();

app.listen(PORT, () => {
  console.log(`Tabsy server listening on http://localhost:${PORT}`);
});
