// routes/admin.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const isAdmin = require('../middleware/isAdmin');

router.use(isAdmin);

// Admin Dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const [organizations] = await db.query('SELECT * FROM Organizations ORDER BY name ASC');
    const [users] = await db.query('SELECT * FROM Users ORDER BY id DESC');
    const [children] = await db.query('SELECT * FROM Children');

    res.render('admin/dashboard', {
      organizations,
      users,
      children,
      session: req.session
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).send('Failed to load admin dashboard');
  }
});

// Block/Unblock User
router.post('/users/:id/block', async (req, res) => {
  try {
    const [[user]] = await db.query('SELECT is_blocked FROM Users WHERE id = ?', [req.params.id]);
    const newStatus = !user.is_blocked;
    await db.query('UPDATE Users SET is_blocked = ? WHERE id = ?', [newStatus, req.params.id]);
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Block user error:', err);
    res.status(500).send('Failed to block/unblock user');
  }
});

// Delete User
router.post('/users/:id/delete', async (req, res) => {
  try {
    await db.query('DELETE FROM Users WHERE id = ?', [req.params.id]);
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).send('Failed to delete user');
  }
});

// Edit Organization (GET)
router.get('/organizations/:id/edit', async (req, res) => {
  try {
    const [[org]] = await db.query('SELECT * FROM Organizations WHERE id = ?', [req.params.id]);
    res.render('admin/editOrg', { org, session: req.session });
  } catch (err) {
    console.error('Load org error:', err);
    res.status(500).send('Could not load organization for editing');
  }
});

// Edit Organization (POST)
router.post('/organizations/:id/edit', async (req, res) => {
  const { name, address, type } = req.body;
  try {
    await db.query(
      'UPDATE Organizations SET name = ?, address = ?, type = ? WHERE id = ?',
      [name.trim(), address.trim(), type.trim(), req.params.id]
    );
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Update org error:', err);
    res.status(500).send('Could not update organization: ' + err.message);
  }
});

// Add Organization (GET)
router.get('/organizations/add', (req, res) => {
  res.render('admin/addOrg', { session: req.session });
});

// Add Organization (POST)
router.post('/organizations/add', async (req, res) => {
  const { name, address, type } = req.body;
  const userId = req.session.userId; // Get the admin's userId from session
  if (!name || !type || !userId) {
    return res.status(400).send('Name, type, and admin session are required.');
  }
  try {
    await db.query(
      'INSERT INTO Organizations (name, type, address, created_by, created_at) VALUES (?, ?, ?, ?, NOW())',
      [name.trim(), type.trim(), address.trim() || null, userId]
    );
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Add org error:', err);
    res.status(500).send('Could not add organization: ' + err.message);
  }
});

module.exports = router;