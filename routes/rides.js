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
  SELECT rr.*, u.name AS user_name, c.name AS child_name, ad.name AS assigned_driver_name
  FROM RideRequests rr
  JOIN Users u ON rr.user_id = u.id
  JOIN Children c ON rr.child_id = c.id
  LEFT JOIN Users ad ON rr.assigned_user_id = ad.id
  ORDER BY rr.created_at DESC
`);


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

  // Cancel ride requests by the user
router.post('/cancel-offer/:id', async (req, res) => {
  const userId = req.session.userId;
  const offerId = req.params.id;

  if (!userId) return res.redirect('/login');

  try {
    await db.query('DELETE FROM RideOffers WHERE id = ? AND user_id = ?', [offerId, userId]);
    res.redirect('/rides');
  } catch (err) {
    console.error('Cancel Ride Offer Error:', err);
    res.status(500).send('Could not cancel the offer.');
  }
});

module.exports = router;
