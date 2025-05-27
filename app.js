// -------------------------------
// ✅ app.js: Express setup
// -------------------------------
const express = require('express');
const session = require('express-session');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

// Require routes
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const rideRequestRoutes = require('./routes/rideRequests');
const rideRoutes = require('./routes/rides');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use((req, res, next) => {
  res.locals.GMAPS_API_KEY = process.env.GMAPS_API_KEY;
  next();
});


// Sessions
app.use(session({
  secret: process.env.SESSION_SECRET || 'lifty_secret_key',
  resave: false,
  saveUninitialized: false
}));

// Route mounting
app.use('/', authRoutes);             // /login, /register, /logout
app.use('/', dashboardRoutes);        // /dashboard, /add-child, etc.
app.use('/requests', rideRequestRoutes);
app.use('/rides', rideRoutes);

// Home redirects to dashboard
app.get('/', (req, res) => {
  if (req.session.userId) {
    res.redirect('/dashboard');
  } else {
    res.render('index', { session: req.session });
  }
});


// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Server
const PORT = 3033;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
