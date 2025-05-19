// routes/rideRequests.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// Edit Ride Request
router.post('/edit-request/:id', async (req, res) => {
  const userId = req.session.userId;
  const requestId = req.params.id;
  const { pickup_location, dropoff_location, note } = req.body;

  if (!userId) return res.redirect('/login');

  try {
    await db.query(
      `UPDATE RideRequests SET pickup_location = ?, dropoff_location = ?, note = ? WHERE id = ? AND user_id = ?`,
      [pickup_location, dropoff_location || null, note || null, requestId, userId]
    );
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Edit Ride Request Error:', err);
    res.status(500).send('Could not update the request.');
  }
});

// Cancel Ride Request
router.post('/cancel-request/:id', async (req, res) => {
  const userId = req.session.userId;
  const requestId = req.params.id;

  if (!userId) return res.redirect('/login');

  try {
    await db.query(`DELETE FROM RideRequests WHERE id = ? AND user_id = ?`, [requestId, userId]);
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Cancel Ride Request Error:', err);
    res.status(500).send('Could not cancel the request.');
  }
});

// Assign Yourself to a Ride Request
router.post('/assign-request/:id', async (req, res) => {
  const userId = req.session.userId;
  const requestId = req.params.id;

  if (!userId) return res.redirect('/login');

  try {
    await db.query(`UPDATE RideRequests SET assigned_user_id = ? WHERE id = ?`, [userId, requestId]);
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Assign Ride Error:', err);
    res.status(500).send('Could not assign yourself to this ride.');
  }
});

module.exports = router;
