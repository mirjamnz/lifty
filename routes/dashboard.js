// routes/dashboard.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');

// GET /dashboard
router.get('/dashboard', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.redirect('/login');

  try {
    // Get current user data (for home address display)
    const [[user]] = await db.query(
      'SELECT id, name, email, home_address, home_lat, home_lng FROM Users WHERE id = ?',
      [userId]
    );

    // Get user's children using ParentChild join
    const [children] = await db.query(`
      SELECT c.* FROM Children c
      JOIN ParentChild pc ON pc.child_id = c.id
      WHERE pc.parent_id = ?
    `, [userId]);

    // Get all parents for each child
    for (let child of children) {
      const [parents] = await db.query(`
        SELECT u.id, u.name, u.email FROM Users u
        JOIN ParentChild pc ON pc.parent_id = u.id
        WHERE pc.child_id = ?
      `, [child.id]);
      child.parents = parents;
    }

    // Get other users with locations (for map display)
    const [neighbors] = await db.query(`
      SELECT id, name, home_address, home_lat, home_lng 
      FROM Users 
      WHERE id != ? AND home_lat IS NOT NULL AND home_lng IS NOT NULL AND home_address IS NOT NULL
      ORDER BY name
    `, [userId]);

    // Get group invitations for this user
    const [groupInvitations] = await db.query(`
      SELECT egi.*, re.name AS event_name, re.day_of_week, re.start_time, re.end_time, re.location, u.name AS inviter_name
      FROM EventGroupInvitations egi
      JOIN RecurringEvents re ON egi.event_id = re.id
      JOIN Users u ON egi.inviter_id = u.id
      WHERE egi.invitee_email = (SELECT email FROM Users WHERE id = ?) AND egi.status = 'pending'
      ORDER BY egi.invited_at DESC
    `, [userId]);

    // Get calendar events for the user and their children
    const childIds = children.map(c => c.id);
    let calendarEvents = [];
    
    // Get ride offers where user is the driver (RideOffers)
    const [rideOffers] = await db.query(`
      SELECT ro.id, ro.pickup_time, ro.school as dropoff_location, 'Home' as pickup_location, 'offer' as type
      FROM RideOffers ro 
      WHERE ro.user_id = ? AND ro.pickup_time >= NOW()
    `, [userId]);

    console.log('Ride offers found:', rideOffers.length);
    
    // Get ride requests where user is assigned as driver (RideRequests)
    const [assignedRides] = await db.query(`
      SELECT rr.id, rr.pickup_time, rr.pickup_location, rr.dropoff_location, c.name as child_name, 'request' as type
      FROM RideRequests rr 
      JOIN Children c ON rr.child_id = c.id 
      WHERE rr.assigned_user_id = ? AND rr.pickup_time >= NOW()
    `, [userId]);

    console.log('Assigned rides found:', assignedRides.length);
    
    // Get ride requests for user's children (if they have children)
    let childrenRides = [];
    if (childIds.length > 0) {
      [childrenRides] = await db.query(`
        SELECT rr.id, rr.pickup_time, rr.pickup_location, rr.dropoff_location, c.name as child_name, 'child_request' as type
        FROM RideRequests rr 
        JOIN Children c ON rr.child_id = c.id 
        WHERE rr.child_id IN (?) AND rr.pickup_time >= NOW()
      `, [childIds]);
    }

    console.log('Children rides found:', childrenRides.length);
    
    // Get recurring event assignments for user's children (if they have children)
    let recurringAssignments = [];
    if (childIds.length > 0) {
      [recurringAssignments] = await db.query(`
        SELECT ea.id, ea.event_date, re.name as event_name, re.day_of_week, re.start_time, re.end_time, re.location, c.name as child_name, 'recurring' as type
        FROM EventAssignments ea
        JOIN RecurringEvents re ON ea.event_id = re.id
        JOIN Children c ON ea.child_id = c.id
        WHERE ea.child_id IN (?) AND ea.event_date >= CURDATE() AND ea.status != 'cancelled' AND ea.is_cancelled = FALSE
        ORDER BY ea.event_date ASC
      `, [childIds]);
    }

    console.log('Recurring assignments found:', recurringAssignments.length);

    // Format events for FullCalendar
    calendarEvents = [
      ...rideOffers.map(offer => ({
        id: `offer_${offer.id}`,
        title: `Drive: To ${offer.dropoff_location}`,
        start: offer.pickup_time,
        description: `${offer.pickup_location} → ${offer.dropoff_location}`,
        backgroundColor: '#dc3545',
        borderColor: '#c82333',
        type: offer.type
      })),
      ...assignedRides.map(ride => ({
        id: `ride_${ride.id}`,
        title: `Drive: ${ride.child_name}`,
        start: ride.pickup_time,
        description: `${ride.pickup_location} → ${ride.dropoff_location || 'Unknown'}`,
        backgroundColor: '#dc3545',
        borderColor: '#c82333',
        type: ride.type
      })),
      ...childrenRides.map(ride => ({
        id: `child_ride_${ride.id}`,
        title: `Ride: ${ride.child_name}`,
        start: ride.pickup_time,
        description: `${ride.pickup_location} → ${ride.dropoff_location || 'Unknown'}`,
        backgroundColor: '#28a745',
        borderColor: '#1e7e34',
        type: ride.type
      })),
      ...recurringAssignments.map(event => ({
        id: `event_${event.id}`,
        title: `${event.event_name} (${event.child_name})`,
        start: `${event.event_date}T${event.start_time}`,
        end: event.end_time ? `${event.event_date}T${event.end_time}` : undefined,
        description: `${event.location}`,
        backgroundColor: '#ffc107',
        borderColor: '#e0a800',
        type: event.type
      }))
    ];

    console.log('Total calendar events:', calendarEvents.length);
    console.log('Calendar events:', calendarEvents);

    res.render('dashboard', {
      session: req.session,
      user,
      children,
      neighbors,
      groupInvitations,
      calendarEvents,
      success: req.session.success,
      error: req.session.error
    });

    // Clear session messages
    delete req.session.success;
    delete req.session.error;
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Failed to load dashboard.');
  }
});

