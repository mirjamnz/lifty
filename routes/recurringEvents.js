const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /recurring-events - List all recurring events
router.get('/', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.redirect('/login');

  try {
    // Get all active events
    const [events] = await db.query(
      `SELECT re.*, u.name AS created_by_name,
              (SELECT COUNT(*) FROM EventSubscriptions WHERE event_id = re.id) AS subscriber_count
       FROM RecurringEvents re
       JOIN Users u ON re.created_by = u.id
       WHERE re.is_active = TRUE
       ORDER BY re.day_of_week, re.start_time`
    );

    // Get user's children
    const [children] = await db.query(
      'SELECT * FROM Children WHERE user_id = ?',
      [userId]
    );

    // Get user's subscriptions
    const [subscriptions] = await db.query(
      `SELECT es.*, re.name AS event_name, c.name AS child_name
       FROM EventSubscriptions es
       JOIN RecurringEvents re ON es.event_id = re.id
       JOIN Children c ON es.child_id = c.id
       WHERE es.user_id = ?`,
      [userId]
    );

    res.render('recurring-events', {
      session: req.session,
      events,
      children,
      subscriptions,
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    console.error('GET /recurring-events error:', err);
    res.status(500).send('Failed to load recurring events.');
  }
});

// GET /recurring-events/create - Show create event form
router.get('/create', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.redirect('/login');

  res.render('create-recurring-event', { session: req.session });
});

