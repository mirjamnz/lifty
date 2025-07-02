// routes/childDashboard.js
const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/child-dashboard', async (req, res) => {
  const userId = req.session.userId;

  try {
    // 1. Verify session and role
    const [[user]] = await db.query('SELECT * FROM Users WHERE id = ?', [userId]);
    if (user.role !== 'child') return res.status(403).send('Access denied.');

    // 2. Load child profile
    const [[childProfile]] = await db.query(
      'SELECT * FROM Children WHERE id = ?',
      [user.child_profile_id]
    );

    // 3. Load child's ride requests with driver info
    const [requests] = await db.query(
      `SELECT r.id, r.pickup_location, r.dropoff_location, r.pickup_time, r.assigned_user_id, r.status,
              u.name AS driver_name
       FROM RideRequests r
       LEFT JOIN Users u ON r.assigned_user_id = u.id
       WHERE r.child_id = ? AND r.pickup_time > (NOW() - INTERVAL 2 HOUR) ORDER BY r.pickup_time ASC`,
      [user.child_profile_id]
    );
    // Derive status and format date
    requests.forEach(request => {
      request.status = request.status || (request.assigned_user_id ? 'Assigned' : 'Pending');
      request.formatted_time = new Date(request.pickup_time).toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' });
    });

    // 4. Load child's ride offers
    const [offers] = await db.query(
      `SELECT o.id, o.school, o.pickup_time
       FROM RideOffers o
       WHERE o.child_id = ? ORDER BY o.created_at DESC`,
      [user.child_profile_id]
    );
    // Format date for offers
    offers.forEach(offer => {
      offer.formatted_time = new Date(offer.pickup_time).toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' });
    });

    // 5. Render child dashboard with session
    const [users] = await db.query('SELECT id, name FROM Users');
    res.render('child-dashboard', {
      child: childProfile,
      requests,
      offers,
      users, // For driver lookup
      session: req.session,
      GMAPS_API_KEY: process.env.GMAPS_API_KEY || 'YOUR_API_KEY' // Kept for future use
    });
  } catch (err) {
    console.error('❌ Child dashboard error:', err);
    res.status(500).send('Failed to load dashboard.');
  }
});

// POST route to mark a ride request as completed
router.post('/child-dashboard/complete-request/:id', async (req, res) => {
  const userId = req.session.userId;
  const requestId = req.params.id;
  try {
    // Optionally: check if user is allowed to complete this request
    await db.query('UPDATE RideRequests SET status = ? WHERE id = ?', ['completed', requestId]);
    res.redirect('/child-dashboard');
  } catch (err) {
    console.error('❌ Error marking request as complete:', err);
    res.status(500).send('Failed to mark request as complete.');
  }
});

// POST route to undo completion of a ride request
router.post('/child-dashboard/undo-complete/:id', async (req, res) => {
  const userId = req.session.userId;
  const requestId = req.params.id;
  try {
    // Optionally: check if user is allowed to undo this request
    await db.query('UPDATE RideRequests SET status = ? WHERE id = ?', ['pending', requestId]);
    res.redirect('/child-dashboard');
  } catch (err) {
    console.error('❌ Error undoing request completion:', err);
    res.status(500).send('Failed to undo completion.');
  }
});

module.exports = router;