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
    // Get current user data (for home address display)
    const [[user]] = await db.query(
      'SELECT id, name, email, home_address, home_lat, home_lng FROM Users WHERE id = ?',
      [userId]
    );

    // Get user's children using ParentChild join
    const [children] = await db.query(`
      SELECT c.* FROM Children c
      JOIN ParentChild pc ON pc.child_id = c.id
      WHERE pc.parent_id = ?
    `, [userId]);

    // Get all parents for each child
    for (let child of children) {
      const [parents] = await db.query(`
        SELECT u.id, u.name, u.email FROM Users u
        JOIN ParentChild pc ON pc.parent_id = u.id
        WHERE pc.child_id = ?
      `, [child.id]);
      child.parents = parents;
    }

    // Get other users with locations (for map display)
    const [neighbors] = await db.query(`
      SELECT id, name, home_address, home_lat, home_lng 
      FROM Users 
      WHERE id != ? AND home_lat IS NOT NULL AND home_lng IS NOT NULL AND home_address IS NOT NULL
      ORDER BY name
    `, [userId]);

    // Get group invitations for this user
    const [groupInvitations] = await db.query(`
      SELECT egi.*, re.name AS event_name, re.day_of_week, re.start_time, re.end_time, re.location, u.name AS inviter_name
      FROM EventGroupInvitations egi
      JOIN RecurringEvents re ON egi.event_id = re.id
      JOIN Users u ON egi.inviter_id = u.id
      WHERE egi.invitee_email = (SELECT email FROM Users WHERE id = ?) AND egi.status = 'pending'
      ORDER BY egi.invited_at DESC
    `, [userId]);

    res.render('dashboard', {
      session: req.session,
      user,
      children,
      neighbors,
      groupInvitations,
      success: req.session.success,
      error: req.session.error
    });

    // Clear session messages
    delete req.session.success;
    delete req.session.error;
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Failed to load dashboard.');
  }
});

// POST /update-address
router.post('/update-address', async (req, res) => {
  const userId = req.session.userId;
  const { home_address, home_lat, home_lng } = req.body;

  console.log('Update address request:', { home_address, home_lat, home_lng });

  if (!home_address) {
    req.session.error = "Home address is required.";
    return res.redirect('/dashboard');
  }

  // If coordinates are missing, try to geocode the address
  let lat = home_lat;
  let lng = home_lng;

  if (!lat || !lng) {
    req.session.error = "Please select an address from the dropdown suggestions to get coordinates.";
    return res.redirect('/dashboard');
  }

  try {
    await db.query(
      'UPDATE Users SET home_address = ?, home_lat = ?, home_lng = ? WHERE id = ?',
      [home_address, parseFloat(lat), parseFloat(lng), userId]
    );

    req.session.success = "✅ Home address updated successfully!";
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Update address error:', err);
    req.session.error = "Failed to update address. Please try again.";
    res.redirect('/dashboard');
  }
});

