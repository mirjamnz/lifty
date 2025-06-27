// routes/rides.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /rides > Load ride requests by the user
router.get('/', async (req, res) => {
  const userId = req.session.userId;
  const { filter = 'all', expired = 'true' } = req.query;

  if (!userId) return res.redirect('/login');

  try {
    const [children] = await db.query('SELECT * FROM Children WHERE user_id = ?', [userId]);

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

    // Get bookings made by current user
    const [myBookings] = await db.query(`
      SELECT rb.*, ro.school, ro.pickup_time, u.name AS driver_name
      FROM RideBookings rb
      JOIN RideOffers ro ON rb.offer_id = ro.id
      JOIN Users u ON ro.user_id = u.id
      WHERE rb.user_id = ? AND rb.status = 'confirmed'
      ORDER BY ro.pickup_time DESC
    `, [userId]);

    res.render('rides', {
      session: req.session,
      children,
      rideOffers,
      requests,
      userBookings,
      myBookings,
      filter,
      expired,
      success: req.query.success
    });
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

module.exports = router;
