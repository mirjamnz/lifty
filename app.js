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
      const [[{ unreadCount }]] = await db.query(
        'SELECT COUNT(*) AS unreadCount FROM Messages WHERE recipient_id = ? AND read_at IS NULL',
        [req.session.userId]
      );
      res.locals.unreadCount = unreadCount;
      console.log('DEBUG unreadCount for user', req.session.userId, ':', unreadCount); // Debug line
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

app.use('/', authRoutes);
app.use('/', dashboardRoutes);
app.use('/requests', rideRequestRoutes);
app.use('/rides', rideRoutes);
app.use('/organizations', orgRoutes);
app.use('/', childDashboardRoutes);
app.use('/messages', messagesRouter);
app.use('/recurring-events', recurringEventsRouter);

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
