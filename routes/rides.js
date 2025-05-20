// routes/rides.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /rides
router.get('/', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.redirect('/login');

  try {
    // Load the user's children
    const [children] = await db.query('SELECT * FROM Children WHERE user_id = ?', [userId]);

    // Load all ride offers including driver name
    const [rideOffers] = await db.query(`
      SELECT RideOffers.*, Users.name AS driver_name
      FROM RideOffers
      JOIN Users ON RideOffers.user_id = Users.id
      ORDER BY pickup_time ASC
    `);

    // Load ride requests by the user
    const [requests] = await db.query(`
      SELECT RideRequests.*, Users.name AS user_name, Children.name AS child_name
      FROM RideRequests
      JOIN Users ON RideRequests.user_id = Users.id
      JOIN Children ON RideRequests.child_id = Children.id
      WHERE RideRequests.user_id = ?
      ORDER BY RideRequests.created_at DESC
    `, [userId]);

    res.render('rides', {
      session: req.session,
      children,
      rideOffers,
      requests
    });
  } catch (err) {
    console.error('GET /rides error:', err);
    res.status(500).send('Failed to load rides page.');
  }
});

module.exports = router;