// POST /add-child
router.post('/add-child', async (req, res) => {
  const parentId = req.session.userId;
  if (!parentId) return res.redirect('/login');

  const { name, school, club, child_username, child_password, invite_email_or_username } = req.body;

  if (!name || !school) {
    req.session.error = "Name and school are required.";
    return res.redirect('/dashboard');
  }

  try {
    const [childResult] = await db.query(
      'INSERT INTO Children (user_id, name, school, club) VALUES (?, ?, ?, ?)',
      [parentId, name.trim(), school.trim(), club?.trim() || null]
    );

    const childId = childResult.insertId;

    await db.query(
      'INSERT INTO ParentChild (parent_id, child_id) VALUES (?, ?)',
      [parentId, childId]
    );

    // Handle invite/link for another parent/caregiver
    if (invite_email_or_username) {
      const [[otherParent]] = await db.query(
        'SELECT id FROM Users WHERE email = ? OR username = ?',
        [invite_email_or_username, invite_email_or_username]
      );
      if (otherParent) {
        await db.query(
          'INSERT IGNORE INTO ParentChild (parent_id, child_id) VALUES (?, ?)',
          [otherParent.id, childId]
        );
        // Optionally: send notification/invite email here
      } else {
        // Optionally: create a new user and link, or show error
        // For now, just ignore if not found
      }
    }

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

// POST /edit-child/:id
router.post('/edit-child/:id', async (req, res) => {
  const parentId = req.session.userId;
  const childId = req.params.id;
  const { name, school, club, invite_email_or_username } = req.body;

  if (!parentId || !childId || !name || !school) {
    return res.status(400).send('Parent ID, child ID, name, and school are required.');
  }

  try {
    // Verify the child belongs to the parent
    const [[child]] = await db.query(
      'SELECT * FROM Children WHERE id = ? AND user_id = ?',
      [childId, parentId]
    );
    if (!child) {
      return res.status(403).send('Unauthorized or child not found.');
    }

    await db.query(
      'UPDATE Children SET name = ?, school = ?, club = ? WHERE id = ?',
      [name.trim(), school.trim(), club?.trim() || null, childId]
    );

    // Handle invite/link for another parent/caregiver
    if (invite_email_or_username) {
      const [[otherParent]] = await db.query(
        'SELECT id FROM Users WHERE email = ? OR username = ?',
        [invite_email_or_username, invite_email_or_username]
      );
      if (otherParent) {
        await db.query(
          'INSERT IGNORE INTO ParentChild (parent_id, child_id) VALUES (?, ?)',
          [otherParent.id, childId]
        );
        // Optionally: send notification/invite email here
      } else {
        // Optionally: create a new user and link, or show error
        // For now, just ignore if not found
      }
    }

    // Update the associated User record if it exists
    const [[user]] = await db.query(
      'SELECT * FROM Users WHERE child_profile_id = ?',
      [childId]
    );
    if (user) {
      await db.query(
        'UPDATE Users SET name = ? WHERE child_profile_id = ?',
        [name.trim(), childId]
      );
    }

    req.session.success = `✅ Child '${name}' updated successfully.`;
    res.redirect('/dashboard');
  } catch (err) {
    console.error('❌ Edit child error:', err.message, '\n', err.stack);
    req.session.error = "Something went wrong while editing the child.";
    res.redirect('/dashboard');
  }
});

// GET /delete-child/:id
router.get('/delete-child/:id', async (req, res) => {
  const userId = req.session.userId;
  const childId = req.params.id;

  if (!userId) return res.redirect('/login');

  try {
    // Remove parent-child link
    await db.query('DELETE FROM ParentChild WHERE child_id = ? AND parent_id = ?', [childId, userId]);
    const [[linkCount]] = await db.query('SELECT COUNT(*) as cnt FROM ParentChild WHERE child_id = ?', [childId]);
    if (linkCount.cnt === 0) {
      // Delete any user accounts linked to this child
      await db.query('DELETE FROM Users WHERE child_profile_id = ?', [childId]);
      // Now delete the child
      await db.query('DELETE FROM Children WHERE id = ?', [childId]);
    }
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Delete child error:', err);
    res.status(500).send('Failed to delete child.');
  }
});

// POST /children/:id/invite-parent
router.post('/children/:id/invite-parent', async (req, res) => {
  const parentId = req.session.userId;
  const childId = req.params.id;
  const { invite_email_or_username } = req.body;

  if (!parentId || !childId || !invite_email_or_username) {
    req.session.error = "All fields are required.";
    return res.redirect('/dashboard');
  }

  try {
    // Allow lookup by email, username, or name (unique name enforcement can be added later)
    const [[otherParent]] = await db.query(
      'SELECT id, name, email, username FROM Users WHERE email = ? OR username = ? OR name = ?',
      [invite_email_or_username, invite_email_or_username, invite_email_or_username]
    );
    console.log('Invite lookup:', invite_email_or_username, otherParent);
    if (otherParent) {
      await db.query(
        'INSERT IGNORE INTO ParentChild (parent_id, child_id) VALUES (?, ?)',
        [otherParent.id, childId]
      );
      req.session.success = `Parent '${otherParent.name}' linked successfully!`;
    } else {
      req.session.error = "Parent not found.";
    }
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Invite parent error:', err);
    req.session.error = "Something went wrong while inviting the parent.";
    res.redirect('/dashboard');
  }
});

module.exports = router;