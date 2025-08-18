const express = require('express');
const router = express.Router();
const db = require('../db'); // Added missing import for db

// Simple informational pages
router.get('/about', (req, res) => {
  res.render('about', { session: req.session });
});

router.get('/help', async (req, res) => {
  try {
    const [[page]] = await db.query('SELECT content FROM StaticPages WHERE slug = "help"');
    const html = page ? page.content : '<h2>Help Center</h2><p>No content yet.</p>';
    res.render('info/static-page', { html, canEdit: req.session?.is_admin, editUrl: '/admin/pages/help/edit', session: req.session });
  } catch (err) {
    console.error('Help page error:', err);
    res.status(500).send('Failed to load help page');
  }
});

router.get('/privacy', (req, res) => {
  res.render('privacy', { session: req.session });
});

router.get('/apps', (req, res) => {
  res.render('apps', { session: req.session });
});

module.exports = router;
