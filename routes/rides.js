// routes/rides.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /rides > Load ride requests by the user
router.get('/', async (req, res) => {
  const userId = req.session.userId;
  const { filter = 'all' } = req.query;

  if (!userId) return res.redirect('/login');

  try {
    const [children] = await db.query('SELECT * FROM Children WHERE user_id = ?', [userId]);

    const [rideOffers] = await db.query(`
      SELECT ro.*, u.name AS driver_name
      FROM RideOffers ro
      JOIN Users u ON ro.user_id = u.id
      ORDER BY pickup_time ASC
    `);

    let query = `
      SELECT rr.*, u.name AS user_name, c.name AS child_name, ad.name AS assigned_driver_name
      FROM RideRequests rr
      JOIN Users u ON rr.user_id = u.id
      JOIN Children c ON rr.child_id = c.id
      LEFT JOIN Users ad ON rr.assigned_user_id = ad.id
    `;
    const params = [];

    if (filter === 'my') {
      query += ' WHERE rr.user_id = ?';
      params.push(userId);
    } else if (filter === 'others') {
      query += ' WHERE rr.user_id != ?';
      params.push(userId);
    }

    query += ' ORDER BY rr.created_at DESC';
    const [requests] = await db.query(query, params);

    res.render('rides', {
      session: req.session,
      children,
      rideOffers,
      requests,
      filter
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
