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

// === ASSIGNMENT ROUTES (must be defined before other routes) ===
// Test route to check if routing is working
app.post('/test-assignment', (req, res) => {
  console.log('🔧 TEST ROUTE HIT');
  res.json({ message: 'Test route working' });
});

app.post('/event-instances/:instanceId/assign-self-driver', requireAuth, async (req, res) => {
  console.log('🔧 ASSIGNMENT DEBUG: ROUTE HIT - Starting assignment process');
  console.log('🔧 ASSIGNMENT DEBUG: Request URL:', req.url);
  console.log('🔧 ASSIGNMENT DEBUG: Request method:', req.method);
  console.log('🔧 ASSIGNMENT DEBUG: Request body:', req.body);
  console.log('🔧 ASSIGNMENT DEBUG: Request params:', req.params);
  const instanceId = req.params.instanceId;
  const userId = req.session.userId;
  // Accept assignmentType from body (default to 'both' for backward compatibility)
  const assignmentType = req.body.assignmentType || 'both'; // 'dropoff', 'pickup', or 'both'
  console.log('🔧 ASSIGNMENT DEBUG: instanceId:', instanceId, 'assignmentType:', assignmentType, 'userId:', userId);

  try {
    // Check if this is an ActivityGroup event (format: activity_group_X_YYYY-MM-DD)
    if (instanceId.startsWith('activity_group_')) {
      console.log('🔧 ASSIGNMENT DEBUG: Processing ActivityGroup assignment');
      const parts = instanceId.split('_');
      if (parts.length !== 4) {
        req.session.error = 'Invalid activity group event format.';
        return res.redirect('/dashboard');
      }
      
      const groupId = parseInt(parts[2]);
      const eventDate = parts[3];
      
      console.log('🔧 ASSIGNMENT DEBUG: GroupId:', groupId, 'EventDate:', eventDate);
      
      // Get the ActivityGroup details
      const [[group]] = await db.query(`
        SELECT * FROM ActivityGroups 
        WHERE id = ? AND is_active = TRUE AND has_schedule = TRUE
      `, [groupId]);
      
      if (!group) {
        req.session.error = 'Activity group not found or not scheduled.';
        return res.redirect('/dashboard');
      }
      
      console.log('🔧 ASSIGNMENT DEBUG: ActivityGroup found:', group);
      
      // Check if user is a member of this group
      const [membership] = await db.query(`
        SELECT * FROM ActivityGroupMembers 
        WHERE group_id = ? AND user_id = ? AND is_active = TRUE
      `, [groupId, userId]);
      
      if (membership.length === 0) {
        req.session.error = 'You are not a member of this activity group.';
        return res.redirect('/dashboard');
      }
      
      // Get user's children in this group (optional for ActivityGroups)
      const [userChildren] = await db.query(`
        SELECT DISTINCT c.id as child_id, c.name as child_name
        FROM ActivityGroupMembers agm
        JOIN Children c ON agm.child_id = c.id
        WHERE agm.group_id = ? AND agm.user_id = ? AND agm.is_active = TRUE
      `, [groupId, userId]);
      
      console.log('🔧 ASSIGNMENT DEBUG: User children found:', userChildren.length);
      
      // For ActivityGroups, allow parent-only assignments even without children
      if (userChildren.length === 0) {
        console.log('🔧 ASSIGNMENT DEBUG: No children assigned, but allowing parent-only assignment');
      }
      
      console.log('🔧 ASSIGNMENT DEBUG: User children in group:', userChildren);
      
      // Determine assignment types based on request
      const assignmentType = req.body.assignmentType || 'both';
      const typesToAssign = assignmentType === 'both' ? ['dropoff', 'pickup'] : [assignmentType];
      
      // Create assignments for each child and type
      if (userChildren.length > 0) {
        // If children are assigned to the group, create assignments for each child
        for (const child of userChildren) {
          for (const type of typesToAssign) {
            // Check if assignment already exists
            const [existingAssignment] = await db.query(`
              SELECT * FROM ActivityGroupAssignments 
              WHERE group_id = ? AND assignment_date = ? AND child_id = ? AND assignment_type = ?
            `, [groupId, eventDate, child.child_id, type]);
            
            if (existingAssignment.length === 0) {
              // Create new assignment
              await db.query(`
                INSERT INTO ActivityGroupAssignments 
                (group_id, assignment_date, user_id, child_id, assignment_type, status)
                VALUES (?, ?, ?, ?, ?, 'confirmed')
              `, [groupId, eventDate, userId, child.child_id, type]);
              console.log(`🔧 ASSIGNMENT DEBUG: Created ${type} assignment for child ${child.child_name}`);
            } else {
              console.log(`🔧 ASSIGNMENT DEBUG: ${type} assignment already exists for child ${child.child_name}`);
            }
          }
        }
      } else {
        // If no children assigned, create parent-only driver assignments
        console.log('🔧 ASSIGNMENT DEBUG: Creating parent-only driver assignments');
        for (const type of typesToAssign) {
          // Check if parent-only assignment already exists
          const [existingAssignment] = await db.query(`
            SELECT * FROM ActivityGroupAssignments 
            WHERE group_id = ? AND assignment_date = ? AND user_id = ? AND child_id IS NULL AND assignment_type = ?
          `, [groupId, eventDate, userId, type]);
          
          if (existingAssignment.length === 0) {
            // Create new parent-only assignment
            await db.query(`
              INSERT INTO ActivityGroupAssignments 
              (group_id, assignment_date, user_id, child_id, assignment_type, status)
              VALUES (?, ?, ?, NULL, ?, 'confirmed')
            `, [groupId, eventDate, userId, type]);
            console.log(`🔧 ASSIGNMENT DEBUG: Created parent-only ${type} assignment`);
          } else {
            console.log(`🔧 ASSIGNMENT DEBUG: Parent-only ${type} assignment already exists`);
          }
        }
      }
      
      // Get user name for message
      const [[user]] = await db.query('SELECT name FROM Users WHERE id = ?', [userId]);
      
      // Send group message about driver assignment
      const childNames = userChildren.length > 0 ? userChildren.map(c => c.child_name).join(', ') : 'None assigned yet';
      const message = userChildren.length > 0 
        ? `${user.name} has assigned themselves as driver for ${eventDate} (${typesToAssign.join(' & ')}) - Children: ${childNames}`
        : `${user.name} has assigned themselves as driver for ${eventDate} (${typesToAssign.join(' & ')}) - Ready to drive when children are assigned`;
      
      await db.query(`
        INSERT INTO ActivityGroupMessages (group_id, sender_id, message, message_type)
        VALUES (?, ?, ?, 'assignment')
      `, [groupId, userId, message]);
      
      console.log('🔧 ASSIGNMENT DEBUG: ActivityGroup assignment completed successfully');
      req.session.success = `You are now the driver for this activity group event (${typesToAssign.join(' & ')}).`;
      return res.redirect('/dashboard');
    }
    
    // Original logic for old EventInstances (legacy support)
    console.log('🔧 ASSIGNMENT DEBUG: Processing legacy EventInstance assignment');
    const [[instance]] = await db.query(`
      SELECT ei.*, re.id as event_id
      FROM EventInstances ei
      JOIN RecurringEvents re ON ei.event_id = re.id
      WHERE ei.id = ?
    `, [instanceId]);
    console.log('🔧 ASSIGNMENT DEBUG: Instance found:', instance);

    if (!instance) {
      console.log('🔧 ASSIGNMENT DEBUG: Instance not found');
      req.session.error = 'Event instance not found.';
      return res.redirect('/dashboard');
    }
    const eventId = instance.event_id;
    console.log('🔧 ASSIGNMENT DEBUG: Event ID:', eventId);

    // Check if user is a parent group member for this event (allow both 'parent' and 'admin' roles)
    console.log('🔧 ASSIGNMENT DEBUG: Checking membership for eventId:', eventId, 'userId:', userId);
    const [membership] = await db.query(`
      SELECT * FROM EventGroupMembers 
      WHERE event_id = ? AND user_id = ? AND role IN ('parent', 'admin') AND is_active = TRUE
    `, [eventId, userId]);
    console.log('🔧 ASSIGNMENT DEBUG: Membership found:', membership.length, 'records');
    if (membership.length === 0) {
      console.log('🔧 ASSIGNMENT DEBUG: No membership found - user not authorized');
      req.session.error = 'You must be a parent group member to assign yourself as driver.';
      return res.redirect('/dashboard');
    }

    // Assign self as driver (allow take over)
    console.log('🔧 ASSIGNMENT DEBUG: Updating EventInstances with driver_id:', userId);
    await db.query(`
      UPDATE EventInstances 
      SET driver_id = ?, driver_assigned_at = NOW(), driver_assigned_by = ?
      WHERE id = ?
    `, [userId, userId, instanceId]);

    // Set can_drive = TRUE for this user in EventGroupMembers
    console.log('🔧 ASSIGNMENT DEBUG: Setting can_drive = TRUE for user in EventGroupMembers');
    await db.query(`
      UPDATE EventGroupMembers SET can_drive = TRUE WHERE event_id = ? AND user_id = ?
    `, [eventId, userId]);

    // --- AUTO-ASSIGN DRIVER FOR ALL GROUP CHILDREN ---
    // Get all active children in the group for this event
    console.log('🔧 ASSIGNMENT DEBUG: Getting group children for eventId:', eventId);
    const [groupChildren] = await db.query(
      'SELECT child_id FROM EventGroupMembers WHERE event_id = ? AND child_id IS NOT NULL AND is_active = TRUE',
      [eventId]
    );
    console.log('🔧 ASSIGNMENT DEBUG: Found', groupChildren.length, 'children in group');
    // Determine which assignment types to create
    let typesToAssign = [];
    if (assignmentType === 'dropoff') typesToAssign = ['dropoff'];
    else if (assignmentType === 'pickup') typesToAssign = ['pickup'];
    else typesToAssign = ['dropoff', 'pickup'];
    console.log('🔧 ASSIGNMENT DEBUG: Types to assign:', typesToAssign);

    for (const child of groupChildren) {
      console.log('🔧 ASSIGNMENT DEBUG: Processing child:', child.child_id);
      for (const assignment_type of typesToAssign) {
        console.log('🔧 ASSIGNMENT DEBUG: Processing assignment type:', assignment_type);
                            // CANCEL ALL EXISTING ASSIGNMENTS FOR THIS TYPE
                    console.log('🔧 ASSIGNMENT DEBUG: Cancelling existing assignments for eventId:', eventId, 'date:', instance.event_date, 'type:', assignment_type);
                    await db.query(
                      'UPDATE EventAssignments SET is_cancelled = TRUE WHERE event_id = ? AND event_date = ? AND assignment_type = ? AND is_cancelled = FALSE',
                      [eventId, instance.event_date, assignment_type]
                    );
                    
                    // Check if assignment already exists for this child and type
                    console.log('🔧 ASSIGNMENT DEBUG: Checking for existing assignment for child:', child.child_id, 'type:', assignment_type);
                    const [[existingAssignment]] = await db.query(
                      'SELECT id FROM EventAssignments WHERE event_id = ? AND event_date = ? AND child_id = ? AND assignment_type = ?',
                      [eventId, instance.event_date, child.child_id, assignment_type]
                    );
                    
                    if (existingAssignment) {
                      // Update existing assignment
                      console.log('🔧 ASSIGNMENT DEBUG: Updating existing assignment for child:', child.child_id, 'type:', assignment_type);
                      await db.query(
                        `UPDATE EventAssignments 
                         SET user_id = ?, status = 'confirmed', is_cancelled = FALSE, updated_at = NOW()
                         WHERE id = ?`,
                        [userId, existingAssignment.id]
                      );
                    } else {
                      // Create a new assignment with status confirmed
                      console.log('🔧 ASSIGNMENT DEBUG: Creating new assignment for child:', child.child_id, 'type:', assignment_type);
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

    console.log('🔧 ASSIGNMENT DEBUG: Assignment completed successfully');
    req.session.success = `You are now the driver for this event instance (${typesToAssign.join(' & ')}).`;
    return res.redirect('/dashboard');
  } catch (err) {
    console.error('Assign self as driver error:', err);
    console.error('Error stack:', err.stack);
    req.session.error = 'Error assigning yourself as driver.';
    return res.redirect('/dashboard');
  }
});

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const rideRequestRoutes = require('./routes/rideRequests');
const rideRoutes = require('./routes/rides');
const orgRoutes = require('./routes/organizations');
const childDashboardRoutes = require('./routes/childDashboard');
const messagesRouter = require('./routes/messages');
const recurringEventsRouter = require('./routes/recurringEvents');
const recurringEventGroupsRouter = require('./routes/recurringEventGroups');
const trustedGroupsRouter = require('./routes/trustedGroups');
const shortNoticeRouter = require('./routes/shortNotice');
const groupsRouter = require('./routes/groups');
const notificationsRouter = require('./routes/notifications');

app.use('/', authRoutes);
app.use('/', dashboardRoutes);
app.use('/requests', rideRequestRoutes);
app.use('/rides', rideRoutes);
app.use('/organizations', orgRoutes);
app.use('/', childDashboardRoutes);
// app.use('/messages', messagesRouter);
app.use('/recurring-events', recurringEventsRouter);
// app.use('/recurring-event-groups', recurringEventGroupsRouter);
// app.use('/trusted-groups', trustedGroupsRouter);
// app.use('/short-notice', shortNoticeRouter);
app.use('/groups', groupsRouter);
app.use('/notifications', notificationsRouter);

const db = require('./db');

// Simple requireAuth middleware for root-level routes
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).send('Please log in to access this feature.');
  }
  next();
}



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
