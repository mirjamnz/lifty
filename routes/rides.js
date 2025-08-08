// routes/rides.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /rides > Load ride requests by the user
router.get('/', async (req, res) => {
  const userId = req.session.userId;
  const { filter = 'all', expired = 'true', range = '7' } = req.query;

  if (!userId) return res.redirect('/login');

  try {
    // Use ParentChild join to get all children linked to this parent
    const [children] = await db.query(`
      SELECT c.* FROM Children c
      JOIN ParentChild pc ON pc.child_id = c.id
      WHERE pc.parent_id = ?
    `, [userId]);

    // Ride Offers with booking information
    let offerQuery = `
      SELECT ro.*, u.name AS driver_name,
             (ro.available_seats - COALESCE(booked_seats.total_booked, 0)) AS remaining_seats,
             COALESCE(booked_seats.total_booked, 0) AS booked_seats
      FROM RideOffers ro
      JOIN Users u ON ro.user_id = u.id
      LEFT JOIN (
        SELECT offer_id, SUM(seats_requested) as total_booked
        FROM RideBookings 
        WHERE status = 'confirmed'
        GROUP BY offer_id
      ) booked_seats ON ro.id = booked_seats.offer_id
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

    // Get user's bookings for offers they've made
    const [userBookings] = await db.query(`
      SELECT rb.*, u.name AS parent_name, c.name AS child_name, ro.school, ro.pickup_time
      FROM RideBookings rb
      JOIN Users u ON rb.user_id = u.id
      JOIN Children c ON rb.child_id = c.id
      JOIN RideOffers ro ON rb.offer_id = ro.id
      WHERE ro.user_id = ? AND rb.status = 'confirmed'
      ORDER BY ro.pickup_time DESC
    `, [userId]);

    // Get bookings made by current user (both as passenger and driver) - consolidated by ride
    const [myBookings] = await db.query(`
      SELECT 
        ro.id,
        'confirmed' AS status,
        ro.notes,
        ro.school,
        'Home' AS pickup_location,
        ro.pickup_time,
        u.name AS driver_name,
        GROUP_CONCAT(c.name SEPARATOR ', ') AS child_names,
        COUNT(c.id) AS child_count,
        'passenger' AS booking_type,
        rb.user_id AS booking_user_id,
        'offer' AS ride_type
      FROM RideBookings rb
      JOIN RideOffers ro ON rb.offer_id = ro.id
      JOIN Users u ON ro.user_id = u.id
      JOIN Children c ON rb.child_id = c.id
      WHERE rb.user_id = ? AND rb.status = 'confirmed'
      GROUP BY ro.id, ro.school, ro.pickup_time, ro.notes, u.name, rb.user_id
      
      UNION ALL
      
      SELECT 
        ro.id,
        'confirmed' AS status,
        ro.notes,
        ro.school,
        'Home' AS pickup_location,
        ro.pickup_time,
        ? AS driver_name,
        GROUP_CONCAT(c.name SEPARATOR ', ') AS child_names,
        COUNT(c.id) AS child_count,
        'driver' AS booking_type,
        rb.user_id AS booking_user_id,
        'offer' AS ride_type
      FROM RideBookings rb
      JOIN RideOffers ro ON rb.offer_id = ro.id
      JOIN Children c ON rb.child_id = c.id
      JOIN Users u ON rb.user_id = u.id
      WHERE ro.user_id = ? AND rb.status = 'confirmed'
      GROUP BY ro.id, ro.school, ro.pickup_time, ro.notes, rb.user_id
      
      UNION ALL
      
      SELECT 
        rr.id,
        'confirmed' AS status,
        rr.note AS notes,
        rr.dropoff_location AS school,
        rr.pickup_location,
        rr.pickup_time,
        ? AS driver_name,
        c.name AS child_names,
        1 AS child_count,
        'driver' AS booking_type,
        rr.user_id AS booking_user_id,
        'request' AS ride_type
      FROM RideRequests rr
      JOIN Children c ON rr.child_id = c.id
      WHERE rr.assigned_user_id = ? AND rr.pickup_time > NOW()
      
      ORDER BY pickup_time DESC
    `, [userId, req.session.userName, userId, req.session.userName, userId]);

    // --- Recurring Event Assignments ---
    // Get all children for this user (via ParentChild join)
    const [myChildren] = await db.query(`
      SELECT c.* FROM Children c
      JOIN ParentChild pc ON pc.child_id = c.id
      WHERE pc.parent_id = ?
    `, [userId]);

    // Get assignments where the user is the assigned parent (driver/helper) - CONSOLIDATED
    const [userAssignments] = await db.query(`
      SELECT 
        ea.event_id,
        ea.event_date,
        ea.assignment_type,
        ea.status,
        ea.notes,
        re.name AS event_name,
        re.location,
        re.day_of_week,
        re.start_time,
        re.end_time,
        u.name AS assigned_parent_name,
        GROUP_CONCAT(c.name ORDER BY c.name SEPARATOR ', ') AS child_names,
        COUNT(c.id) AS child_count,
        MIN(ea.id) AS assignment_id,
        MIN(c.user_id) as child_parent_id
      FROM EventAssignments ea
      JOIN RecurringEvents re ON ea.event_id = re.id
      JOIN Children c ON ea.child_id = c.id
      JOIN Users u ON ea.user_id = u.id
      WHERE ea.user_id = ? AND ea.event_date >= CURDATE() AND ea.status != 'cancelled' AND ea.is_cancelled = FALSE
      GROUP BY ea.event_id, ea.event_date, ea.assignment_type, ea.status, ea.notes, re.name, re.location, re.day_of_week, re.start_time, re.end_time, u.name
      ORDER BY ea.event_date ASC, re.name, ea.assignment_type
    `, [userId]);

    // Get individual assignments for children where the user is NOT the driver
    const [childAssignments] = await db.query(`
      SELECT ea.*, re.name AS event_name, re.location, re.day_of_week, re.start_time, re.end_time, c.name AS child_name, u.name AS assigned_parent_name, c.user_id as child_parent_id
      FROM EventAssignments ea
      JOIN RecurringEvents re ON ea.event_id = re.id
      JOIN Children c ON ea.child_id = c.id
      JOIN Users u ON ea.user_id = u.id
      WHERE ea.child_id IN (
        SELECT c.id FROM Children c
        JOIN ParentChild pc ON pc.child_id = c.id
        WHERE pc.parent_id = ?
      ) AND ea.event_date >= CURDATE() AND ea.status != 'cancelled' AND ea.is_cancelled = FALSE
      ORDER BY ea.event_id, ea.child_id, ea.assignment_type, ea.event_date ASC
    `, [userId]);

    // Get assignments where the current user is the assigned driver (for any child)
    const [driverAssignments] = await db.query(`
      SELECT ea.*, re.name AS event_name, re.location, re.day_of_week, re.start_time, re.end_time, c.name AS child_name, u.name AS assigned_parent_name, c.user_id as child_parent_id
      FROM EventAssignments ea
      JOIN RecurringEvents re ON ea.event_id = re.id
      JOIN Children c ON ea.child_id = c.id
      JOIN Users u ON ea.user_id = u.id
      WHERE ea.user_id = ? AND ea.event_date >= CURDATE() AND ea.status != 'cancelled' AND ea.is_cancelled = FALSE
      ORDER BY ea.event_id, ea.child_id, ea.assignment_type, ea.event_date ASC
    `, [userId]);

    // Create a set of consolidated assignment keys to filter out individual assignments
    const consolidatedKeys = new Set();
    userAssignments.forEach(a => {
      const key = `${a.event_id}_${a.event_date}_${a.assignment_type}`;
      consolidatedKeys.add(key);
    });

    // Build the final recurringAssignments array
    let recurringAssignments = [];

    // Add consolidated assignments first
    for (const a of userAssignments) {
      recurringAssignments.push({
        id: a.assignment_id,
        event_id: a.event_id,
        event_date: a.event_date,
        assignment_type: a.assignment_type,
        status: a.status,
        notes: a.notes,
        event_name: a.event_name,
        location: a.location,
        day_of_week: a.day_of_week,
        start_time: a.start_time,
        end_time: a.end_time,
        child_name: a.child_names, // This will show all children names
        assigned_parent_name: a.assigned_parent_name,
        child_parent_id: a.child_parent_id,
        user_id: userId,
        child_count: a.child_count,
        is_consolidated: true // Flag to indicate this is a consolidated entry
      });
    }

    // Add individual assignments only if they're not covered by a consolidated assignment
    const seenIndividualKeys = new Set();
    for (const a of childAssignments) {
      const key = `${a.event_id}_${a.child_id}_${a.assignment_type}`;
      const consolidatedKey = `${a.event_id}_${a.event_date}_${a.assignment_type}`;
      
      // Skip if this child's assignment is covered by a consolidated assignment
      if (consolidatedKeys.has(consolidatedKey)) {
        continue;
      }
      
      // Skip if we've already seen this individual assignment
      if (seenIndividualKeys.has(key)) {
        continue;
      }
      
      seenIndividualKeys.add(key);
      recurringAssignments.push({
        id: a.id,
        event_id: a.event_id,
        event_date: a.event_date,
        assignment_type: a.assignment_type,
        status: a.status,
        notes: a.notes,
        event_name: a.event_name,
        location: a.location,
        day_of_week: a.day_of_week,
        start_time: a.start_time,
        end_time: a.end_time,
        child_name: a.child_name,
        assigned_parent_name: a.assigned_parent_name,
        child_parent_id: a.child_parent_id,
        user_id: a.user_id,
        child_count: 1,
        is_consolidated: false
      });
    }

    // Add driver assignments (where user is the driver but not covered by consolidated assignments)
    const seenDriverKeys = new Set();
    for (const a of driverAssignments) {
      const key = `${a.event_id}_${a.child_id}_${a.assignment_type}`;
      const consolidatedKey = `${a.event_id}_${a.event_date}_${a.assignment_type}`;
      
      // Skip if this assignment is covered by a consolidated assignment
      if (consolidatedKeys.has(consolidatedKey)) {
        continue;
      }
      
      // Skip if we've already seen this driver assignment
      if (seenDriverKeys.has(key)) {
        continue;
      }
      
      seenDriverKeys.add(key);
      recurringAssignments.push({
        id: a.id,
        event_id: a.event_id,
        event_date: a.event_date,
        assignment_type: a.assignment_type,
        status: a.status,
        notes: a.notes,
        event_name: a.event_name,
        location: a.location,
        day_of_week: a.day_of_week,
        start_time: a.start_time,
        end_time: a.end_time,
        child_name: a.child_name,
        assigned_parent_name: a.assigned_parent_name,
        child_parent_id: a.child_parent_id,
        user_id: a.user_id,
        child_count: 1,
        is_consolidated: false
      });
    }

    // --- Unassigned Group Event Instances ---
    // Filter by date range (default: next 7 days)
    let days = 7;
    if (range === '30') days = 30;
    if (range === '60') days = 60;
    // Get legacy unassigned group instances 
    const [legacyUnassignedInstances] = await db.query(`
      SELECT ei.*, re.name AS event_name, re.location, re.day_of_week, re.start_time, re.end_time, u.name AS driver_name
      FROM EventInstances ei
      JOIN RecurringEvents re ON ei.event_id = re.id
      JOIN EventGroupMembers egm ON re.id = egm.event_id
      LEFT JOIN Users u ON ei.driver_id = u.id
      WHERE egm.user_id = ? AND egm.role = 'parent' AND egm.is_active = TRUE
        AND ei.event_date >= CURDATE()
        AND ei.event_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
        AND (
          -- No active dropoff assignments
          NOT EXISTS (
            SELECT 1 FROM EventAssignments ea 
            WHERE ea.event_id = ei.event_id 
            AND ea.event_date = ei.event_date 
            AND ea.assignment_type = 'dropoff'
            AND ea.is_cancelled = FALSE
          )
          OR
          -- No active pickup assignments  
          NOT EXISTS (
            SELECT 1 FROM EventAssignments ea 
            WHERE ea.event_id = ei.event_id 
            AND ea.event_date = ei.event_date 
            AND ea.assignment_type = 'pickup'
            AND ea.is_cancelled = FALSE
          )
        )
      ORDER BY ei.event_date ASC, re.name
      LIMIT 20
    `, [userId, days]);

    // Get ActivityGroup events that need driver assignments
    const [activityGroupInstances] = await db.query(`
      SELECT 
        CONCAT('activity_group_', ag.id, '_', DATE_FORMAT(generated_date.event_date, '%Y-%m-%d')) as id,
        ag.name AS event_name,
        ag.location,
        ag.day_of_week,
        ag.start_time,
        ag.end_time,
        generated_date.event_date,
        NULL as driver_name
      FROM ActivityGroups ag
      JOIN ActivityGroupMembers agm ON ag.id = agm.group_id
      CROSS JOIN (
        SELECT CURDATE() + INTERVAL n.number DAY AS event_date
        FROM (
          SELECT 0 as number UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 
          UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10 UNION SELECT 11 UNION SELECT 12 UNION SELECT 13 
          UNION SELECT 14 UNION SELECT 15 UNION SELECT 16 UNION SELECT 17 UNION SELECT 18 UNION SELECT 19 UNION SELECT 20
          UNION SELECT 21 UNION SELECT 22 UNION SELECT 23 UNION SELECT 24 UNION SELECT 25 UNION SELECT 26 UNION SELECT 27
          UNION SELECT 28 UNION SELECT 29 UNION SELECT 30
        ) n
      ) generated_date
      WHERE agm.user_id = ? 
        AND agm.is_active = TRUE 
        AND ag.is_active = TRUE 
        AND ag.has_schedule = TRUE
        AND generated_date.event_date >= CURDATE()
        AND generated_date.event_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
        AND DAYNAME(generated_date.event_date) = CASE ag.day_of_week
          WHEN 'Mon' THEN 'Monday'
          WHEN 'Tue' THEN 'Tuesday' 
          WHEN 'Wed' THEN 'Wednesday'
          WHEN 'Thu' THEN 'Thursday'
          WHEN 'Fri' THEN 'Friday'
          WHEN 'Sat' THEN 'Saturday'
          WHEN 'Sun' THEN 'Sunday'
        END
        AND NOT EXISTS (
          -- Only show if no one is assigned yet (no assignments for this date)
          SELECT 1 FROM ActivityGroupAssignments aga 
          WHERE aga.group_id = ag.id 
          AND aga.assignment_date = generated_date.event_date 
          AND aga.status = 'confirmed'
        )
      ORDER BY generated_date.event_date ASC, ag.name
      LIMIT 10
    `, [userId, days]);

    // Combine legacy and ActivityGroup instances
    const unassignedGroupInstances = [...legacyUnassignedInstances, ...activityGroupInstances];

    // --- Admin Group Assignments ---
    let adminGroupAssignments = [];
    // Find group events where user is admin
    const [adminGroups] = await db.query(`
      SELECT event_id FROM EventGroupMembers WHERE user_id = ? AND role = 'admin' AND is_active = TRUE
    `, [userId]);
    if (adminGroups.length > 0) {
      const adminEventIds = adminGroups.map(g => g.event_id);
      // Fetch all assignments for these events (upcoming only)
      if (adminEventIds.length > 0) {
        const [allAssignments] = await db.query(`
          SELECT ea.*, re.name AS event_name, re.location, re.day_of_week, re.start_time, re.end_time, c.name AS child_name, u.name AS assigned_parent_name
          FROM EventAssignments ea
          JOIN RecurringEvents re ON ea.event_id = re.id
          JOIN Children c ON ea.child_id = c.id
          JOIN Users u ON ea.user_id = u.id
          WHERE ea.event_id IN (?) AND ea.event_date >= CURDATE() AND ea.status != 'cancelled' AND ea.is_cancelled = FALSE
          ORDER BY ea.event_date ASC, re.name, ea.assignment_type
        `, [adminEventIds]);
        adminGroupAssignments = allAssignments;
      }
    }

    // --- My Kids' Group Assignments ---
    let myKidsGroupAssignments = [];
    if (children.length > 0) {
      [myKidsGroupAssignments] = await db.query(`
        SELECT ea.event_id, ea.event_date, ea.assignment_type, ea.status, re.name AS event_name, re.location, re.day_of_week, re.start_time, re.end_time, c.name AS child_name, u.name AS driver_name
        FROM EventAssignments ea
        JOIN RecurringEvents re ON ea.event_id = re.id
        JOIN Children c ON ea.child_id = c.id
        JOIN Users u ON ea.user_id = u.id
        WHERE ea.child_id IN (?)
          AND re.is_group_event = TRUE
          AND ea.event_date >= CURDATE()
          AND ea.event_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
          AND ea.status != 'cancelled' AND ea.is_cancelled = FALSE
        ORDER BY ea.event_date ASC, re.name, ea.assignment_type, c.name
      `, [children.map(c => c.id), days]);
    }

    // --- My Bookings Section: filter by range ---
    const filteredMyBookings = myBookings.filter(b => {
      const date = new Date(b.pickup_time);
      const now = new Date();
      const max = new Date();
      max.setDate(now.getDate() + days);
      return date >= now && date <= max;
    });

    // --- Upcoming Recurring Event Rides: filter by range ---
    const filteredRecurringAssignments = recurringAssignments.filter(a => {
      const date = new Date(a.event_date);
      const now = new Date();
      const max = new Date();
      max.setDate(now.getDate() + days);
      return date >= now && date <= max;
    });

    // --- Admin Group Assignments: filter by range ---
    const filteredAdminGroupAssignments = adminGroupAssignments.filter(a => {
      const date = new Date(a.event_date);
      const now = new Date();
      const max = new Date();
      max.setDate(now.getDate() + days);
      return date >= now && date <= max;
    });

    res.render('rides', {
      session: req.session,
      children,
      rideOffers,
      requests,
      userBookings: filteredMyBookings,
      myBookings: filteredMyBookings,
      filter,
      expired,
      success: req.query.success || req.session.success,
      recurringAssignments: filteredRecurringAssignments,
      unassignedGroupInstances, // <-- already filtered by range
      range, // <-- pass selected range to template
      adminGroupAssignments: filteredAdminGroupAssignments, // <-- filtered
      myKidsGroupAssignments // <-- already filtered in SQL
    });

    // Clear session success message after passing it to template
    delete req.session.success;
  } catch (err) {
    console.error('GET /rides error:', err);
    res.status(500).send('Failed to load rides page.');
  }
});

// POST /rides/book-ride/:offerId - Book a ride
router.post('/book-ride/:offerId', async (req, res) => {
  const userId = req.session.userId;
  const offerId = req.params.offerId;
  const { child_ids, notes } = req.body;

  if (!userId) return res.redirect('/login');

  try {
    // Check if offer exists and has enough seats
    const [[offer]] = await db.query(`
      SELECT ro.*, u.name AS driver_name,
             (ro.available_seats - COALESCE(booked_seats.total_booked, 0)) AS remaining_seats
      FROM RideOffers ro
      JOIN Users u ON ro.user_id = u.id
      LEFT JOIN (
        SELECT offer_id, SUM(seats_requested) as total_booked
        FROM RideBookings 
        WHERE status = 'confirmed'
        GROUP BY offer_id
      ) booked_seats ON ro.id = booked_seats.offer_id
      WHERE ro.id = ?
    `, [offerId]);

    if (!offer) {
      return res.status(404).send('Ride offer not found.');
    }

    // Parse child_ids (could be array or single value)
    const childIds = Array.isArray(child_ids) ? child_ids : [child_ids];
    const seatsRequested = childIds.length;

    if (offer.remaining_seats < seatsRequested) {
      return res.status(400).send('Not enough seats available.');
    }

    // Check if user already has a booking for this offer
    const [[existingBooking]] = await db.query(
      'SELECT * FROM RideBookings WHERE offer_id = ? AND user_id = ? AND status = "confirmed"',
      [offerId, userId]
    );

    if (existingBooking) {
      return res.status(400).send('You already have a booking for this ride.');
    }

    // Create booking for each child
    for (const childId of childIds) {
      await db.query(
        'INSERT INTO RideBookings (offer_id, user_id, child_id, seats_requested, notes, status) VALUES (?, ?, ?, ?, ?, "confirmed")',
        [offerId, userId, childId, 1, notes || null]
      );
    }

    // --- Notification: Send group message to driver, booking parent, and child ---
    // Fetch driver, booking parent, and child info
    const [[driver]] = await db.query('SELECT id, name FROM Users WHERE id = ?', [offer.user_id]);
    const [[bookingParent]] = await db.query('SELECT id, name FROM Users WHERE id = ?', [userId]);
    const [childrenInfo] = await db.query('SELECT id, name FROM Children WHERE id IN (?)', [childIds]);
    const childNames = Array.isArray(childrenInfo) ? childrenInfo.map(c => c.name).join(', ') : childrenInfo.name;

    // Compose message
    const message = `🚗 New ride booking!\n${childNames} has been signed up for your ride offer to ${offer.school} on ${new Date(offer.pickup_time).toLocaleString()}.\n\nParents: ${driver.name} (driver), ${bookingParent.name} (parent).`;

    // Insert as group message
    await db.query(
      'INSERT INTO Messages (sender_id, recipient_id, content, related_type, related_id) VALUES (?, NULL, ?, ?, ?)',
      [userId, message, 'offer', offerId]
    );

    res.redirect('/rides?success=booking_created');
  } catch (err) {
    console.error('Error booking ride:', err);
    res.status(500).send('Failed to book ride.');
  }
});

// POST /rides/cancel-booking/:bookingId - Cancel a booking
router.post('/cancel-booking/:bookingId', async (req, res) => {
  const userId = req.session.userId;
  const bookingId = req.params.bookingId;

  if (!userId) return res.redirect('/login');

  try {
    // Check if booking exists and belongs to user
    const [[booking]] = await db.query(
      'SELECT * FROM RideBookings WHERE id = ? AND user_id = ?',
      [bookingId, userId]
    );

    if (!booking) {
      return res.status(404).send('Booking not found.');
    }

    // Cancel booking
    await db.query(
      'UPDATE RideBookings SET status = "cancelled" WHERE id = ?',
      [bookingId]
    );

    res.redirect('/rides?success=booking_cancelled');
  } catch (err) {
    console.error('Error cancelling booking:', err);
    res.status(500).send('Failed to cancel booking.');
  }
});

// POST /rides/accept-booking/:bookingId - Accept a booking (for drivers)
router.post('/accept-booking/:bookingId', async (req, res) => {
  const userId = req.session.userId;
  const bookingId = req.params.bookingId;

  if (!userId) return res.redirect('/login');

  try {
    // Check if booking exists and if user is the driver
    const [[booking]] = await db.query(`
      SELECT rb.*, ro.user_id as driver_id
      FROM RideBookings rb
      JOIN RideOffers ro ON rb.offer_id = ro.id
      WHERE rb.id = ? AND ro.user_id = ?
    `, [bookingId, userId]);

    if (!booking) {
      return res.status(404).send('Booking not found or you are not the driver.');
    }

    // Accept booking
    await db.query(
      'UPDATE RideBookings SET status = "accepted" WHERE id = ?',
      [bookingId]
    );

    res.redirect('/rides?success=booking_accepted');
  } catch (err) {
    console.error('Error accepting booking:', err);
    res.status(500).send('Failed to accept booking.');
  }
});

// POST /rides/reject-booking/:bookingId - Reject a booking (for drivers)
router.post('/reject-booking/:bookingId', async (req, res) => {
  const userId = req.session.userId;
  const bookingId = req.params.bookingId;

  if (!userId) return res.redirect('/login');

  try {
    // Check if booking exists and if user is the driver
    const [[booking]] = await db.query(`
      SELECT rb.*, ro.user_id as driver_id
      FROM RideBookings rb
      JOIN RideOffers ro ON rb.offer_id = ro.id
      WHERE rb.id = ? AND ro.user_id = ?
    `, [bookingId, userId]);

    if (!booking) {
      return res.status(404).send('Booking not found or you are not the driver.');
    }

    // Reject booking
    await db.query(
      'UPDATE RideBookings SET status = "rejected" WHERE id = ?',
      [bookingId]
    );

    res.redirect('/rides?success=booking_rejected');
  } catch (err) {
    console.error('Error rejecting booking:', err);
    res.status(500).send('Failed to reject booking.');
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

// GET /rides/offer — dedicated offer a ride page
router.get('/offer', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const [[user]] = await db.query('SELECT * FROM Users WHERE id = ?', [req.session.userId]);
  res.render('rides-offer', { session: req.session, user });
});

// GET /rides/request — dedicated request a pickup page
router.get('/request', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const [[user]] = await db.query('SELECT * FROM Users WHERE id = ?', [req.session.userId]);
  // Get children for the dropdown using ParentChild join
  const [children] = await db.query(`
    SELECT c.* FROM Children c
    JOIN ParentChild pc ON pc.child_id = c.id
    WHERE pc.parent_id = ?
  `, [req.session.userId]);
  res.render('rides-request', { session: req.session, user, children });
});

module.exports = router;
