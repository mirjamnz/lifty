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

    // 3. Load child’s ride requests
    const [requests] = await db.query(
      'SELECT * FROM RideRequests WHERE child_id = ? ORDER BY created_at DESC',
      [user.child_profile_id]
    );

    // 4. Load child’s ride offers (if applicable)
    const [offers] = await db.query(
      'SELECT * FROM RideOffers WHERE child_id = ? ORDER BY created_at DESC',
      [user.child_profile_id]
    );

    // 5. Render child dashboard
    res.render('child-dashboard', {
      child: childProfile,
      requests,
      offers
    });
  } catch (err) {
    console.error('❌ Child dashboard error:', err);
    res.status(500).send('Failed to load dashboard.');
  }
});

module.exports = router;
