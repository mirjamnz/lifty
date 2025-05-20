// routes/dashboard.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /dashboard
router.get('/dashboard', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.redirect('/login');

  try {
    const [children] = await db.query('SELECT * FROM Children WHERE user_id = ?', [userId]);
    const [rides] = await db.query(`
      SELECT Rides.*, Users.name AS driver_name
      FROM Rides JOIN Users ON Rides.user_id = Users.id
    `);
    const [rideOffers] = await db.query(`
      SELECT RideOffers.*, Users.name AS driver_name
      FROM RideOffers JOIN Users ON RideOffers.user_id = Users.id
      ORDER BY pickup_time ASC
    `);
    const [offers] = await db.query(`SELECT * FROM RideOffers WHERE user_id = ?`, [userId]);
    const [requests] = await db.query(`
      SELECT RideRequests.*, Users.name AS user_name, Children.name AS child_name
      FROM RideRequests
      JOIN Users ON RideRequests.user_id = Users.id
      JOIN Children ON RideRequests.child_id = Children.id
      ORDER BY RideRequests.created_at DESC
    `);

    res.render('dashboard', {
      session: req.session,
      children,
      rides,
      rideOffers,
      offers,
      requests
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Error loading dashboard.');
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
