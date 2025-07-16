// routes/childDashboard.js
const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/child-dashboard', async (req, res) => {
  const userId = req.session.userId;
  const range = parseInt(req.query.range) || 2; // 0 = today, 2 = next 2 days, 7 = next 7 days

  try {
    // 1. Verify session and role
    const [[user]] = await db.query('SELECT * FROM Users WHERE id = ?', [userId]);
    if (user.role !== 'child') return res.status(403).send('Access denied.');

    // 2. Load child profile
    const [[childProfile]] = await db.query(
      'SELECT * FROM Children WHERE id = ?',
      [user.child_profile_id]
    );

    // Date range filter
    const today = new Date();
    today.setHours(0,0,0,0);
    const maxDate = new Date(today);
    maxDate.setDate(today.getDate() + range);
    const maxDateStr = maxDate.toISOString().split('T')[0];
    const todayStr = today.toISOString().split('T')[0];

    // 3. Load child's ride requests with driver info (filtered by range)
    const [requests] = await db.query(
      `SELECT r.id, r.pickup_location, r.dropoff_location, r.pickup_time, r.assigned_user_id, r.status,
              u.name AS driver_name
       FROM RideRequests r
       LEFT JOIN Users u ON r.assigned_user_id = u.id
       WHERE r.child_id = ? AND DATE(r.pickup_time) >= ? AND DATE(r.pickup_time) <= ?
       ORDER BY r.pickup_time ASC`,
      [user.child_profile_id, todayStr, maxDateStr]
    );
    requests.forEach(request => {
      request.status = request.status || (request.assigned_user_id ? 'Assigned' : 'Pending');
      request.formatted_time = new Date(request.pickup_time).toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' });
      request.type = 'request';
    });

    // 4. Load child's ride offers (filtered by range)
    const [offers] = await db.query(
      `SELECT o.id, o.school, o.pickup_time
       FROM RideOffers o
       WHERE o.child_id = ? AND DATE(o.pickup_time) >= ? AND DATE(o.pickup_time) <= ?
       ORDER BY o.pickup_time ASC`,
      [user.child_profile_id, todayStr, maxDateStr]
    );
    offers.forEach(offer => {
      offer.formatted_time = new Date(offer.pickup_time).toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' });
      offer.type = 'offer';
    });

    // 5. Load child's recurring event assignments (filtered by range)
    const [recurringAssignments] = await db.query(`
      SELECT ea.*, re.name AS event_name, re.location, re.day_of_week, re.start_time, re.end_time, u.name AS assigned_parent_name
      FROM EventAssignments ea
      JOIN RecurringEvents re ON ea.event_id = re.id
      JOIN Users u ON ea.user_id = u.id
      WHERE ea.child_id = ? AND ea.event_date >= ? AND ea.event_date <= ? AND ea.status != 'cancelled' AND ea.is_cancelled = FALSE
      ORDER BY ea.event_date ASC, re.name, ea.assignment_type
    `, [user.child_profile_id, todayStr, maxDateStr]);
    recurringAssignments.forEach(assignment => {
      assignment.formatted_time = new Date(assignment.event_date).toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' });
      assignment.type = 'recurring';
    });

    // After fetching requests, offers, recurringAssignments
    // If there are no rides for the selected range, auto-expand to next available ride
    const allRidesInRange = [...requests, ...offers, ...recurringAssignments];
    if (allRidesInRange.length === 0) {
      // Find the soonest future ride (from all ride types, regardless of range)
      const [nextRequest] = await db.query(
        `SELECT pickup_time FROM RideRequests WHERE child_id = ? AND pickup_time > NOW() ORDER BY pickup_time ASC LIMIT 1`,
        [user.child_profile_id]
      );
      const [nextOffer] = await db.query(
        `SELECT pickup_time FROM RideOffers WHERE child_id = ? AND pickup_time > NOW() ORDER BY pickup_time ASC LIMIT 1`,
        [user.child_profile_id]
      );
      const [nextRecurring] = await db.query(
        `SELECT event_date FROM EventAssignments WHERE child_id = ? AND event_date > CURDATE() AND status != 'cancelled' AND is_cancelled = FALSE ORDER BY event_date ASC LIMIT 1`,
        [user.child_profile_id]
      );
      // Find the soonest date
      let nextDate = null;
      [nextRequest, nextOffer, nextRecurring].forEach(r => {
        if (r && Object.values(r)[0]) {
          const d = new Date(Object.values(r)[0]);
          if (!nextDate || d < nextDate) nextDate = d;
        }
      });
      if (nextDate) {
        nextDate.setHours(0,0,0,0);
        const daysDiff = Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24));
        let newRange = 0;
        if (daysDiff > 0 && daysDiff <= 2) newRange = 2;
        else if (daysDiff > 2) newRange = 7;
        if (newRange !== range) {
          return res.redirect(`/child-dashboard?range=${newRange}&autojump=1`);
        }
      }
    }

    // 6. Render child dashboard with session
    const [users] = await db.query('SELECT id, name FROM Users');
    res.render('child-dashboard', {
      child: childProfile,
      requests,
      offers,
      recurringAssignments,
      users, // For driver lookup
      session: req.session,
      range,
      autojump: req.query.autojump === '1',
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