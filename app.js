const express = require('express');
const session = require('express-session');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config(); // ✅ Move dotenv early

const app = express(); // ✅ MUST come before any app.use(...)

const adminRoutes = require('./routes/admin');

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Disable EJS cache in development
if (process.env.NODE_ENV !== 'production') {
  app.set('view cache', false);
}

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Session middleware must be BEFORE routes
app.use(session({
  secret: process.env.SESSION_SECRET || 'lifty_secret_key',
  resave: false,
  saveUninitialized: false
}));

// ✅ Inject GMAPS API key into all EJS views
app.use((req, res, next) => {
  res.locals.GMAPS_API_KEY = process.env.GMAPS_API_KEY || '';
  next();
});

// === Move unreadCount middleware here, BEFORE all routes ===
app.use(async (req, res, next) => {
  if (req.session && req.session.userId) {
    try {
      const db = require('./db');
      
      // Count direct messages (recipient_id = userId AND read_at IS NULL)
      const [[{ directUnreadCount }]] = await db.query(
        'SELECT COUNT(*) AS directUnreadCount FROM Messages WHERE recipient_id = ? AND read_at IS NULL',
        [req.session.userId]
      );
      
      // Count group messages where user is part of the group
      // Find rides where user is child, parent, or driver
      const [groupRides] = await db.query(`
        SELECT DISTINCT rr.id as ride_id
        FROM RideRequests rr
        JOIN Children c ON rr.child_id = c.id
        JOIN Users childUser ON childUser.child_profile_id = c.id
        WHERE childUser.id = ? OR c.user_id = ? OR rr.assigned_user_id = ?
      `, [req.session.userId, req.session.userId, req.session.userId]);
      
      let groupUnreadCount = 0;
      if (groupRides.length > 0) {
        const rideIds = groupRides.map(r => r.ride_id);
        const [[{ count }]] = await db.query(
          'SELECT COUNT(*) as count FROM Messages WHERE related_type = "request" AND related_id IN (?) AND read_at IS NULL AND sender_id != ?',
          [rideIds, req.session.userId]
        );
        groupUnreadCount = count;
      }
      
      const totalUnreadCount = directUnreadCount + groupUnreadCount;
      res.locals.unreadCount = totalUnreadCount;
      console.log('DEBUG unreadCount for user', req.session.userId, ':', totalUnreadCount, '(direct:', directUnreadCount, 'group:', groupUnreadCount, ')'); // Debug line
    } catch (err) {
      res.locals.unreadCount = 0;
      console.log('DEBUG unreadCount error:', err);
    }
  } else {
    res.locals.unreadCount = 0;
    console.log('DEBUG unreadCount: not logged in');
  }
  next();
});

// ✅ Mount routes
app.use('/admin', adminRoutes); // ✅ now safe!

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const rideRequestRoutes = require('./routes/rideRequests');
const rideRoutes = require('./routes/rides');
const orgRoutes = require('./routes/organizations');
const childDashboardRoutes = require('./routes/childDashboard');
const messagesRouter = require('./routes/messages');
const recurringEventsRouter = require('./routes/recurringEvents');
const recurringEventGroupsRouter = require('./routes/recurringEventGroups');

app.use('/', authRoutes);
app.use('/', dashboardRoutes);
app.use('/requests', rideRequestRoutes);
app.use('/rides', rideRoutes);
app.use('/organizations', orgRoutes);
app.use('/', childDashboardRoutes);
app.use('/messages', messagesRouter);
app.use('/recurring-events', recurringEventsRouter);
app.use('/recurring-event-groups', recurringEventGroupsRouter);

const db = require('./db');

// Simple requireAuth middleware for root-level routes
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).send('Please log in to access this feature.');
  }
  next();
}