// POST /recurring-events/create - Create new recurring event
router.post('/create', async (req, res) => {
  const userId = req.session.userId;
  const { name, description, day_of_week, start_time, end_time, location, activity_type } = req.body;

  if (!userId || !name || !day_of_week || !start_time || !end_time || !location || !activity_type) {
    return res.status(400).send('All fields are required.');
  }

  try {
    await db.query(
      `INSERT INTO RecurringEvents (name, description, day_of_week, start_time, end_time, location, activity_type, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, description, day_of_week, start_time, end_time, location, activity_type, userId]
    );

    res.redirect('/recurring-events?success=Event created successfully');
  } catch (err) {
    console.error('POST /recurring-events/create error:', err);
    res.status(500).send('Failed to create event.');
  }
});

// POST /recurring-events/:id/subscribe - Subscribe to an event
router.post('/:id/subscribe', async (req, res) => {
  const userId = req.session.userId;
  const eventId = req.params.id;
  const { child_id } = req.body;

  if (!userId || !child_id) {
    return res.status(400).send('Missing required fields.');
  }

  try {
    // Check if already subscribed
    const [[existing]] = await db.query(
      'SELECT id FROM EventSubscriptions WHERE event_id = ? AND user_id = ? AND child_id = ?',
      [eventId, userId, child_id]
    );

    if (existing) {
      return res.redirect('/recurring-events?error=Already subscribed to this event');
    }

    await db.query(
      'INSERT INTO EventSubscriptions (event_id, user_id, child_id) VALUES (?, ?, ?)',
      [eventId, userId, child_id]
    );

    res.redirect('/recurring-events?success=Subscribed to event successfully');
  } catch (err) {
    console.error('POST /recurring-events/:id/subscribe error:', err);
    res.status(500).send('Failed to subscribe to event.');
  }
});

// POST /recurring-events/:id/unsubscribe - Unsubscribe from an event
router.post('/:id/unsubscribe', async (req, res) => {
  const userId = req.session.userId;
  const eventId = req.params.id;
  const { child_id } = req.body;

  if (!userId || !child_id) {
    return res.status(400).send('Missing required fields.');
  }

  try {
    await db.query(
      'DELETE FROM EventSubscriptions WHERE event_id = ? AND user_id = ? AND child_id = ?',
      [eventId, userId, child_id]
    );

    res.redirect('/recurring-events?success=Unsubscribed from event successfully');
  } catch (err) {
    console.error('POST /recurring-events/:id/unsubscribe error:', err);
    res.status(500).send('Failed to unsubscribe from event.');
  }
});

// GET /recurring-events/:id/assignments - View event assignments
router.get('/:id/assignments', async (req, res) => {
  const userId = req.session.userId;
  const eventId = req.params.id;

  if (!userId) return res.redirect('/login');

  try {
    // Get event details
    const [[event]] = await db.query(
      `SELECT re.*, u.name AS created_by_name
       FROM RecurringEvents re
       JOIN Users u ON re.created_by = u.id
       WHERE re.id = ?`,
      [eventId]
    );

    if (!event) {
      return res.status(404).send('Event not found.');
    }

    // Get subscribers
    const [subscribers] = await db.query(
      `SELECT es.*, u.name AS parent_name, c.name AS child_name
       FROM EventSubscriptions es
       JOIN Users u ON es.user_id = u.id
       JOIN Children c ON es.child_id = c.id
       WHERE es.event_id = ?`,
      [eventId]
    );

    // Get upcoming assignments (next 4 weeks)
    const [assignments] = await db.query(
      `SELECT ea.*, u.name AS assigned_parent_name, c.name AS child_name
       FROM EventAssignments ea
       JOIN Users u ON ea.user_id = u.id
       JOIN Children c ON ea.child_id = c.id
       WHERE ea.event_id = ? AND ea.event_date >= CURDATE()
       ORDER BY ea.event_date, ea.assignment_type`,
      [eventId]
    );

    res.render('event-assignments', {
      session: req.session,
      event,
      subscribers,
      assignments,
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    console.error('GET /recurring-events/:id/assignments error:', err);
    res.status(500).send('Failed to load event assignments.');
  }
});

// POST /recurring-events/:id/assign - Assign drop-off/pickup
router.post('/:id/assign', async (req, res) => {
  const userId = req.session.userId;
  const eventId = req.params.id;
  let { event_date, child_id, assignment_type, notes } = req.body;

  if (!userId || !event_date || !child_id || !assignment_type) {
    return res.status(400).send('Missing required fields.');
  }

  // Support multiple children
  if (!Array.isArray(child_id)) {
    child_id = [child_id];
  }

  try {
    let created = 0, skipped = 0;
    for (const cid of child_id) {
      // Check if assignment already exists
      const [[existing]] = await db.query(
        'SELECT id FROM EventAssignments WHERE event_id = ? AND event_date = ? AND child_id = ? AND assignment_type = ?',
        [eventId, event_date, cid, assignment_type]
      );
      if (existing) {
        skipped++;
        continue;
      }
      await db.query(
        `INSERT INTO EventAssignments (event_id, event_date, user_id, child_id, assignment_type, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [eventId, event_date, userId, cid, assignment_type, notes]
      );
      created++;
    }
    let msg = `${created} assignment(s) created.`;
    if (skipped) msg += ` ${skipped} already existed.`;
    res.redirect(`/recurring-events/${eventId}/assignments?success=${encodeURIComponent(msg)}`);
  } catch (err) {
    console.error('POST /recurring-events/:id/assign error:', err);
    res.status(500).send('Failed to create assignment.');
  }
});

// POST /recurring-events/:id/message - Send message to event subscribers
router.post('/:id/message', async (req, res) => {
  const userId = req.session.userId;
  const eventId = req.params.id;
  const { message, recipient_id } = req.body;

  if (!userId || !message || !recipient_id) {
    return res.status(400).send('Missing required fields.');
  }

  try {
    await db.query(
      `INSERT INTO EventMessages (event_id, sender_id, recipient_id, message)
       VALUES (?, ?, ?, ?)`,
      [eventId, userId, recipient_id, message]
    );

    res.redirect(`/recurring-events/${eventId}/assignments?success=Message sent successfully`);
  } catch (err) {
    console.error('POST /recurring-events/:id/message error:', err);
    res.status(500).send('Failed to send message.');
  }
});

module.exports = router; 