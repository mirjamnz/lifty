// routes/dashboard.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /dashboard
router.get('/dashboard', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.redirect('/login');

  try {
    const [[user]] = await db.query('SELECT * FROM Users WHERE id = ?', [userId]);
    const [children] = await db.query('SELECT * FROM Children WHERE user_id = ?', [userId]);
    const [neighbors] = await db.query(`
      SELECT id, name, home_lat, home_lng
      FROM Users
      WHERE home_lat IS NOT NULL AND id != ?
    `, [userId]);
    const [organizations] = await db.query(`
      SELECT id, name, type
      FROM Organizations
      ORDER BY name ASC
      LIMIT 50
    `);

    res.render('dashboard', {
      session: req.session,
      user,
      children,
      neighbors,
      organizations
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Error loading dashboard.');
  }
});


// Set Home address
router.post('/update-address', async (req, res) => {
  const userId = req.session.userId;
  const { home_address, home_lat, home_lng } = req.body;

  // Guard clause: check that all fields are filled
  if (!home_address || !home_lat || !home_lng) {
    return res.status(400).send('Missing address details');
  }

  try {
    await db.query(`
      UPDATE Users 
      SET home_address = ?, home_lat = ?, home_lng = ? 
      WHERE id = ?
    `, [home_address, parseFloat(home_lat), parseFloat(home_lng), userId]);

    res.redirect('/dashboard');
  } catch (err) {
    console.error('Update address error:', err);
    res.status(500).send('Failed to update address.');
  }
});




// POST /add-child
router.post('/add-child', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.redirect('/login');

  const { name, school, club } = req.body;
  if (!name || !school) {
    return res.status(400).send('Child name and school are required.');
  }

  try {
    await db.query(
      'INSERT INTO Children (user_id, name, school, club) VALUES (?, ?, ?, ?)',
      [userId, name, school, club || null]
    );
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Add child error:', err);
    res.status(500).send('Failed to add child.');
  }
});

// POST /edit-child/:id
router.post('/edit-child/:id', async (req, res) => {
  const userId = req.session.userId;
  const childId = req.params.id;
  const { name, school, club } = req.body;

  if (!userId) return res.redirect('/login');

  try {
    await db.query(
      'UPDATE Children SET name = ?, school = ?, club = ? WHERE id = ? AND user_id = ?',
      [name, school, club || null, childId, userId]
    );
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Edit child error:', err);
    res.status(500).send('Failed to update child.');
  }
});

// GET /delete-child/:id
router.get('/delete-child/:id', async (req, res) => {
  const userId = req.session.userId;
  const childId = req.params.id;

  if (!userId) return res.redirect('/login');

  try {
    await db.query(
      'DELETE FROM Children WHERE id = ? AND user_id = ?',
      [childId, userId]
    );
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Delete child error:', err);
    res.status(500).send('Failed to delete child.');
  }
});

// POST /organizations/add — create
router.post('/add', async (req, res) => {
  const { name, type, address, lat, lng } = req.body;
  const userId = req.session.userId;

  if (!name || !type || !address || !userId) {
    return res.status(400).send('Missing required fields.');
  }

  const safeLat = lat && !isNaN(parseFloat(lat)) ? parseFloat(lat) : null;
  const safeLng = lng && !isNaN(parseFloat(lng)) ? parseFloat(lng) : null;

  try {
    await db.query(
      'INSERT INTO Organizations (name, type, address, lat, lng, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [name.trim(), type.trim(), address.trim(), safeLat, safeLng, userId]
    );

    req.session.success = '✅ Organization added!';
    return res.redirect('/dashboard');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      req.session.error = `❌ '${name}' already exists.`;
      return res.redirect('/organizations/add');
    }

    console.error('❌ Add Organization Error:', err.message, '\n', err.stack);
    res.status(500).send('Could not add organization.');
  }
});


module.exports = router;
