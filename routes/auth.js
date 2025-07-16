// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db');

// GET /register (parents only)
router.get('/register', async (req, res) => {
  try {
    const [organizations] = await db.query('SELECT * FROM Organizations ORDER BY name ASC');
    res.render('register', { session: req.session, organizations });
  } catch (err) {
    console.error('❌ Error loading organizations for register:', err);
    res.render('register', { session: req.session, organizations: [] });
  }
});

// POST /register (parents only)
router.post('/register', async (req, res) => {
  const { name, email, password, organization_id } = req.body;
  if (!name || !email || !password || !organization_id) {
    return res.status(400).send('All fields are required.');
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const [userResult] = await db.query(
      `INSERT INTO Users (name, email, password_hash, role, profile_completed)
       VALUES (?, ?, ?, 'parent', 0)`,
      [name.trim(), email.trim(), hashedPassword]
    );
    const userId = userResult.insertId;
    // Insert affiliation
    await db.query(
      'INSERT INTO UserAffiliations (user_id, organization_id, role, created_at) VALUES (?, ?, ?, NOW())',
      [userId, organization_id, 'parent']
    );
    res.redirect('/login');
  } catch (err) {
    console.error('❌ Register Error:', err);
    // Always pass organizations to the view on error
    let organizations = [];
    try {
      [organizations] = await db.query('SELECT * FROM Organizations ORDER BY name ASC');
    } catch (e) {
      console.error('❌ Error loading organizations for register (in error handler):', e);
    }
    res.status(500).render('register', { session: req.session, organizations });
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
    // First, try to find user by email
    let [users] = await db.query('SELECT * FROM Users WHERE email = ?', [emailOrUsername]);

    // If not found, try username (stored in name column)
    if (users.length === 0) {
      [users] = await db.query('SELECT * FROM Users WHERE name = ?', [emailOrUsername]);
    }

    const user = users[0];
    if (!user) {
      return res.render('login', {
        error: 'Invalid login credentials.',
        session: req.session
      });
    }

    // Check if user is blocked
    if (user.is_blocked) {
      return res.render('login', {
        error: 'Your account has been blocked. Please contact an administrator.',
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

    // ✅ Set session values
    req.session.userId = user.id;
    req.session.userName = user.name;
    req.session.role = user.role;
    req.session.is_admin = user.is_admin === 1;

    // Child user
    if (user.role === 'child') {
      const [[child]] = await db.query(
        'SELECT * FROM Children WHERE id = ?',
        [user.child_profile_id]
      );
      req.session.child = child;
      return res.redirect('/child-dashboard');
    }

    // Admin user
    if (user.is_admin) {
      return res.redirect('/admin/dashboard');
    }

    // Default: parent or regular user
    return res.redirect('/dashboard');
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