// POST /update-address
router.post('/update-address', async (req, res) => {
  const userId = req.session.userId;
  const { home_address, home_lat, home_lng } = req.body;

  console.log('Update address request:', { home_address, home_lat, home_lng });

  if (!home_address) {
    req.session.error = "Home address is required.";
    return res.redirect('/dashboard');
  }

  // If coordinates are missing, try to geocode the address
  let lat = home_lat;
  let lng = home_lng;

  if (!lat || !lng) {
    req.session.error = "Please select an address from the dropdown suggestions to get coordinates.";
    return res.redirect('/dashboard');
  }

  try {
    await db.query(
      'UPDATE Users SET home_address = ?, home_lat = ?, home_lng = ? WHERE id = ?',
      [home_address, parseFloat(lat), parseFloat(lng), userId]
    );

    req.session.success = "✅ Home address updated successfully!";
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Update address error:', err);
    req.session.error = "Failed to update address. Please try again.";
    res.redirect('/dashboard');
  }
});

// POST /add-child
router.post('/add-child', async (req, res) => {
  const parentId = req.session.userId;
  if (!parentId) return res.redirect('/login');

  const { name, school, club, child_username, child_password, invite_email_or_username } = req.body;

  if (!name || !school) {
    req.session.error = "Name and school are required.";
    return res.redirect('/dashboard');
  }

  try {
    const [childResult] = await db.query(
      'INSERT INTO Children (user_id, name, school, club) VALUES (?, ?, ?, ?)',
      [parentId, name.trim(), school.trim(), club?.trim() || null]
    );

    const childId = childResult.insertId;

    await db.query(
      'INSERT INTO ParentChild (parent_id, child_id) VALUES (?, ?)',
      [parentId, childId]
    );

    // Handle invite/link for another parent/caregiver
    if (invite_email_or_username) {
      const [[otherParent]] = await db.query(
        'SELECT id FROM Users WHERE email = ? OR username = ?',
        [invite_email_or_username, invite_email_or_username]
      );
      if (otherParent) {
        await db.query(
          'INSERT IGNORE INTO ParentChild (parent_id, child_id) VALUES (?, ?)',
          [otherParent.id, childId]
        );
        // Optionally: send notification/invite email here
      } else {
        // Optionally: create a new user and link, or show error
        // For now, just ignore if not found
      }
    }

    if (child_username && child_password) {
      const hashed = await bcrypt.hash(child_password, 10);
      try {
        await db.query(
          `INSERT INTO Users (name, username, email, password_hash, role, parent_id, child_profile_id)
           VALUES (?, ?, ?, ?, 'child', ?, ?)`,
          [
            child_username.trim(),
            child_username.trim(),
            `${child_username.trim()}@child.local`,
            hashed,
            parentId,
            childId
          ]
        );
      } catch (err) {
        console.error("❌ Failed to create child login account:", err.message);
        req.session.error = "Child profile added, but login creation failed. Try again.";
        return res.redirect('/dashboard');
      }
    }

    req.session.success = `✅ Child '${name}' added${child_username ? ' with login' : ''}.`;
    res.redirect('/dashboard');
  } catch (err) {
    console.error('❌ Add child error:', err.message, '\n', err.stack);
    req.session.error = "Something went wrong while adding the child.";
    res.redirect('/dashboard');
  }
});

