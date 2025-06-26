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

// Manage Block Status (GET)
router.get('/users/:id/manage-block', async (req, res) => {
  try {
    const [users] = await db.query('SELECT * FROM Users WHERE id = ?', [req.params.id]);
    if (!users || users.length === 0) {
      return res.status(404).send('User not found');
    }
    const user = users[0];
    res.render('admin/manageBlock', { user, session: req.session });
  } catch (err) {
    console.error('Load manage block error:', err);
    res.status(500).send('Could not load block management');
  }
});

// Manage Block Status (POST)
router.post('/users/:id/:action', async (req, res) => {
  const userId = req.params.id;
  const action = req.params.action; // 'block' or 'unblock'
  const newStatus = action === 'block';
  try {
    await db.query('START TRANSACTION');
    await db.query('UPDATE Users SET is_blocked = ? WHERE id = ?', [newStatus, userId]);
    await db.query('UPDATE Children SET is_blocked = ? WHERE user_id = ?', [newStatus, userId]);
    await db.query('COMMIT');
    req.session.success = `✅ User and associated children have been ${action}ed successfully.`;
    res.redirect('/admin/dashboard');
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Block/unblock error:', err);
    req.session.error = `Failed to ${action} user and children`;
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
    await db.query('START TRANSACTION');
    const [childrenResult] = await db.query('SELECT id FROM Children WHERE user_id = ?', [userId]);
    if (childrenResult.length > 0) {
      const childIds = childrenResult.map(child => child.id);
      await db.query('DELETE FROM Children WHERE user_id = ?', [userId]);
      console.log(`Deleted ${childrenResult.length} children for user ID ${userId}: ${childIds.join(', ')}`);
    }
    const [userDeleteResult] = await db.query('DELETE FROM Users WHERE id = ?', [userId]);
    if (userDeleteResult.affectedRows === 0) {
      throw new Error('No user was deleted');
    }
    console.log(`Deleted user ID ${userId}: ${user.name}`);
    await db.query('COMMIT');
    req.session.success = `✅ User '${user.name}' deleted successfully.`;
    res.redirect('/admin/dashboard');
  } catch (err) {
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
  if (!name || !email || !password || !role) {
    return res.status(400).send('All fields are required.');
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    let query = 'INSERT INTO Users (name, email, password_hash, role, created_at';
    let values = [name.trim(), email.trim(), hashedPassword, role];
    if (role === 'child' && parent_id) {
      const [[parent]] = await db.query('SELECT role FROM Users WHERE id = ?', [parent_id]);
      if (!parent || parent.role !== 'parent') {
        return res.status(400).send('Selected parent is invalid.');
      }
      const [childResult] = await db.query(
        'INSERT INTO Children (user_id, name, school, created_at) VALUES (?, ?, ?, NOW())',
        [parent_id, name.trim(), school || 'TBD']
      );
      const childId = childResult.insertId;
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
  if (!name || !school || !user_id || !child_username || !child_password) {
    return res.status(400).send('Name, school, parent user ID(s), username, and password are required.');
  }
  try {
    const parentIds = Array.isArray(user_id) ? user_id : [user_id];
    const validParents = [];
    for (const id of parentIds) {
      const [[parent]] = await db.query('SELECT role FROM Users WHERE id = ?', [id]);
      if (!parent || parent.role !== 'parent') {
        return res.status(400).send(`Selected parent with ID ${id} is invalid.`);
      }
      validParents.push(id);
    }
    await db.query('START TRANSACTION');
    const childEntries = [];
    for (const parentId of validParents) {
      const [childResult] = await db.query(
        'INSERT INTO Children (user_id, name, school, club, created_at) VALUES (?, ?, ?, ?, NOW())',
        [parentId, name.trim(), school.trim(), club ? club.trim() : null]
      );
      childEntries.push(childResult.insertId);
    }
    const childId = childEntries[0];
    const hashedPassword = await bcrypt.hash(child_password, 10);
    const [userResult] = await db.query(
      'INSERT INTO Users (name, username, email, password_hash, role, parent_id, child_profile_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
      [name.trim(), child_username.trim(), `${child_username.trim()}@child.local`, hashedPassword, 'child', validParents[0], childId]
    );
    if (userResult.affectedRows === 0) {
      throw new Error('Failed to insert into Users table');
    }
    await db.query('COMMIT');
    req.session.success = `✅ Child '${name}' added successfully with login for parent(s) ${validParents.join(', ')}.`;
    res.redirect('/admin/dashboard');
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Add child error:', err);
    req.session.error = `Could not add child: ${err.message}`;
    res.redirect('/admin/children/add');
  }
});

// Edit Child (GET)
router.get('/children/:id/edit', async (req, res) => {
  try {
    const [children] = await db.query('SELECT * FROM Children WHERE id = ?', [req.params.id]);
    if (!children || children.length === 0) {
      return res.status(404).send('Child not found');
    }
    const child = children[0];
    const [users] = await db.query('SELECT id, name FROM Users WHERE role = "parent"');
    res.render('admin/editChild', { child, users, session: req.session });
  } catch (err) {
    console.error('Load child error:', err);
    res.status(500).send('Could not load child for editing');
  }
});

// Edit Child (POST)
router.post('/children/:id/edit', async (req, res) => {
  const { name, school, club, user_id } = req.body;
  try {
    await db.query(
      'UPDATE Children SET name = ?, school = ?, club = ?, user_id = ? WHERE id = ?',
      [name.trim(), school.trim(), club ? club.trim() : null, user_id, req.params.id]
    );
    req.session.success = `✅ Child '${name}' updated successfully.`;
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Update child error:', err);
    req.session.error = `Failed to update child: ${err.message || 'Unknown error'}`;
    res.redirect('/admin/dashboard');
  }
});

// Delete Child
router.post('/children/:id/delete', async (req, res) => {
  try {
    const childId = req.params.id;
    await db.query('START TRANSACTION');
    
    // First, update or delete the associated user record
    const [userResult] = await db.query(
      'SELECT id FROM Users WHERE child_profile_id = ?',
      [childId]
    );
    if (userResult.length > 0) {
      const userId = userResult[0].id;
      await db.query('DELETE FROM Users WHERE id = ?', [userId]);
      console.log(`Deleted user with child_profile_id ${childId}: User ID ${userId}`);
    }

    // Then delete the child
    const [[child]] = await db.query('SELECT * FROM Children WHERE id = ?', [childId]);
    if (!child) {
      await db.query('ROLLBACK');
      req.session.error = 'Child not found';
      return res.redirect('/admin/dashboard');
    }
    await db.query('DELETE FROM Children WHERE id = ?', [childId]);
    await db.query('COMMIT');
    req.session.success = `✅ Child '${child.name}' deleted successfully.`;
    res.redirect('/admin/dashboard');
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Delete child error:', err);
    req.session.error = `Failed to delete child: ${err.message || 'Unknown error'}`;
    res.redirect('/admin/dashboard');
  }
});

// Manage Block Status (GET)
router.get('/users/:id/manage-block', async (req, res) => {
  try {
    const [users] = await db.query('SELECT * FROM Users WHERE id = ?', [req.params.id]);
    if (!users || users.length === 0) {
      return res.status(404).send('User not found');
    }
    const user = users[0];
    res.render('admin/manageBlock', { user, session: req.session });
  } catch (err) {
    console.error('Load manage block error:', err);
    res.status(500).send('Could not load block management');
  }
});

// Manage Block Status (POST)
router.post('/users/:id/:action', async (req, res) => {
  const userId = req.params.id;
  const action = req.params.action; // 'block' or 'unblock'
  const newStatus = action === 'block';
  try {
    await db.query('START TRANSACTION');
    await db.query('UPDATE Users SET is_blocked = ? WHERE id = ?', [newStatus, userId]);
    await db.query('UPDATE Children SET is_blocked = ? WHERE user_id = ?', [newStatus, userId]);
    await db.query('COMMIT');
    req.session.success = `✅ User and associated children have been ${action}ed successfully.`;
    res.redirect('/admin/dashboard');
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Block/unblock error:', err);
    req.session.error = `Failed to ${action} user and children`;
    res.redirect(`/admin/users/${userId}/manage-block`);
  }
});

module.exports = router;