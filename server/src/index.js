require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const express = require('express');
const session = require('express-session');
const BetterSqlite3Store = require('better-sqlite3-session-store')(session);
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS — allow extension and any origin for API routes
app.use('/api', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  // Chrome Private Network Access: required for extensions accessing local/LAN servers
  if (req.headers['access-control-request-private-network']) {
    res.header('Access-Control-Allow-Private-Network', 'true');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Body parsing
app.use(express.json());

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
    secret: process.env.SESSION_SECRET || 'tabsy-dev-secret',
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
app.use('/api', require('./routes/api'));

app.listen(PORT, () => {
  console.log(`Tabsy server listening on http://localhost:${PORT}`);
});