// POST /edit-child/:id
router.post('/edit-child/:id', async (req, res) => {
  const parentId = req.session.userId;
  const childId = req.params.id;
  const { name, school, club, invite_email_or_username } = req.body;

  if (!parentId || !childId || !name || !school) {
    return res.status(400).send('Parent ID, child ID, name, and school are required.');
  }

  try {
    // Verify the child belongs to the parent
    const [[child]] = await db.query(
      'SELECT * FROM Children WHERE id = ? AND user_id = ?',
      [childId, parentId]
    );
    if (!child) {
      return res.status(403).send('Unauthorized or child not found.');
    }

    await db.query(
      'UPDATE Children SET name = ?, school = ?, club = ? WHERE id = ?',
      [name.trim(), school.trim(), club?.trim() || null, childId]
    );

    // Handle invite/link for another parent/caregiver
    if (invite_email_or_username) {
      const [[otherParent]] = await db.query(
        'SELECT id FROM Users WHERE email = ? OR username = ?',
        [invite_email_or_username, invite_email_or_username]
      );
      if (otherParent) {
        await db.query(
          'INSERT IGNORE INTO ParentChild (parent_id, child_id) VALUES (?, ?)',
          [otherParent.id, childId]
        );
        // Optionally: send notification/invite email here
      } else {
        // Optionally: create a new user and link, or show error
        // For now, just ignore if not found
      }
    }

    // Update the associated User record if it exists
    const [[user]] = await db.query(
      'SELECT * FROM Users WHERE child_profile_id = ?',
      [childId]
    );
    if (user) {
      await db.query(
        'UPDATE Users SET name = ? WHERE child_profile_id = ?',
        [name.trim(), childId]
      );
    }

    req.session.success = `✅ Child '${name}' updated successfully.`;
    res.redirect('/dashboard');
  } catch (err) {
    console.error('❌ Edit child error:', err.message, '\n', err.stack);
    req.session.error = "Something went wrong while editing the child.";
    res.redirect('/dashboard');
  }
});

// GET /delete-child/:id
router.get('/delete-child/:id', async (req, res) => {
  const userId = req.session.userId;
  const childId = req.params.id;

  if (!userId) return res.redirect('/login');

  try {
    // Remove parent-child link
    await db.query('DELETE FROM ParentChild WHERE child_id = ? AND parent_id = ?', [childId, userId]);
    const [[linkCount]] = await db.query('SELECT COUNT(*) as cnt FROM ParentChild WHERE child_id = ?', [childId]);
    if (linkCount.cnt === 0) {
      // Delete any user accounts linked to this child
      await db.query('DELETE FROM Users WHERE child_profile_id = ?', [childId]);
      // Now delete the child
      await db.query('DELETE FROM Children WHERE id = ?', [childId]);
    }
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Delete child error:', err);
    res.status(500).send('Failed to delete child.');
  }
});

// POST /children/:id/invite-parent
router.post('/children/:id/invite-parent', async (req, res) => {
  const parentId = req.session.userId;
  const childId = req.params.id;
  const { invite_email_or_username } = req.body;

  if (!parentId || !childId || !invite_email_or_username) {
    req.session.error = "All fields are required.";
    return res.redirect('/dashboard');
  }

  try {
    // Allow lookup by email, username, or name (unique name enforcement can be added later)
    const [[otherParent]] = await db.query(
      'SELECT id, name, email, username FROM Users WHERE email = ? OR username = ? OR name = ?',
      [invite_email_or_username, invite_email_or_username, invite_email_or_username]
    );
    console.log('Invite lookup:', invite_email_or_username, otherParent);
    if (otherParent) {
      await db.query(
        'INSERT IGNORE INTO ParentChild (parent_id, child_id) VALUES (?, ?)',
        [otherParent.id, childId]
      );
      req.session.success = `Parent '${otherParent.name}' linked successfully!`;
    } else {
      req.session.error = "Parent not found.";
    }
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Invite parent error:', err);
    req.session.error = "Something went wrong while inviting the parent.";
    res.redirect('/dashboard');
  }
});

