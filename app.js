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
    res.redirect('/view-rides');
  } catch (err) {
    console.error(err);
    res.status(500).send('Login failed.');
  }
});

// --- View Rides ---
app.get('/view-rides', async (req, res) => {
  try {
    const [rides] = await db.query(`
      SELECT Rides.*, Users.name AS driver_name
      FROM Rides JOIN Users ON Rides.user_id = Users.id
    `);
    res.render('rides', { rides, session: req.session });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// --- Add Child ---
app.get('/add-child', (req, res) => {
  res.render('add-child', { session: req.session });
});

app.post('/add-child', async (req, res) => {
  const { user_id, name, school, club } = req.body;
  try {
    await db.query(
      'INSERT INTO Children (user_id, name, school, club) VALUES (?, ?, ?, ?)',
      [user_id, name, school, club || null]
    );
    res.redirect('/add-child');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// --- Users API ---
app.get('/users', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM Users');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Rides API ---
app.get('/rides', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT Rides.*, Users.name AS driver_name
      FROM Rides JOIN Users ON Rides.user_id = Users.id
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/rides', async (req, res) => {
  const { user_id, pickup_location, dropoff_location, pickup_time, seats_available } = req.body;
  if (!user_id || !pickup_location || !dropoff_location || !pickup_time || !seats_available) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO Rides (user_id, pickup_location, dropoff_location, pickup_time, seats_available)
       VALUES (?, ?, ?, ?, ?)`,
      [user_id, pickup_location, dropoff_location, pickup_time, seats_available]
    );
    res.status(201).json({ message: 'Ride added successfully', ride_id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Children API ---
app.get('/children', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT Children.*, Users.name AS parent_name
      FROM Children
      JOIN Users ON Children.user_id = Users.id
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/children', async (req, res) => {
  const { user_id, name, school, club } = req.body;
  if (!user_id || !name || !school) {
    return res.status(400).json({ error: 'user_id, name, and school are required.' });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO Children (user_id, name, school, club)
       VALUES (?, ?, ?, ?)`,
      [user_id, name, school, club || null]
    );
    res.status(201).json({ message: 'Child added successfully', child_id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Start Server ---
const PORT = 3033;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
