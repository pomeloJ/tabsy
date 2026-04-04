const db = require('../db');

const findTokenStmt = db.prepare(
  'SELECT user_id FROM sync_tokens WHERE token = ?'
);
const updateTokenUsage = db.prepare(
  'UPDATE sync_tokens SET last_used_at = datetime(\'now\') WHERE token = ?'
);
const findUserRole = db.prepare(
  'SELECT role FROM users WHERE id = ?'
);

function requireAuth(req, res, next) {
  // 1. Check Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const row = findTokenStmt.get(token);
    if (row) {
      updateTokenUsage.run(token);
      req.userId = row.user_id;
      req.authMethod = 'token';
      const user = findUserRole.get(row.user_id);
      req.userRole = user ? user.role : 'user';
      return next();
    }
    return res.status(401).json({ error: 'Invalid token' });
  }

  // 2. Check session
  if (req.session && req.session.userId) {
    req.userId = req.session.userId;
    req.authMethod = 'session';
    const user = findUserRole.get(req.session.userId);
    req.userRole = user ? user.role : 'user';
    return next();
  }

  // 3. No auth
  return res.status(401).json({ error: 'Unauthorized' });
}

function requireAdmin(req, res, next) {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = requireAuth;
module.exports.requireAdmin = requireAdmin;
