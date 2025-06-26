// routes/admin.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const isAdmin = require('../middleware/isAdmin');
const bcrypt = require('bcrypt');

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
    const userId = req.params.id;
    const [[user]] = await db.query('SELECT is_blocked FROM Users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).send('User not found');
    }
    const newStatus = !user.is_blocked;
    await db.query('UPDATE Users SET is_blocked = ? WHERE id = ?', [newStatus, userId]);
    req.session.success = `✅ User has been ${newStatus ? 'blocked' : 'unblocked'} successfully.`;
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Block user error:', err);
    req.session.error = 'Failed to block/unblock user';
    res.redirect('/admin/dashboard');
  }
});

// Delete User
router.post('/users/:id/delete', async (req, res) => {
  try {
    const userId = req.params.id;
    const [[user]] = await db.query('SELECT * FROM Users WHERE id = ?', [userId]);
    if (!user) {
      req.session.error = 'User not found';
      return res.redirect('/admin/dashboard');
    }

    // Start transaction to ensure consistency
    await db.query('START TRANSACTION');

    // Check for and delete associated children
    const [childrenResult] = await db.query('SELECT id FROM Children WHERE user_id = ?', [userId]);
    if (childrenResult.length > 0) {
      const childIds = childrenResult.map(child => child.id);
      await db.query('DELETE FROM Children WHERE user_id = ?', [userId]);
      console.log(`Deleted ${childrenResult.length} children for user ID ${userId}: ${childIds.join(', ')}`);
    }

    // Delete the user
    const [userDeleteResult] = await db.query('DELETE FROM Users WHERE id = ?', [userId]);
    if (userDeleteResult.affectedRows === 0) {
      throw new Error('No user was deleted');
    }
    console.log(`Deleted user ID ${userId}: ${user.name}`);

    // Commit transaction
    await db.query('COMMIT');
    req.session.success = `✅ User '${user.name}' deleted successfully.`;
    res.redirect('/admin/dashboard');
  } catch (err) {
    // Rollback transaction on error
    await db.query('ROLLBACK');
    console.error('Delete user error:', err);
    req.session.error = `Failed to delete user: ${err.message || 'Unknown error'}`;
    res.redirect('/admin/dashboard');
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
  const userId = req.session.userId;
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

// Add User (GET)
router.get('/users/add', async (req, res) => {
  try {
    const [users] = await db.query('SELECT id, name, role FROM Users');
    res.render('admin/addUser', { session: req.session, users });
  } catch (err) {
    console.error('Load add user page error:', err);
    res.status(500).send('Could not load add user page');
  }
});

router.post('/users/add', async (req, res) => {
  const { name, email, password, role, parent_id, school } = req.body;
  console.log('Received data for /users/add:', req.body); // Debug
  if (!name || !email || !password || !role) {
    return res.status(400).send('All fields are required.');
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    let query = 'INSERT INTO Users (name, email, password_hash, role, created_at';
    let values = [name.trim(), email.trim(), hashedPassword, role];

    if (role === 'child' && parent_id) {
      // Validate parent exists and is a parent
      const [[parent]] = await db.query('SELECT role FROM Users WHERE id = ?', [parent_id]);
      if (!parent || parent.role !== 'parent') {
        return res.status(400).send('Selected parent is invalid.');
      }
      // Insert Children first to get childId with school from form
      const [childResult] = await db.query(
        'INSERT INTO Children (user_id, name, school, created_at) VALUES (?, ?, ?, NOW())',
        [parent_id, name.trim(), school || 'TBD'] // Use form school or fallback to TBD
      );
      const childId = childResult.insertId;
      console.log('Inserted into Children, childId:', childId, 'school:', school || 'TBD'); // Debug

      query += ', parent_id, child_profile_id';
      values.push(parseInt(parent_id), childId);
    }
    query += ') VALUES (?, ?, ?, ?, NOW()';
    if (role === 'child' && parent_id) query += ', ?, ?';
    query += ')';

    const [userResult] = await db.query(query, values);
    if (userResult.affectedRows === 0) {
      throw new Error('Failed to insert into Users table');
    }
    const newUserId = userResult.insertId;
    console.log('Inserted into Users, newUserId:', newUserId); // Debug

    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Add user error:', err);
    res.status(500).send('Could not add user: ' + err.message);
  }
});

// Add Child (GET)
router.get('/children/add', async (req, res) => {
  try {
    const [users] = await db.query('SELECT id, name, role FROM Users');
    res.render('admin/addChild', { session: req.session, users });
  } catch (err) {
    console.error('Load add child page error:', err);
    res.status(500).send('Could not load add child page');
  }
});

// Add Child (POST)
router.post('/children/add', async (req, res) => {
  const { name, school, club, user_id, child_username, child_password } = req.body;
  console.log('Received data for /children/add:', req.body); // Debug incoming data
  if (!name || !school || !user_id || !child_username || !child_password) {
    return res.status(400).send('Name, school, parent user ID, username, and password are required.');
  }

  try {
    // Verify the parent exists and is a parent
    const [[parent]] = await db.query('SELECT role FROM Users WHERE id = ?', [user_id]);
    if (!parent || parent.role !== 'parent') {
      return res.status(400).send('Selected parent is invalid.');
    }

    // Start transaction to ensure consistency
    await db.query('START TRANSACTION');

    // Insert into Children table with parent user_id and form-submitted school
    const [childResult] = await db.query(
      'INSERT INTO Children (user_id, name, school, club, created_at) VALUES (?, ?, ?, ?, NOW())',
      [user_id, name.trim(), school.trim(), club ? club.trim() : null]
    );
    const childId = childResult.insertId;
    console.log('Inserted into Children, childId:', childId, 'school:', school.trim()); // Debug child ID and school

    // Verify the Children insertion
    const [[newChild]] = await db.query('SELECT * FROM Children WHERE id = ?', [childId]);
    console.log('Verified Children entry:', newChild); // Debug verified entry

    // Hash the password and insert into Users table
    const hashedPassword = await bcrypt.hash(child_password, 10);
    const [userResult] = await db.query(
      'INSERT INTO Users (name, username, email, password_hash, role, parent_id, child_profile_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
      [name.trim(), child_username.trim(), `${child_username.trim()}@child.local`, hashedPassword, 'child', user_id, childId]
    );
    if (userResult.affectedRows === 0) {
      throw new Error('Failed to insert into Users table');
    }
    const newChildUserId = userResult.insertId;
    console.log('Inserted into Users, newChildUserId:', newChildUserId, 'child_profile_id set to:', childId); // Debug user ID and profile link

    // Verify the insertion
    const [[newUser]] = await db.query('SELECT * FROM Users WHERE id = ?', [newChildUserId]);
    console.log('Verified User entry:', newUser); // Debug verified entry

    // Commit transaction
    await db.query('COMMIT');
    console.log('Transaction committed successfully');

    req.session.success = `✅ Child '${name}' added successfully with login.`;
    res.redirect('/admin/dashboard');
  } catch (err) {
    // Rollback transaction on error
    await db.query('ROLLBACK');
    console.error('Add child error:', err);
    req.session.error = `Could not add child: ${err.message}`;
    res.redirect('/children/add'); // Fixed redirect to correct path
  }
});

module.exports = router;