const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();

// Prepared statements — users
const findUser = db.prepare('SELECT * FROM users WHERE username = ?');
const findUserById = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?');
const insertUser = db.prepare(
  'INSERT INTO users (username, password_hash) VALUES (?, ?)'
);

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
router.post('/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || typeof username !== 'string' || username.trim().length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const trimmed = username.trim();

  // Check duplicate
  if (findUser.get(trimmed)) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = insertUser.run(trimmed, hash);
    const user = findUserById.get(result.lastInsertRowid);
    res.status(201).json({
      id: user.id,
      username: user.username,
      createdAt: user.created_at
    });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = findUser.get(username.trim());
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  req.session.userId = user.id;
  res.json({
    id: user.id,
    username: user.username,
    createdAt: user.created_at
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
    createdAt: user.created_at
  });
});

// GET /api/auth/tokens
router.get('/tokens', requireAuth, (req, res) => {
  const tokens = listTokens.all(req.userId);
  res.json({
    tokens: tokens.map(t => ({
      id: t.id,
      name: t.name,
      createdAt: t.created_at,
      lastUsedAt: t.last_used_at
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

module.exports = router;
