// routes/rideRequests.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// POST /request-ride
router.post('/request-ride', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.redirect('/login');

  const { pickup_location, dropoff_location, pickup_time, child_id, note } = req.body;
  if (!pickup_location || !pickup_time || !child_id) {
    return res.status(400).send('Pickup location, time, and child are required.');
  }

  try {
    await db.query(
      `INSERT INTO RideRequests 
        (user_id, pickup_location, dropoff_location, pickup_time, child_id, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, pickup_location, dropoff_location || null, pickup_time, child_id, note || null]
    );
    res.redirect('/dashboard');
  } catch (err) {
    console.error('❌ Error creating ride request:', err);
    res.status(500).send('Failed to create ride request.');
  }
});


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
    await db.query(
      `DELETE FROM RideRequests WHERE id = ? AND user_id = ?`,
      [requestId, userId]
    );
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
