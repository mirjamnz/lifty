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

    res.render('dashboard', {
      session: req.session,
      user,
      children,
      neighbors
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

module.exports = router;
