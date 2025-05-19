// --- routes/auth.js ---
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db');

router.get('/register', (req, res) => {
  res.render('register', { session: req.session });
});

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).send('All fields are required.');
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query('INSERT INTO Users (name, email, password_hash) VALUES (?, ?, ?)', [name, email, hashedPassword]);
    res.redirect('/login');
  } catch (err) {
    console.error('Register Error:', err);
    res.status(500).render('register', { session: req.session });
  }
});

router.get('/login', (req, res) => {
  res.render('login', { error: null, session: req.session });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.render('login', { error: 'Both fields are required.', session: req.session });
  try {
    const [users] = await db.query('SELECT * FROM Users WHERE email = ?', [email]);
    const user = users[0];
    if (!user) return res.render('login', { error: 'Invalid email or password.', session: req.session });
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) return res.render('login', { error: 'Invalid email or password.', session: req.session });
    req.session.userId = user.id;
    req.session.userName = user.name;
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).send('Login failed.');
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).send('Logout failed.');
    res.redirect('/login');
  });
});

module.exports = router;
