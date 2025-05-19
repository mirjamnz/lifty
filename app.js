// app.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'lifty_secret_key',
  resave: false,
  saveUninitialized: false
}));

// --- Routes ---
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const rideRequestRoutes = require('./routes/rideRequests');
const rideRoutes = require('./routes/rides');

app.use('/', authRoutes);              // for login, register, logout
app.use('/dashboard', dashboardRoutes);
app.use('/requests', rideRequestRoutes);
app.use('/rides', rideRoutes);

// --- Home (optional redirect) ---
app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

// --- Start Server ---
const PORT = 3033;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