// POST /event-instances/:instanceId/assign-self-driver - Assign self as driver for an event instance (root-level)
app.post('/event-instances/:instanceId/assign-self-driver', requireAuth, async (req, res) => {
  const instanceId = req.params.instanceId;
  const userId = req.session.userId;
  // Accept assignmentType from body (default to 'both' for backward compatibility)
  const assignmentType = req.body.assignmentType || 'both'; // 'dropoff', 'pickup', or 'both'

  try {
    // Get the event instance and event ID
    const [[instance]] = await db.query(`
      SELECT ei.*, re.id as event_id
      FROM EventInstances ei
      JOIN RecurringEvents re ON ei.event_id = re.id
      WHERE ei.id = ?
    `, [instanceId]);

    if (!instance) {
      req.session.error = 'Event instance not found.';
      return res.redirect('/rides');
    }
    const eventId = instance.event_id;

    // Check if user is a parent group member for this event (allow both 'parent' and 'admin' roles)
    const [membership] = await db.query(`
      SELECT * FROM EventGroupMembers 
      WHERE event_id = ? AND user_id = ? AND role IN ('parent', 'admin') AND is_active = TRUE
    `, [eventId, userId]);
    if (membership.length === 0) {
      req.session.error = 'You must be a parent group member to assign yourself as driver.';
      return res.redirect('/rides');
    }

    // Assign self as driver (allow take over)
    await db.query(`
      UPDATE EventInstances 
      SET driver_id = ?, driver_assigned_at = NOW(), driver_assigned_by = ?
      WHERE id = ?
    `, [userId, userId, instanceId]);

    // Set can_drive = TRUE for this user in EventGroupMembers
    await db.query(`
      UPDATE EventGroupMembers SET can_drive = TRUE WHERE event_id = ? AND user_id = ?
    `, [eventId, userId]);

    // --- AUTO-ASSIGN DRIVER FOR ALL GROUP CHILDREN ---
    // Get all active children in the group for this event
    const [groupChildren] = await db.query(
      'SELECT child_id FROM EventGroupMembers WHERE event_id = ? AND child_id IS NOT NULL AND is_active = TRUE',
      [eventId]
    );
    // Determine which assignment types to create
    let typesToAssign = [];
    if (assignmentType === 'dropoff') typesToAssign = ['dropoff'];
    else if (assignmentType === 'pickup') typesToAssign = ['pickup'];
    else typesToAssign = ['dropoff', 'pickup'];

    for (const child of groupChildren) {
      for (const assignment_type of typesToAssign) {
        // Check if assignment already exists and is not cancelled
        const [[existingAssignment]] = await db.query(
          'SELECT id FROM EventAssignments WHERE event_id = ? AND event_date = ? AND child_id = ? AND assignment_type = ? AND is_cancelled = FALSE',
          [eventId, instance.event_date, child.child_id, assignment_type]
        );
        if (existingAssignment) {
          // Update the assignment to the new driver and set status to confirmed
          await db.query(
            'UPDATE EventAssignments SET user_id = ?, group_assignment = TRUE, status = "confirmed" WHERE id = ?',
            [userId, existingAssignment.id]
          );
        } else {
          // Create a new assignment with status confirmed
          await db.query(
            `INSERT INTO EventAssignments (event_id, event_date, user_id, child_id, assignment_type, group_assignment, status)
             VALUES (?, ?, ?, ?, ?, TRUE, "confirmed")`,
            [eventId, instance.event_date, userId, child.child_id, assignment_type]
          );
        }
      }
    }
    // --- END AUTO-ASSIGN ---

    // Get user name for message
    const [[user]] = await db.query('SELECT name FROM Users WHERE id = ?', [userId]);
    // Send group message about driver assignment
    await db.query(`
      INSERT INTO EventGroupMessages (event_id, sender_id, message, message_type)
      VALUES (?, ?, ?, 'assignment')
    `, [eventId, userId, `${user.name} has assigned themselves as driver for ${instance.event_date} (${typesToAssign.join(' & ')})`]);

    req.session.success = `You are now the driver for this event instance (${typesToAssign.join(' & ')}).`;
    return res.redirect('/rides');
  } catch (err) {
    console.error('Assign self as driver error:', err);
    req.session.error = 'Error assigning yourself as driver.';
    return res.redirect('/rides');
  }
});

// Home page
app.get('/', (req, res) => {
  if (req.session.userId) {
    res.redirect('/dashboard');
  } else {
    res.render('index', { session: req.session });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Start server
const PORT = process.env.PORT || 3033;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
