// routes/organizations.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /organizations/add — form
router.get('/add', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  res.render('add-organizations', { session: req.session });
});

// GET /organizations/autocomplete
router.get('/autocomplete', async (req, res) => {
  const { term = '', type } = req.query;
  let query = `SELECT id, name, address, lat, lng, type FROM Organizations WHERE name LIKE ?`;
  const params = [`%${term}%`];

  if (type) {
    query += ` AND type = ?`;
    params.push(type);
  } else {
    query += ` AND type IN ('school', 'club', 'event')`;
  }

  query += ` ORDER BY name LIMIT 10`;

  try {
    const [orgs] = await db.query(query, params);
    const results = orgs.map(org => ({
      label: `${org.name} (${org.type})`,
      value: org.name,
      address: org.address,
      lat: org.lat,
      lng: org.lng,
      type: org.type
    }));
    res.json(results);
  } catch (err) {
    console.error('❌ Autocomplete Error:', err.message);
    res.status(500).json({ error: 'Autocomplete failed' });
  }
});

// POST /organizations/add — create
router.post('/add', async (req, res) => {
  const { name, type, address, lat, lng } = req.body;
  const userId = req.session.userId;

  // Validate core fields
  if (!name || !type || !address || !userId) {
    return res.status(400).send('Missing required fields.');
  }

  // Parse lat/lng safely
  const safeLat = lat && !isNaN(parseFloat(lat)) ? parseFloat(lat) : null;
  const safeLng = lng && !isNaN(parseFloat(lng)) ? parseFloat(lng) : null;

  try {
    await db.query(
      'INSERT INTO Organizations (name, type, address, lat, lng, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [name.trim(), type.trim(), address.trim(), safeLat, safeLng, userId]
    );

    // Set session flash message BEFORE redirect
    req.session.success = '✅ Organization added!';
    res.redirect('/dashboard');
  } catch (err) {
    console.error('❌ Add Organization Error:', err.message, '\n', err.stack);
    res.status(500).send('Could not add organization.');
  }
});

module.exports = router;
