const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

/** Ensure SQLite datetime strings are proper ISO 8601 with UTC indicator */
function utc(dt) {
  if (!dt) return dt;
  if (/[Z+\-]\d{0,4}$/.test(dt)) return dt;
  return dt.replace(' ', 'T') + 'Z';
}

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // 10 attempts per window
  message: { error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

// Prepared statements — users
const findUser = db.prepare('SELECT * FROM users WHERE username = ?');
const findUserById = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?');
const insertUser = db.prepare(
  'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
);
const countUsers = db.prepare('SELECT COUNT(*) AS cnt FROM users');

// GET /api/auth/setup-status
router.get('/setup-status', (req, res) => {
  const { cnt } = countUsers.get();
  res.json({ needsSetup: cnt === 0 });
});

// Prepared statements — tokens
const listTokens = db.prepare(
  'SELECT id, name, created_at, last_used_at FROM sync_tokens WHERE user_id = ? ORDER BY created_at DESC'
);
const insertToken = db.prepare(
  'INSERT INTO sync_tokens (user_id, token, name) VALUES (?, ?, ?)'
);
const findTokenById = db.prepare(
  'SELECT id, user_id FROM sync_tokens WHERE id = ?'
);
const deleteToken = db.prepare('DELETE FROM sync_tokens WHERE id = ?');

// POST /api/auth/register
// Only allowed during initial setup (no users exist yet)
router.post('/register', authLimiter, async (req, res) => {
  const { cnt } = countUsers.get();
  if (cnt > 0) {
    return res.status(403).json({ error: 'Registration is disabled. An admin account already exists.' });
  }

  const { username, password } = req.body;

  if (!username || typeof username !== 'string' || username.trim().length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const trimmed = username.trim();

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = insertUser.run(trimmed, hash, 'admin');
    const user = findUserById.get(result.lastInsertRowid);
    res.status(201).json({
      id: user.id,
      username: user.username,
      role: user.role,
      createdAt: utc(user.created_at)
    });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = findUser.get(username.trim());
  // Always run bcrypt.compare to prevent timing-based user enumeration.
  // When user doesn't exist, compare against a dummy hash so response time is constant.
  const dummyHash = '$2b$10$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
  const match = await bcrypt.compare(password, user ? user.password_hash : dummyHash);
  if (!user || !match) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  req.session.userId = user.id;
  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: utc(user.created_at)
  });
});

// POST /api/auth/logout
router.post('/logout', requireAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ message: 'Logged out' });
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = findUserById.get(req.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: utc(user.created_at)
  });
});

// GET /api/auth/tokens
router.get('/tokens', requireAuth, (req, res) => {
  const tokens = listTokens.all(req.userId);
  res.json({
    tokens: tokens.map(t => ({
      id: t.id,
      name: t.name,
      createdAt: utc(t.created_at),
      lastUsedAt: utc(t.last_used_at)
    }))
  });
});

// POST /api/auth/tokens
router.post('/tokens', requireAuth, (req, res) => {
  const { name } = req.body;
  const tokenName = (name && typeof name === 'string') ? name.trim() : '';
  const token = 'tb_' + crypto.randomBytes(16).toString('hex');

  const result = insertToken.run(req.userId, token, tokenName);
  res.status(201).json({
    id: result.lastInsertRowid,
    token,
    name: tokenName,
    createdAt: new Date().toISOString()
  });
});

// DELETE /api/auth/tokens/:id
router.delete('/tokens/:id', requireAuth, (req, res) => {
  const row = findTokenById.get(req.params.id);
  if (!row) {
    return res.status(404).json({ error: 'Token not found' });
  }
  if (row.user_id !== req.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  deleteToken.run(req.params.id);
  res.json({ message: 'Token revoked' });
});

// === Admin: User Management ===
const listUsers = db.prepare(
  'SELECT id, username, role, created_at FROM users ORDER BY created_at ASC'
);
const deleteUser = db.prepare('DELETE FROM users WHERE id = ?');
const updateUserPassword = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');

// GET /api/auth/users — list all users (admin only)
router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const users = listUsers.all();
  res.json({
    users: users.map(u => ({
      id: u.id,
      username: u.username,
      role: u.role,
      createdAt: utc(u.created_at)
    }))
  });
});

// POST /api/auth/users — create a new user (admin only)
router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, role } = req.body;

  if (!username || typeof username !== 'string' || username.trim().length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const userRole = (role === 'admin') ? 'admin' : 'user';
  const trimmed = username.trim();

  if (findUser.get(trimmed)) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = insertUser.run(trimmed, hash, userRole);
    const user = findUserById.get(result.lastInsertRowid);
    res.status(201).json({
      id: user.id,
      username: user.username,
      role: user.role,
      createdAt: utc(user.created_at)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// DELETE /api/auth/users/:id — delete a user (admin only, cannot delete self)
router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.userId) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  const user = findUserById.get(targetId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  deleteUser.run(targetId);
  res.json({ message: 'User deleted' });
});

// PUT /api/auth/users/:id/password — reset user password (admin only)
router.put('/users/:id/password', requireAuth, requireAdmin, async (req, res) => {
  const targetId = Number(req.params.id);
  const { password } = req.body;

  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const user = findUserById.get(targetId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    updateUserPassword.run(hash, targetId);
    res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update password' });
  }
});

module.exports = router;
