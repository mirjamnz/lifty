// routes/rides.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /rides > Load ride requests by the user
router.get('/', async (req, res) => {
  const userId = req.session.userId;
  const { filter = 'all', expired = 'true' } = req.query;

  if (!userId) return res.redirect('/login');

  try {
    const [children] = await db.query('SELECT * FROM Children WHERE user_id = ?', [userId]);

    // Ride Offers
    let offerQuery = `
      SELECT ro.*, u.name AS driver_name
      FROM RideOffers ro
      JOIN Users u ON ro.user_id = u.id
    `;
    const offerParams = [];

    if (expired === 'false') {
      offerQuery += ' WHERE ro.pickup_time > NOW()';
    }

    offerQuery += ' ORDER BY pickup_time ASC';
    const [rideOffers] = await db.query(offerQuery, offerParams);

    // Ride Requests
    let requestQuery = `
      SELECT rr.*, u.name AS user_name, c.name AS child_name, ad.name AS assigned_driver_name
      FROM RideRequests rr
      JOIN Users u ON rr.user_id = u.id
      JOIN Children c ON rr.child_id = c.id
      LEFT JOIN Users ad ON rr.assigned_user_id = ad.id
    `;
    const requestParams = [];

    if (filter === 'my') {
      requestQuery += ' WHERE rr.user_id = ?';
      requestParams.push(userId);
    } else if (filter === 'others') {
      requestQuery += ' WHERE rr.user_id != ?';
      requestParams.push(userId);
    }

    if (expired === 'false') {
      requestQuery += requestParams.length ? ' AND' : ' WHERE';
      requestQuery += ' rr.pickup_time > NOW()';
    }

    requestQuery += ' ORDER BY rr.created_at DESC';
    const [requests] = await db.query(requestQuery, requestParams);

    res.render('rides', {
      session: req.session,
      children,
      rideOffers,
      requests,
      filter,
      expired
    });
  } catch (err) {
    console.error('GET /rides error:', err);
    res.status(500).send('Failed to load rides page.');
  }
});



  // Offer ride requests by the user
router.post('/offer-ride', async (req, res) => {
  const { school, available_seats, pickup_time, notes } = req.body;
  const userId = req.session.userId;

  if (!userId) return res.redirect('/login');

  try {
await db.query(
  'INSERT INTO RideOffers (user_id, school, available_seats, pickup_time, notes) VALUES (?, ?, ?, ?, ?)',
  [userId, school, available_seats, pickup_time, notes]
);
    res.redirect('/rides');
  } catch (err) {
    console.error('Error creating ride offer:', err);
    res.status(500).send('Failed to create ride offer.');
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
