// routes/dashboard.js
const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
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

module.exports = router;
