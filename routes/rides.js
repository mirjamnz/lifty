// routes/rides.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// Middleware to ensure the user is authenticated
function isAuthenticated(req, res, next) {
  if (req.session.userId) return next();
  res.redirect('/login');
}

// --- View Rides Page ---
router.get('/', isAuthenticated, async (req, res) => {
  const userId = req.session.userId;

  try {
    const [children] = await db.query('SELECT * FROM Children WHERE user_id = ?', [userId]);

    const [rideOffers] = await db.query(`
      SELECT RideOffers.*, Users.name AS driver_name
      FROM RideOffers
      JOIN Users ON RideOffers.user_id = Users.id
      ORDER BY pickup_time ASC
    `);

    const [requests] = await db.query(`
      SELECT RideRequests.*, Children.name AS child_name, Users.name AS user_name
      FROM RideRequests
      JOIN Children ON RideRequests.child_id = Children.id
      JOIN Users ON RideRequests.user_id = Users.id
      ORDER BY RideRequests.created_at DESC
    `);

    const [rides] = await db.query('SELECT * FROM Rides');
    const [signups] = await db.query(`
      SELECT R.ride_id, C.id AS child_id, C.name 
      FROM ride_signups R
      JOIN children C ON R.child_id = C.id
    `);

    const passengers = {};
    signups.forEach(row => {
      if (!passengers[row.ride_id]) passengers[row.ride_id] = [];
      passengers[row.ride_id].push({ id: row.child_id, name: row.name });
    });

    rides.forEach(ride => {
      ride.passengers = passengers[ride.id] || [];
      ride.seats_taken = ride.passengers.length;
    });

    const [userChildren] = await db.query('SELECT id, name FROM children WHERE user_id = ?', [userId]);

    res.render('rides', {
      session: req.session,
      rideOffers,
      requests,
      rides,
      userChildren,
      currentUser: { id: userId, name: req.session.userName },
      children
    });
  } catch (err) {
    console.error('Error loading rides view:', err);
    res.status(500).send('Failed to load rides.');
  }
});

// --- Assign a ride request to self ---
router.post('/assign-request/:id', isAuthenticated, async (req, res) => {
  try {
    await db.query(`UPDATE RideRequests SET assigned_user_id = ? WHERE id = ?`, [req.session.userId, req.params.id]);
    res.redirect('/rides');
  } catch (err) {
    console.error('Assign request error:', err);
    res.status(500).send('Error assigning yourself.');
  }
});

// --- Edit a ride request ---
router.post('/edit-request/:id', isAuthenticated, async (req, res) => {
  const { pickup_location, dropoff_location, note } = req.body;
  try {
    await db.query(
      `UPDATE RideRequests SET pickup_location = ?, dropoff_location = ?, note = ? WHERE id = ? AND user_id = ?`,
      [pickup_location, dropoff_location || null, note || null, req.params.id, req.session.userId]
    );
    res.redirect('/rides');
  } catch (err) {
    console.error('Edit request error:', err);
    res.status(500).send('Edit failed.');
  }
});

// --- Cancel a ride request ---
router.post('/cancel-request/:id', isAuthenticated, async (req, res) => {
  try {
    await db.query(`DELETE FROM RideRequests WHERE id = ? AND user_id = ?`, [req.params.id, req.session.userId]);
    res.redirect('/rides');
  } catch (err) {
    console.error('Cancel request error:', err);
    res.status(500).send('Cancel failed.');
  }
});

// --- Sign up child for ride ---
router.post('/:id/signup', isAuthenticated, async (req, res) => {
  const rideId = req.params.id;
  const childId = req.body.child_id;
  try {
    const [childRows] = await db.query('SELECT * FROM children WHERE id = ? AND user_id = ?', [childId, req.session.userId]);
    if (!childRows.length) return res.status(403).send('Invalid child.');

    const [[ride]] = await db.query(`
      SELECT seats, (SELECT COUNT(*) FROM ride_signups WHERE ride_id = ?) AS taken 
      FROM rides WHERE id = ?`, [rideId, rideId]
    );

    if (ride && ride.taken < ride.seats) {
      await db.query('INSERT INTO ride_signups (ride_id, child_id) VALUES (?, ?)', [rideId, childId]);
      res.redirect('/rides');
    } else {
      res.status(400).send('Ride is full.');
    }
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(400).send('Child already signed up.');
    } else {
      console.error('Signup error:', err);
      res.status(500).send('Signup failed.');
    }
  }
});

// --- Remove a child from a ride (owner only) ---
router.post('/:rideId/remove/:childId', isAuthenticated, async (req, res) => {
  const { rideId, childId } = req.params;
  try {
    await db.query(`
      DELETE R FROM ride_signups R
      JOIN rides D ON R.ride_id = D.id
      WHERE R.ride_id = ? AND R.child_id = ? AND D.owner_id = ?
    `, [rideId, childId, req.session.userId]);
    res.redirect('/rides');
  } catch (err) {
    console.error('Remove child error:', err);
    res.status(500).send('Remove failed.');
  }
});

module.exports = router;
