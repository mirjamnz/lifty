require('dotenv').config();
const express = require('express');
const db = require('./db');
const bcrypt = require('bcrypt');
const session = require('express-session');

const app = express();

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', './views');

// --- Session ---
app.use(session({
  secret: process.env.SESSION_SECRET || 'lifty_secret_key',
  resave: false,
  saveUninitialized: false
}));

// --- Logout ---
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).send('Could not log out. Please try again.');
    }
    res.redirect('/login');
  });
});

// --- Home ---
app.get('/', (req, res) => {
  res.render('index', { session: req.session });
});

// --- Dashboard ---
    // Add this inside your app.js

app.get('/dashboard', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.redirect('/login');

  try {
    // Fetch children for this user
    const [children] = await db.query('SELECT * FROM Children WHERE user_id = ?', [userId]);

    // Fetch general ride listings
    const [rides] = await db.query(`
      SELECT Rides.*, Users.name AS driver_name
      FROM Rides JOIN Users ON Rides.user_id = Users.id
    `);

    // Fetch currently available ride offers (from any user)
    const [rideOffers] = await db.query(`
      SELECT RideOffers.*, Users.name AS driver_name
      FROM RideOffers
      JOIN Users ON RideOffers.user_id = Users.id
      ORDER BY pickup_time ASC
    `);

    // Fetch this user's offers and requests for context (optional)
    const [offers] = await db.query(`SELECT * FROM RideOffers WHERE user_id = ?`, [userId]);
    const [requests] = await db.query(`
  SELECT RideRequests.*, Users.name AS user_name
  FROM RideRequests
  JOIN Users ON RideRequests.user_id = Users.id
  ORDER BY RideRequests.created_at DESC
`);
    

    // Render the dashboard view
    res.render('dashboard', {
      session: req.session,
      children,
      rides,
      rideOffers,
      offers,
      requests
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Error loading dashboard.');
  }
});


// --- Ride Offer ---
app.post('/offer-ride', async (req, res) => {
  const user_id = req.session.userId;
  const { school, available_seats, pickup_time, notes } = req.body;

  if (!user_id || !school || !available_seats || !pickup_time) {
    return res.status(400).send('School, pickup time, and available seats are required.');
  }

  try {
    await db.query(
      `INSERT INTO RideOffers (user_id, school, available_seats, pickup_time, notes)
       VALUES (?, ?, ?, ?, ?)`,
      [user_id, school, available_seats, pickup_time, notes || null]
    );
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Offer Ride Error:', err);
    res.status(500).send('Error offering ride.');
  }
});

// --- Ride Request ---
app.post('/request-ride', async (req, res) => {
  const userId = req.session.userId;
  const { pickup_location, dropoff_location, pickup_time, child_id, note } = req.body;

  if (!pickup_location || !pickup_time || !child_id) {
    return res.status(400).send('Pickup location, time, and child are required.');
  }

  try {
    await db.query(`
      INSERT INTO RideRequests (user_id, pickup_location, dropoff_location, pickup_time, child_id, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [userId, pickup_location, dropoff_location || null, pickup_time, child_id, note || null]);

    res.redirect('/dashboard');
  } catch (err) {
    console.error('Request ride error:', err);
    res.status(500).send('Could not request ride.');
  }
});


app.get('/view-rides', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.redirect('/login');

  try {
    const [children] = await db.query('SELECT * FROM Children WHERE user_id = ?', [userId]);

    const [rideOffers] = await db.query(`
      SELECT RideOffers.*, Users.name AS driver_name
      FROM RideOffers
      JOIN Users ON RideOffers.user_id = Users.id
      ORDER BY pickup_time ASC
    `);

    res.render('rides', {
      session: req.session,
      children,
      rideOffers
    });
  } catch (err) {
    console.error('View Rides Error:', err);
    res.status(500).send('Failed to load rides.');
  }
});

// --- Register ---
app.get('/register', (req, res) => {
  res.render('register', { session: req.session });
});

app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).send('All fields are required.');
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query(
      'INSERT INTO Users (name, email, password_hash) VALUES (?, ?, ?)',
      [name, email, hashedPassword]
    );
    res.redirect('/login');
  } catch (err) {
    console.error(err);
    res.status(500).render('register', { session: req.session });
  }
});

// --- Login ---
app.get('/login', (req, res) => {
  res.render('login', { error: null, session: req.session });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.render('login', { error: 'Both fields are required.', session: req.session });
  }

  try {
    const [users] = await db.query('SELECT * FROM Users WHERE email = ?', [email]);
    const user = users[0];

    if (!user) {
      return res.render('login', { error: 'Invalid email or password.', session: req.session });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.render('login', { error: 'Invalid email or password.', session: req.session });
    }

    req.session.userId = user.id;
    req.session.userName = user.name;
    res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send('Login failed.');
  }
});

// --- Start Server ---
const PORT = 3033;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
