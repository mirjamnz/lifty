// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../db');

// GET /register (parents only)
router.get('/register', async (req, res) => {
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
      `INSERT INTO Users (name, email, password_hash, role, profile_completed)
       VALUES (?, ?, ?, 'parent', 0)`,
      [name.trim(), email.trim(), hashedPassword]
    );
    res.redirect('/login');
  } catch (err) {
    console.error('❌ Register Error:', err);
    res.status(500).render('register', { session: req.session });
  }
});

// GET /forgot-password
router.get('/forgot-password', (req, res) => {
  res.render('forgot-password', { 
    error: null, 
    success: null, 
    session: req.session 
  });
});

// POST /forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.render('forgot-password', {
      error: 'Email address is required.',
      success: null,
      session: req.session
    });
  }

  try {
    // Check if user exists
    const [[user]] = await db.query('SELECT id, name FROM Users WHERE email = ?', [email.trim()]);
    
    if (!user) {
      // Don't reveal if email exists or not for security
      return res.render('forgot-password', {
        error: null,
        success: 'If an account with that email exists, a password reset link has been sent.',
        session: req.session
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour from now

    // Store reset token in database
    await db.query(
      'UPDATE Users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?',
      [resetToken, resetTokenExpiry, user.id]
    );

    // In a real application, you would send an email here
    // For now, we'll just show the reset link (in production, remove this)
    const resetUrl = `${req.protocol}://${req.get('host')}/reset-password?token=${resetToken}`;
    
    console.log('Password reset link for development:', resetUrl);

    res.render('forgot-password', {
      error: null,
      success: `Password reset link sent! For development, here's the link: ${resetUrl}`,
      session: req.session
    });

  } catch (err) {
    console.error('❌ Forgot password error:', err);
    res.render('forgot-password', {
      error: 'An error occurred. Please try again.',
      success: null,
      session: req.session
    });
  }
});

// GET /reset-password
router.get('/reset-password', async (req, res) => {
  const { token } = req.query;
  
  if (!token) {
    return res.redirect('/forgot-password');
  }

  try {
    // Check if token is valid and not expired
    const [[user]] = await db.query(
      'SELECT id FROM Users WHERE reset_token = ? AND reset_token_expiry > NOW()',
      [token]
    );

    if (!user) {
      return res.render('forgot-password', {
        error: 'Invalid or expired reset token. Please request a new password reset.',
        success: null,
        session: req.session
      });
    }

    res.render('reset-password', {
      token,
      error: null,
      session: req.session
    });

  } catch (err) {
    console.error('❌ Reset password error:', err);
    res.render('forgot-password', {
      error: 'An error occurred. Please try again.',
      success: null,
      session: req.session
    });
  }
});

// POST /reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password, confirmPassword } = req.body;
  
  if (!token || !password || !confirmPassword) {
    return res.render('reset-password', {
      token,
      error: 'All fields are required.',
      session: req.session
    });
  }

  if (password !== confirmPassword) {
    return res.render('reset-password', {
      token,
      error: 'Passwords do not match.',
      session: req.session
    });
  }

  if (password.length < 6) {
    return res.render('reset-password', {
      token,
      error: 'Password must be at least 6 characters long.',
      session: req.session
    });
  }

  try {
    // Check if token is valid and not expired
    const [[user]] = await db.query(
      'SELECT id FROM Users WHERE reset_token = ? AND reset_token_expiry > NOW()',
      [token]
    );

    if (!user) {
      return res.render('forgot-password', {
        error: 'Invalid or expired reset token. Please request a new password reset.',
        success: null,
        session: req.session
      });
    }

    // Hash new password and update user
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query(
      'UPDATE Users SET password_hash = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?',
      [hashedPassword, user.id]
    );

    res.render('login', {
      error: null,
      success: 'Password has been reset successfully. You can now login with your new password.',
      session: req.session
    });

  } catch (err) {
    console.error('❌ Reset password error:', err);
    res.render('reset-password', {
      token,
      error: 'An error occurred. Please try again.',
      session: req.session
    });
  }
});

// GET /login
router.get('/login', (req, res) => {
  res.render('login', { error: null, success: null, session: req.session });
});

// POST /login
router.post('/login', async (req, res) => {
  const { emailOrUsername, password } = req.body;
  if (!emailOrUsername || !password) {
    return res.render('login', {
      error: 'Both fields are required.',
      success: null,
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
        success: null,
        session: req.session
      });
    }

    // Check if user is blocked
    if (user.is_blocked) {
      return res.render('login', {
        error: 'Your account has been blocked. Please contact an administrator.',
        success: null,
        session: req.session
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.render('login', {
        error: 'Invalid login credentials.',
        success: null,
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