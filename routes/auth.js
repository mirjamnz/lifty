// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db');

// GET /register (parents only)
router.get('/register', (req, res) => {
  res.render('register', { session: req.session });
});

// POST /register (parents only)
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).send('All fields are required.');
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query(
      `INSERT INTO Users (name, email, password_hash, role)
       VALUES (?, ?, ?, 'parent')`,
      [name.trim(), email.trim(), hashedPassword]
    );
    res.redirect('/login');
  } catch (err) {
    console.error('❌ Register Error:', err);
    res.status(500).render('register', { session: req.session });
  }
});

// GET /login
router.get('/login', (req, res) => {
  res.render('login', { error: null, session: req.session });
});

// POST /login
router.post('/login', async (req, res) => {
  const { emailOrUsername, password } = req.body;
  if (!emailOrUsername || !password) {
    return res.render('login', {
      error: 'Both fields are required.',
      session: req.session
    });
  }

  try {
    let [users] = await db.query('SELECT * FROM Users WHERE email = ?', [emailOrUsername]);

    if (users.length === 0) {
      // Try as username (stored in `name`)
      [users] = await db.query('SELECT * FROM Users WHERE name = ?', [emailOrUsername]);
    }

    const user = users[0];
    if (!user) {
      return res.render('login', {
        error: 'Invalid login credentials.',
        session: req.session
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.render('login', {
        error: 'Invalid login credentials.',
        session: req.session
      });
    }

    // ✅ Success: Set session
    req.session.userId = user.id;
    req.session.userName = user.name;
    req.session.role = user.role;

    if (user.role === 'child') {
      const [[child]] = await db.query(
        'SELECT * FROM Children WHERE id = ?',
        [user.child_profile_id]
      );
      req.session.child = child;
      return res.redirect('/child-dashboard');
    }

    // Regular parent user
    res.redirect('/dashboard');
  } catch (err) {
    console.error('❌ Login Error:', err);
    res.status(500).send('Login failed.');
  }
});

// GET /logout
router.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).send('Logout failed.');
    res.redirect('/login');
  });
});

module.exports = router;
