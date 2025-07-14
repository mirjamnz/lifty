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
