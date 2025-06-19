// routes/dashboard.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');

// GET /dashboard
router.get('/dashboard', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.redirect('/login');

  try {
    const [[user]] = await db.query('SELECT * FROM Users WHERE id = ?', [userId]);
    const [children] = await db.query('SELECT * FROM Children WHERE user_id = ?', [userId]);
    const [neighbors] = await db.query(`
      SELECT id, name, home_lat, home_lng
      FROM Users
      WHERE home_lat IS NOT NULL AND id != ?
    `, [userId]);
    const [organizations] = await db.query(`
      SELECT id, name, type
      FROM Organizations
      ORDER BY name ASC
      LIMIT 50
    `);

    res.render('dashboard', {
      session: req.session,
      user,
      children,
      neighbors,
      organizations
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Error loading dashboard.');
  }
});

// POST /update-address
router.post('/update-address', async (req, res) => {
  const userId = req.session.userId;
  const { home_address, home_lat, home_lng } = req.body;

  if (!home_address || !home_lat || !home_lng) {
    return res.status(400).send('Missing address details');
  }

  try {
    await db.query(
      'UPDATE Users SET home_address = ?, home_lat = ?, home_lng = ? WHERE id = ?',
      [home_address, parseFloat(home_lat), parseFloat(home_lng), userId]
    );

    res.redirect('/dashboard');
  } catch (err) {
    console.error('Update address error:', err);
    res.status(500).send('Failed to update address.');
  }
});


// POST /add-child
router.post('/add-child', async (req, res) => {
  const parentId = req.session.userId;
  if (!parentId) return res.redirect('/login');

  const { name, school, club, child_username, child_password } = req.body;

  if (!name || !school) {
    req.session.error = "Name and school are required.";
    return res.redirect('/dashboard');
  }

  try {
    // 1. Insert child into Children table
    const [childResult] = await db.query(
      'INSERT INTO Children (user_id, name, school, club) VALUES (?, ?, ?, ?)',
      [parentId, name.trim(), school.trim(), club?.trim() || null]
    );

    const childId = childResult.insertId;

    // 2. Optional: Create child user account
    if (child_username && child_password) {
      const hashed = await bcrypt.hash(child_password, 10);

      try {
        await db.query(
          `INSERT INTO Users (name, username, email, password_hash, role, parent_id, child_profile_id)
           VALUES (?, ?, ?, ?, 'child', ?, ?)`,
          [
            child_username.trim(),
            child_username.trim(),
            `${child_username.trim()}@child.local`,
            hashed,
            parentId,
            childId
          ]
        );
      } catch (err) {
        console.error("❌ Failed to create child login account:", err.message);
        req.session.error = "Child profile added, but login creation failed. Try again.";
        return res.redirect('/dashboard');
      }
    }

    req.session.success = `✅ Child '${name}' added${child_username ? ' with login' : ''}.`;
    res.redirect('/dashboard');
  } catch (err) {
    console.error('❌ Add child error:', err.message, '\n', err.stack);
    req.session.error = "Something went wrong while adding the child.";
    res.redirect('/dashboard');
  }
});


// GET /delete-child/:id
router.get('/delete-child/:id', async (req, res) => {
  const userId = req.session.userId;
  const childId = req.params.id;

  if (!userId) return res.redirect('/login');

  try {
    await db.query(
      'DELETE FROM Children WHERE id = ? AND user_id = ?',
      [childId, userId]
    );
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Delete child error:', err);
    res.status(500).send('Failed to delete child.');
  }
});

// POST /add-organization
router.post('/add', async (req, res) => {
  const { name, type, address, lat, lng } = req.body;
  const userId = req.session.userId;

  if (!name || !type || !address || !userId) {
    return res.status(400).send('Missing required fields.');
  }

  const safeLat = lat && !isNaN(parseFloat(lat)) ? parseFloat(lat) : null;
  const safeLng = lng && !isNaN(parseFloat(lng)) ? parseFloat(lng) : null;

  try {
    await db.query(
      'INSERT INTO Organizations (name, type, address, lat, lng, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [name.trim(), type.trim(), address.trim(), safeLat, safeLng, userId]
    );

    req.session.success = '✅ Organization added!';
    return res.redirect('/dashboard');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      req.session.error = `❌ '${name}' already exists.`;
      return res.redirect('/organizations/add');
    }

    console.error('❌ Add Organization Error:', err.message, '\n', err.stack);
    res.status(500).send('Could not add organization.');
  }
});

module.exports = router;
