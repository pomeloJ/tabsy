const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const EXTENSION_DIR = path.resolve(__dirname, '..', '..', '..', 'extension');
const CHANGELOG_PATH = path.resolve(__dirname, '..', '..', '..', 'CHANGELOG.json');

// GET /api/extension/version — returns current version + changelog
router.get('/version', (req, res) => {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
    let changelog = [];
    if (fs.existsSync(CHANGELOG_PATH)) {
      changelog = JSON.parse(fs.readFileSync(CHANGELOG_PATH, 'utf8'));
    }
    res.json({
      version: manifest.version,
      name: manifest.name,
      changelog
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read extension info' });
  }
});

// GET /api/extension/download — streams extension as zip
router.get('/download', (req, res) => {
  if (!fs.existsSync(EXTENSION_DIR)) {
    return res.status(404).json({ error: 'Extension directory not found' });
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
    const version = manifest.version || '0.0.0';
    const filename = `tabsy-extension-v${version}.zip`;

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`
    });

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      res.status(500).end();
    });

    archive.pipe(res);
    archive.directory(EXTENSION_DIR, 'tabsy-extension');
    archive.finalize();
  } catch (err) {
    res.status(500).json({ error: 'Failed to create zip' });
  }
});

module.exports = router;
