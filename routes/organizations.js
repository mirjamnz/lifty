// routes/organizations.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // Assuming raw SQL or Sequelize instance

// GET /organizations/autocomplete?term=pool&type=club
router.get('/autocomplete', async (req, res) => {
  const { term = '', type } = req.query;
  try {
    const [orgs] = await db.query(
      `SELECT id, name, address, lat, lng FROM Organizations 
       WHERE name LIKE ? ${type ? 'AND type = ?' : ''} 
       LIMIT 10`,
      type ? [`%${term}%`, type] : [`%${term}%`]
    );
    res.json(orgs.map(org => ({
      label: org.name,
      value: org.name,
      address: org.address,
      lat: org.lat,
      lng: org.lng
    })));
  } catch (err) {
    console.error('Autocomplete error:', err);
    res.status(500).json({ error: 'Autocomplete failed' });
  }
});

// POST /organizations/add
router.post('/add', async (req, res) => {
  const { name, type, address, lat, lng } = req.body;
  const userId = req.session.userId;
  if (!name || !type || !address) return res.status(400).send('Missing fields.');

  try {
    await db.query(
      'INSERT INTO Organizations (name, type, address, lat, lng, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [name, type, address, lat || null, lng || null, userId]
    );
    res.redirect('/add-child');
  } catch (err) {
    console.error('Add Organization Error:', err);
    res.status(500).send('Could not add organization.');
  }
});


// Schools & Clubs
router.post('/add-organization', async (req, res) => {
  const { name, type, address, lat, lng } = req.body;
  const userId = req.session.userId;
  if (!name || !type || !address) return res.status(400).send('Missing fields.');

  try {
    await db.query(
      'INSERT INTO Organizations (name, type, address, lat, lng, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [name, type, address, lat, lng, userId]
    );
    res.redirect('/add-child');
  } catch (err) {
    console.error('Add Organization Error:', err);
    res.status(500).send('Could not add organization.');
  }
});

module.exports = router;