// GET /api/calendar-events
// Returns all rides and recurring events for the logged-in user and their children in FullCalendar JSON format
router.get('/api/calendar-events', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ error: 'Not logged in' });

  try {
    // 1. Get user's children IDs
    const [children] = await db.query(
      'SELECT c.id, c.name FROM Children c JOIN ParentChild pc ON pc.child_id = c.id WHERE pc.parent_id = ?',
      [userId]
    );
    const childIds = children.map(c => c.id);

    // 2. Get rides where user is a driver or passenger (for themselves or their children)
    // Example: RideOffers (as driver)
    const [rideOffers] = await db.query(
      'SELECT id, date, start_time, end_time, from_location, to_location FROM RideOffers WHERE driver_id = ? AND date >= CURDATE()',
      [userId]
    );
    // Example: RideBookings (as passenger for children)
    let rideBookings = [];
    if (childIds.length > 0) {
      [rideBookings] = await db.query(
        'SELECT rb.id, rb.date, rb.start_time, rb.end_time, rb.from_location, rb.to_location, c.name as child_name FROM RideBookings rb JOIN Children c ON rb.child_id = c.id WHERE rb.child_id IN (?) AND rb.date >= CURDATE()',
        [childIds]
      );
    }

    // 3. Get recurring events (for user and children)
    // For simplicity, show next 30 days of assignments
    let recurringAssignments = [];
    if (childIds.length > 0) {
      [recurringAssignments] = await db.query(
        `SELECT ea.id, ea.event_date, re.name as event_name, re.day_of_week, re.start_time, re.end_time, re.location, c.name as child_name
         FROM EventAssignments ea
         JOIN RecurringEvents re ON ea.event_id = re.id
         JOIN Children c ON ea.child_id = c.id
         WHERE ea.child_id IN (?) AND ea.event_date >= CURDATE() AND ea.event_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)`,
        [childIds]
      );
    }

    // 4. Format all events for FullCalendar
    const events = [];
    // Ride offers (as driver)
    for (const offer of rideOffers) {
      events.push({
        title: `Drive: ${offer.from_location} → ${offer.to_location}`,
        start: `${offer.date}T${offer.start_time}`,
        end: offer.end_time ? `${offer.date}T${offer.end_time}` : undefined,
        description: 'You are the driver for this ride.'
      });
    }
    // Ride bookings (as passenger for children)
    for (const booking of rideBookings) {
      events.push({
        title: `Ride for ${booking.child_name}: ${booking.from_location} → ${booking.to_location}`,
        start: `${booking.date}T${booking.start_time}`,
        end: booking.end_time ? `${booking.date}T${booking.end_time}` : undefined,
        description: `Your child ${booking.child_name} is booked for this ride.`
      });
    }
    // Recurring assignments (for children)
    for (const assignment of recurringAssignments) {
      events.push({
        title: `Event: ${assignment.event_name} (${assignment.child_name})`,
        start: `${assignment.event_date}T${assignment.start_time}`,
        end: assignment.end_time ? `${assignment.event_date}T${assignment.end_time}` : undefined,
        description: `${assignment.child_name} has ${assignment.event_name} at ${assignment.location}`
      });
    }

    // 5. Get ride requests where user is the assigned driver
    const [assignedRideRequests] = await db.query(
      'SELECT rr.id, rr.pickup_time, rr.pickup_location, rr.dropoff_location, c.name as child_name FROM RideRequests rr JOIN Children c ON rr.child_id = c.id WHERE rr.assigned_user_id = ? AND rr.pickup_time >= NOW()',
      [userId]
    );
    // Add assigned ride requests to events
    for (const request of assignedRideRequests) {
      events.push({
        title: `Drive for ${request.child_name}: ${request.pickup_location} → ${request.dropoff_location}`,
        start: request.pickup_time,
        description: `You are the assigned driver for ${request.child_name} from ${request.pickup_location} to ${request.dropoff_location}.`
      });
    }

    res.json(events);
  } catch (err) {
    console.error('Calendar events error:', err);
    res.status(500).json({ error: 'Failed to load calendar events' });
  }
});

// Standalone calendar test page for troubleshooting FullCalendar
router.get('/calendar-test', (req, res) => {
  res.render('calendar-test');
});

