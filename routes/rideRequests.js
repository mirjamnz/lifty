// routes/rideRequests.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // or use your Sequelize models if applicable

// -------------------------------
// 🚘 POST /request-ride
// -------------------------------
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
    res.redirect('/rides');
  } catch (err) {
    console.error('❌ Error creating ride request:', err);
    res.status(500).send('Failed to create ride request.');
  }
});

// -------------------------------
// ✏️ POST /edit-request/:id
// -------------------------------
router.post('/edit-request/:id', async (req, res) => {
  const userId = req.session.userId;
  const requestId = req.params.id;
  const { pickup_location, dropoff_location, note } = req.body;

  if (!userId) return res.redirect('/login');

  try {
    await db.query(
      `UPDATE RideRequests SET pickup_location = ?, dropoff_location = ?, note = ?
       WHERE id = ? AND user_id = ?`,
      [pickup_location, dropoff_location || null, note || null, requestId, userId]
    );
    res.redirect('/rides');
  } catch (err) {
    console.error('❌ Edit Ride Request Error:', err);
    res.status(500).send('Could not update the request.');
  }
});

// -------------------------------
// 🗑️ POST /cancel-request/:id
// -------------------------------
router.post('/cancel-request/:id', async (req, res) => {
  const userId = req.session.userId;
  const requestId = req.params.id;

  if (!userId) return res.redirect('/login');

  try {
    await db.query(
      `DELETE FROM RideRequests WHERE id = ? AND user_id = ?`,
      [requestId, userId]
    );
    res.redirect('/rides');
  } catch (err) {
    console.error('❌ Cancel Ride Request Error:', err);
    res.status(500).send('Could not cancel the request.');
  }
});

// -------------------------------
// ✅ POST /assign-request/:id
// -------------------------------
router.post('/assign-request/:id', async (req, res) => {
  const userId = req.session.userId;
  const requestId = req.params.id;

  if (!userId) return res.redirect('/login');

  try {
    // First, get the ride request details to find the parent
    const [[rideRequest]] = await db.query(`
      SELECT rr.*, c.name as child_name, u.name as parent_name, u.id as parent_id
      FROM RideRequests rr
      JOIN Children c ON rr.child_id = c.id
      JOIN Users u ON rr.user_id = u.id
      WHERE rr.id = ?
    `, [requestId]);

    console.log('🔍 Ride request details:', rideRequest);

    if (!rideRequest) {
      return res.status(404).send('Ride request not found.');
    }

    // Get the helper's name
    const [[helperUser]] = await db.query('SELECT name FROM Users WHERE id = ?', [userId]);
    console.log('🔍 Helper user details:', helperUser);

    // Assign the ride request
    await db.query(
      `UPDATE RideRequests SET assigned_user_id = ? WHERE id = ?`,
      [userId, requestId]
    );
    console.log(`✅ Ride request ${requestId} assigned to user ${userId}`);

    // Send automatic notification message to the parent
    const notificationMessage = `🎉 Great news! Your ride request for ${rideRequest.child_name} has been fulfilled by ${helperUser.name}. 

📅 Date: ${new Date(rideRequest.pickup_time).toLocaleDateString()}
⏰ Time: ${new Date(rideRequest.pickup_time).toLocaleTimeString()}
📍 From: ${rideRequest.pickup_location}
🎯 To: ${rideRequest.dropoff_location}

You can view the details and communicate with ${helperUser.name} in the group chat for this ride.`;

    console.log('📝 Notification message:', notificationMessage);
    console.log('📤 Sending group message with params:', {
      sender_id: userId,
      recipient_id: null, // NULL for group messages
      content: notificationMessage,
      related_type: 'request',
      related_id: requestId
    });

    // Send as group message (recipient_id = NULL) instead of direct message
    const [messageResult] = await db.query(
      'INSERT INTO Messages (sender_id, recipient_id, content, related_type, related_id) VALUES (?, NULL, ?, ?, ?)',
      [userId, notificationMessage, 'request', requestId]
    );

    console.log('✅ Group message inserted successfully:', messageResult);

    console.log(`✅ Ride request ${requestId} assigned to user ${userId}. Notification sent to parent ${rideRequest.parent_id}.`);

    // Set success message in session
    req.session.success = 'ride_assigned';
    res.redirect('/rides');
  } catch (err) {
    console.error('❌ Assign Ride Error:', err);
    console.error('❌ Error details:', {
      message: err.message,
      code: err.code,
      sqlMessage: err.sqlMessage,
      sqlState: err.sqlState
    });
    res.status(500).send('Could not assign yourself to this ride.');
  }
});

// -------------------------------
// 🔍 GET /requests/autocomplete
// Used for pickup or dropoff fields
// -------------------------------
router.get('/autocomplete', async (req, res) => {
  const { term = '', type } = req.query;

  try {
    const params = [`%${term}%`];
    let query = `SELECT id, name, address, lat, lng, type FROM Organizations WHERE name LIKE ?`;

    if (type) {
      query += ` AND type = ?`;
      params.push(type);
    }

    query += ` ORDER BY name LIMIT 10`;

    const [orgs] = await db.query(query, params);

    const results = orgs.map(org => ({
      label: org.name,
      value: org.name,
      address: org.address,
      lat: org.lat,
      lng: org.lng,
      type: org.type
    }));

    res.json(results);
  } catch (err) {
    console.error('❌ Autocomplete error:', err);
    res.status(500).json({ error: 'Autocomplete failed' });
  }
});

module.exports = router;