// GET /calendar - Detailed calendar page
router.get('/calendar', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.redirect('/login');

  try {
    // Get user's children using ParentChild join
    const [children] = await db.query(`
      SELECT c.* FROM Children c
      JOIN ParentChild pc ON pc.child_id = c.id
      WHERE pc.parent_id = ?
    `, [userId]);

    // Get calendar events (same logic as dashboard)
    const childIds = children.map(c => c.id);
    let calendarEvents = [];
    
    // Get ride offers where user is the driver (RideOffers)
    const [rideOffers] = await db.query(`
      SELECT ro.id, ro.pickup_time, ro.school as dropoff_location, 'Home' as pickup_location, 'offer' as type
      FROM RideOffers ro 
      WHERE ro.user_id = ? AND ro.pickup_time >= NOW()
    `, [userId]);
    
    // Get ride requests where user is assigned as driver (RideRequests)
    const [assignedRides] = await db.query(`
      SELECT rr.id, rr.pickup_time, rr.pickup_location, rr.dropoff_location, c.name as child_name, 'request' as type
      FROM RideRequests rr 
      JOIN Children c ON rr.child_id = c.id 
      WHERE rr.assigned_user_id = ? AND rr.pickup_time >= NOW()
    `, [userId]);

    // Get ride requests for user's children (if they have children)
    let childrenRides = [];
    if (childIds.length > 0) {
      [childrenRides] = await db.query(`
        SELECT rr.id, rr.pickup_time, rr.pickup_location, rr.dropoff_location, c.name as child_name, 'child_request' as type
        FROM RideRequests rr 
        JOIN Children c ON rr.child_id = c.id 
        WHERE rr.child_id IN (?) AND rr.pickup_time >= NOW()
      `, [childIds]);
    }

    // Get recurring event assignments for user's children (if they have children)
    let recurringAssignments = [];
    if (childIds.length > 0) {
      [recurringAssignments] = await db.query(`
        SELECT ea.id, ea.event_date, re.name as event_name, re.day_of_week, re.start_time, re.end_time, re.location, c.name as child_name, 'recurring' as type
        FROM EventAssignments ea
        JOIN RecurringEvents re ON ea.event_id = re.id
        JOIN Children c ON ea.child_id = c.id
        WHERE ea.child_id IN (?) AND ea.event_date >= CURDATE() AND ea.status != 'cancelled' AND ea.is_cancelled = FALSE
        ORDER BY ea.event_date ASC
      `, [childIds]);
    }

    // Format events for FullCalendar
    calendarEvents = [
      ...rideOffers.map(offer => ({
        id: `offer_${offer.id}`,
        title: `Drive: To ${offer.dropoff_location}`,
        start: new Date(offer.pickup_time).toISOString().slice(0, 19).replace('T', ' '),
        description: `${offer.pickup_location} → ${offer.dropoff_location}`,
        backgroundColor: '#dc3545',
        borderColor: '#c82333',
        type: offer.type
      })),
      ...assignedRides.map(ride => ({
        id: `ride_${ride.id}`,
        title: `Drive: ${ride.child_name}`,
        start: new Date(ride.pickup_time).toISOString().slice(0, 19).replace('T', ' '),
        description: `${ride.pickup_location} → ${ride.dropoff_location || 'Unknown'}`,
        backgroundColor: '#dc3545',
        borderColor: '#c82333',
        type: ride.type
      })),
      ...childrenRides.map(ride => ({
        id: `child_ride_${ride.id}`,
        title: `Ride: ${ride.child_name}`,
        start: new Date(ride.pickup_time).toISOString().slice(0, 19).replace('T', ' '),
        description: `${ride.pickup_location} → ${ride.dropoff_location || 'Unknown'}`,
        backgroundColor: '#28a745',
        borderColor: '#1e7e34',
        type: ride.type
      })),
      ...recurringAssignments.map(event => ({
        id: `event_${event.id}`,
        title: `${event.event_name} (${event.child_name})`,
        start: `${event.event_date}T${event.start_time}`,
        end: event.end_time ? `${event.event_date}T${event.end_time}` : undefined,
        description: `${event.location}`,
        backgroundColor: '#ffc107',
        borderColor: '#e0a800',
        type: event.type
      }))
    ];

    res.render('calendar-detail', {
      session: req.session,
      children,
      calendarEvents
    });
  } catch (err) {
    console.error('Calendar page error:', err);
    res.status(500).send('Failed to load calendar page.');
  }
});

module.exports = router;