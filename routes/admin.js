// routes/admin.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const isAdmin = require('../middleware/isAdmin');
const bcrypt = require('bcrypt');

// Add cache-busting middleware for admin routes
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Last-Modified', new Date().toUTCString());
  res.set('ETag', `"${Date.now()}"`);
  next();
});

router.use(isAdmin);

// GET /admin - Redirect to admin dashboard
router.get('/', async (req, res) => {
  res.redirect('/admin/dashboard');
});

// GET /admin/trusted-groups - Dedicated trusted groups management page
router.get('/trusted-groups', async (req, res) => {
  try {
    // Get all trusted groups with creator and member information
    const [trustedGroups] = await db.query(`
      SELECT 
        tg.*,
        u.name as creator_name,
        COUNT(tgm.user_id) as member_count
      FROM TrustedGroups tg
      LEFT JOIN Users u ON tg.creator_id = u.id
      LEFT JOIN TrustedGroupMembers tgm ON tg.id = tgm.group_id
      GROUP BY tg.id
      ORDER BY tg.created_at DESC
    `);

    // Get all users for adding to groups
    const [allUsers] = await db.query(`
      SELECT id, name, email, role
      FROM Users
      WHERE role = 'parent'
      ORDER BY name
    `);

    res.render('admin/trusted-groups', {
      session: req.session,
      trustedGroups,
      allUsers
    });
  } catch (err) {
    console.error('❌ Admin trusted groups error:', err);
    req.session.error = 'Could not load trusted groups.';
    res.redirect('/admin/dashboard');
  }
});

// POST /admin/trusted-groups/:id/edit - Edit trusted group
router.post('/trusted-groups/:id/edit', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    await db.query(`
      UPDATE TrustedGroups 
      SET name = ?, description = ?
      WHERE id = ?
    `, [name, description, id]);

    req.session.success = 'Trusted group updated successfully.';
    res.redirect('/admin/trusted-groups');
  } catch (err) {
    console.error('❌ Edit trusted group error:', err);
    req.session.error = 'Could not update trusted group.';
    res.redirect('/admin/trusted-groups');
  }
});

// POST /admin/trusted-groups/:id/delete - Delete trusted group
router.post('/trusted-groups/:id/delete', async (req, res) => {
  try {
    const { id } = req.params;

    await db.query('DELETE FROM TrustedGroups WHERE id = ?', [id]);

    req.session.success = 'Trusted group deleted successfully.';
    res.redirect('/admin/trusted-groups');
  } catch (err) {
    console.error('❌ Delete trusted group error:', err);
    req.session.error = 'Could not delete trusted group.';
    res.redirect('/admin/trusted-groups');
  }
});

// GET /admin/trusted-groups/:id/members - Get group members for editing
router.get('/trusted-groups/:id/members', async (req, res) => {
  try {
    const { id } = req.params;

    const [members] = await db.query(`
      SELECT 
        tgm.*,
        u.name as user_name,
        u.email as user_email
      FROM TrustedGroupMembers tgm
      JOIN Users u ON tgm.user_id = u.id
      WHERE tgm.group_id = ?
      ORDER BY u.name
    `, [id]);

    res.json(members);
  } catch (err) {
    console.error('❌ Get group members error:', err);
    res.status(500).json({ error: 'Could not load group members.' });
  }
});

// POST /admin/trusted-groups/:id/add-member - Add member to trusted group
router.post('/trusted-groups/:id/add-member', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required.' });
    }

    // Check if user exists and is a parent
    const [[user]] = await db.query(`
      SELECT id, name, email, role 
      FROM Users 
      WHERE id = ? AND role = 'parent'
    `, [userId]);

    if (!user) {
      return res.status(400).json({ success: false, error: 'User not found or not a parent.' });
    }

    // Check if user is already a member
    const [[existingMember]] = await db.query(`
      SELECT * FROM TrustedGroupMembers 
      WHERE group_id = ? AND user_id = ?
    `, [id, userId]);

    if (existingMember) {
      return res.status(400).json({ success: false, error: 'User is already a member of this group.' });
    }

    // Add user to group
    await db.query(`
      INSERT INTO TrustedGroupMembers (group_id, user_id, added_at) 
      VALUES (?, ?, NOW())
    `, [id, userId]);

    res.json({ success: true, message: `User ${user.name} added to group successfully.` });
  } catch (err) {
    console.error('❌ Add member error:', err);
    res.status(500).json({ success: false, error: 'Could not add member to group.' });
  }
});

// POST /admin/trusted-groups/:id/remove-member - Remove member from trusted group
router.post('/trusted-groups/:id/remove-member', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required.' });
    }

    // Check if user is a member of this group
    const [[member]] = await db.query(`
      SELECT tgm.*, u.name as user_name
      FROM TrustedGroupMembers tgm
      JOIN Users u ON tgm.user_id = u.id
      WHERE tgm.group_id = ? AND tgm.user_id = ?
    `, [id, userId]);

    if (!member) {
      return res.status(400).json({ success: false, error: 'User is not a member of this group.' });
    }

    // Remove user from group
    await db.query(`
      DELETE FROM TrustedGroupMembers 
      WHERE group_id = ? AND user_id = ?
    `, [id, userId]);

    res.json({ success: true, message: `User ${member.user_name} removed from group successfully.` });
  } catch (err) {
    console.error('❌ Remove member error:', err);
    res.status(500).json({ success: false, error: 'Could not remove member from group.' });
  }
});

// GET /admin/dashboard - Admin dashboard with comprehensive overview
router.get('/dashboard', async (req, res) => {
  try {
    // Get system statistics
    const [[userStats]] = await db.query(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN role = 'parent' THEN 1 END) as total_parents,
        COUNT(CASE WHEN role = 'child' THEN 1 END) as total_children,
        COUNT(CASE WHEN is_blocked = 1 THEN 1 END) as blocked_users
      FROM Users
    `);

    const [[childStats]] = await db.query(`
      SELECT 
        COUNT(*) as total_children,
        COUNT(CASE WHEN is_blocked = 1 THEN 1 END) as blocked_children
      FROM Children
    `);

    const [[orgStats]] = await db.query(`
      SELECT COUNT(*) as total_organizations
      FROM Organizations
    `);

    // Get user/child relationships
    const [userChildRelationships] = await db.query(`
      SELECT 
        u.id as user_id,
        u.name as user_name,
        u.email as user_email,
        u.role as user_role,
        u.is_blocked as user_blocked,
        c.id as child_id,
        c.name as child_name,
        c.is_blocked as child_blocked
      FROM Users u
      LEFT JOIN Children c ON u.id = c.user_id
      WHERE u.role = 'parent'
      ORDER BY u.name, c.name
    `);

    // TrustedGroups feature has been retired – provide empty array to keep template intact
    const trustedGroups = [];

    // Get all users for editing groups
    const [allUsers] = await db.query(`
      SELECT id, name, email, role
      FROM Users
      WHERE role = 'parent'
      ORDER BY name
    `);

    // Get recent activity
    const [recentRides] = await db.query(`
      SELECT 
        r.*,
        u.name as requester_name,
        c.name as child_name
      FROM RideRequests r
      JOIN Users u ON r.user_id = u.id
      JOIN Children c ON r.child_id = c.id
      ORDER BY r.created_at DESC
      LIMIT 5
    `);

    const [recentMessages] = await db.query(`
      SELECT 
        m.*,
        u.name as sender_name
      FROM Messages m
      JOIN Users u ON m.sender_id = u.id
      ORDER BY m.sent_at DESC
      LIMIT 5
    `);

    res.render('admin/dashboard', {
      session: req.session,
      userStats,
      childStats,
      orgStats,
      userChildRelationships,
      trustedGroups,
      allUsers,
      recentRides,
      recentMessages
    });
  } catch (err) {
    console.error('❌ Admin dashboard error:', err);
    req.session.error = 'Could not load admin dashboard.';
    res.redirect('/admin');
  }
});

// Trusted Groups routes removed (feature deprecated)

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

// Update address privacy (admin) - MUST come before /users/:id/:action
router.post('/users/:id/privacy', async (req, res) => {
  const userId = req.params.id;
  const isPrivate = req.body.is_address_private === 'on' ? 1 : 0;
  
  console.log('🔍 Privacy toggle request:', {
    userId,
    isPrivate,
    body: req.body,
    is_address_private: req.body.is_address_private
  });
  
  try {
    await db.query('UPDATE Users SET is_address_private = ? WHERE id = ?', [isPrivate, userId]);
    console.log('✅ Privacy updated successfully for user', userId, 'to', isPrivate);
    req.session.success = '✅ Address privacy updated.';
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('❌ Admin privacy update error:', err);
    req.session.error = 'Failed to update address privacy.';
    res.redirect('/admin/dashboard');
  }
});

// Edit user affiliations (POST)
router.post('/users/:id/affiliations', async (req, res) => {
   const userId = req.params.id;
  const address = req.body.home_address || null;
  let orgIds = req.body.organization_ids || [];
  if (!Array.isArray(orgIds)) orgIds = [orgIds];

  await db.query('UPDATE Users SET home_address = ? WHERE id = ?', [address, userId]);

  await db.query('DELETE FROM UserAffiliations WHERE user_id = ?', [userId]);
  for (const orgId of orgIds) {
    if (!orgId) continue;
    await db.query(
      'INSERT INTO UserAffiliations (user_id, organization_id, role, created_at) VALUES (?, ?, ?, NOW())',
      [userId, orgId, 'parent']
    );
  }
  res.redirect(`/admin/users/${userId}/edit?success=Details updated`);
});

// Delete User (specific) must be defined before generic action route
router.post('/users/:id/delete-user', async (req, res) => {
  try {
    const userId = req.params.id;
    const [[user]] = await db.query('SELECT * FROM Users WHERE id = ?', [userId]);
    if (!user) {
      req.session.error = 'User not found';
      return res.redirect('/admin/users');
    }

    // Remove associated children
    await db.query('DELETE FROM Children WHERE user_id = ?', [userId]);

    // Clean up relations (ignore if tables absent)
    await db.query('DELETE FROM ActivityGroupMembers WHERE user_id = ?', [userId]).catch(() => {});
    await db.query('DELETE FROM RideRequests WHERE user_id = ?', [userId]).catch(() => {});
    await db.query('DELETE FROM RideOffers WHERE user_id = ?', [userId]).catch(() => {});

    // Delete user
    const [result] = await db.query('DELETE FROM Users WHERE id = ?', [userId]);
    if (result.affectedRows === 0) {
      req.session.error = 'User could not be deleted.';
      return res.redirect('/admin/users');
    }

    req.session.success = `✅ User '${user.name}' deleted successfully.`;
    res.redirect('/admin/users');
  } catch (err) {
    console.error('Delete user error:', err);
    req.session.error = 'Failed to delete user.';
    res.redirect('/admin/users');
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

// Update address privacy (admin) - MUST come before /users/:id/:action
router.post('/users/:id/privacy', async (req, res) => {
  const userId = req.params.id;
  const isPrivate = req.body.is_address_private === 'on' ? 1 : 0;
  
  console.log('🔍 Privacy toggle request:', {
    userId,
    isPrivate,
    body: req.body,
    is_address_private: req.body.is_address_private
  });
  
  try {
    await db.query('UPDATE Users SET is_address_private = ? WHERE id = ?', [isPrivate, userId]);
    console.log('✅ Privacy updated successfully for user', userId, 'to', isPrivate);
    req.session.success = '✅ Address privacy updated.';
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('❌ Admin privacy update error:', err);
    req.session.error = 'Failed to update address privacy.';
    res.redirect('/admin/dashboard');
  }
});

// Edit user affiliations (POST)
router.post('/users/:id/affiliations', async (req, res) => {
  const userId = req.params.id;
  let orgIds = req.body.organization_ids || [];
  if (!Array.isArray(orgIds)) orgIds = [orgIds];
  await db.query('DELETE FROM UserAffiliations WHERE user_id = ?', [userId]);
  for (const orgId of orgIds) {
    await db.query(
      'INSERT INTO UserAffiliations (user_id, organization_id, role, created_at) VALUES (?, ?, ?, NOW())',
      [userId, orgId, 'parent']
    );
  }
  res.redirect(`/admin/users/${userId}/edit?success=Affiliations updated`);
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

// Edit user affiliations (GET)
router.get('/users/:id/edit', async (req, res) => {
  const userId = req.params.id;
  const [[user]] = await db.query('SELECT * FROM Users WHERE id = ?', [userId]);
  let parents = [];
  if (user && user.role === 'child') {
    const childId = user.child_profile_id || null;
    if (childId) {
      const [pRows] = await db.query(`
        SELECT u.id, u.name, u.email
        FROM Users u
        JOIN ParentChild pc ON pc.parent_id = u.id
        WHERE pc.child_id = ?`, [childId]);
      parents = pRows;
    }
  }
  const [organizations] = await db.query('SELECT * FROM Organizations ORDER BY name ASC');
  const [affiliations] = await db.query('SELECT * FROM UserAffiliations WHERE user_id = ?', [userId]);
  res.render('admin/editUser', { user, parents, organizations, affiliations, session: req.session });
});
// Edit user affiliations (POST)
router.post('/users/:id/affiliations', async (req, res) => {
  const userId = req.params.id;
  let orgIds = req.body.organization_ids || [];
  if (!Array.isArray(orgIds)) orgIds = [orgIds];
  await db.query('DELETE FROM UserAffiliations WHERE user_id = ?', [userId]);
  for (const orgId of orgIds) {
    await db.query(
      'INSERT INTO UserAffiliations (user_id, organization_id, role, created_at) VALUES (?, ?, ?, NOW())',
      [userId, orgId, 'parent']
    );
  }
  res.redirect(`/admin/users/${userId}/edit?success=Affiliations updated`);
});
// Edit child affiliations (GET)
router.get('/children/:id/edit', async (req, res) => {
  const childId = req.params.id;
  const [[child]] = await db.query('SELECT * FROM Children WHERE id = ?', [childId]);
  const [organizations] = await db.query('SELECT * FROM Organizations ORDER BY name ASC');
  const [affiliations] = await db.query('SELECT * FROM UserAffiliations WHERE child_id = ?', [childId]);
  const [parents] = await db.query(`
      SELECT u.id, u.name, u.email FROM Users u
      JOIN ParentChild pc ON pc.parent_id = u.id
      WHERE pc.child_id = ?`, [childId]);
  res.render('admin/editChild', { child, parents, users, organizations, affiliations, session: req.session });
});
// Edit child affiliations (POST)
router.post('/children/:id/affiliations', async (req, res) => {
  const childId = req.params.id;
  let orgIds = req.body.organization_ids || [];
  if (!Array.isArray(orgIds)) orgIds = [orgIds];
  await db.query('DELETE FROM UserAffiliations WHERE child_id = ?', [childId]);
  for (const orgId of orgIds) {
    await db.query(
      'INSERT INTO UserAffiliations (child_id, organization_id, role, created_at) VALUES (?, ?, ?, NOW())',
      [childId, orgId, 'child']
    );
  }
  res.redirect(`/admin/children/${childId}/edit?success=Affiliations updated`);
});

// List all users (admin)
router.get('/users', async (req, res) => {
  try {
    const [users] = await db.query('SELECT * FROM Users ORDER BY id DESC');
    res.render('admin/users', { users, session: req.session });
  } catch (err) {
    console.error('Admin users list error:', err);
    res.status(500).send('Failed to load users list');
  }
});

// View/manage members of an activity group
router.get('/groups/:id/members', async (req, res) => {
  if (!req.session.userId || !req.session.is_admin) return res.redirect('/login');
  const groupId = req.params.id;
  try {
    const [[group]] = await db.query('SELECT * FROM ActivityGroups WHERE id = ?', [groupId]);
    if (!group) return res.status(404).send('Group not found');

    // Parent members (role column)
    const [members] = await db.query(`
      SELECT agm.id, agm.role, u.name AS user_name, u.email, c.name AS child_name, c.school, c.club
      FROM ActivityGroupMembers agm
      JOIN Users u ON agm.user_id = u.id
      LEFT JOIN Children c ON agm.child_id = c.id
      WHERE agm.group_id = ? AND agm.is_active = TRUE
      ORDER BY u.name, c.name`, [groupId]);

    const invitations = [];// invitations feature removed
    res.render('admin/groupMembers', { group, members, invitations, session: req.session });
  } catch (err) {
    console.error('Admin groupMembers error:', err);
    res.status(500).send('Could not load group members');
  }
});

// List all groups/events
router.get('/groups', async (req, res) => {
  try {
    const [groups] = await db.query(`
      SELECT ag.*, u.name AS created_by_name,
        (SELECT COUNT(*) FROM ActivityGroupMembers WHERE group_id = ag.id AND is_active = TRUE) AS group_member_count
      FROM ActivityGroups ag
      JOIN Users u ON ag.creator_id = u.id
      ORDER BY ag.created_at DESC`);
    res.render('admin/groups', { groups, session: req.session });
  } catch (err) {
    console.error('Admin groups error:', err);
    res.status(500).send('Failed to load groups');
  }
});

// --- Admin view of all rides (offers + requests) ---
router.get('/rides', async (req, res) => {
  if (!req.session.userId || !req.session.is_admin) return res.redirect('/login');
  try {
    const [rideOffers] = await db.query(`
      SELECT ro.*, u.name AS driver_name,
        (ro.available_seats - COALESCE(booked.total_booked,0)) as remaining_seats
      FROM RideOffers ro
      JOIN Users u ON ro.user_id = u.id
      LEFT JOIN (
        SELECT offer_id, SUM(seats_requested) as total_booked
        FROM RideBookings WHERE status = 'confirmed' GROUP BY offer_id
      ) booked ON ro.id = booked.offer_id
      ORDER BY ro.pickup_time DESC`);

    const [rideRequests] = await db.query(`
      SELECT rr.*, u.name AS parent_name, c.name AS child_name, d.name AS driver_name
      FROM RideRequests rr
      JOIN Users u ON rr.user_id = u.id
      JOIN Children c ON rr.child_id = c.id
      LEFT JOIN Users d ON rr.assigned_user_id = d.id
      ORDER BY rr.created_at DESC`);

    res.render('admin/rides', { rideOffers, rideRequests, session: req.session });
  } catch (err) {
    console.error('Admin rides error:', err);
    res.status(500).send('Failed to load rides');
  }
});

// Add new group/event
router.post('/groups/add', async (req, res) => {
  const { name, description, day_of_week, start_time, end_time, location, activity_type, max_participants, is_group_event, auto_assign } = req.body;
  
  if (!name || !day_of_week || !start_time || !end_time || !location) {
    req.session.error = 'Name, day of week, start time, end time, and location are required.';
    return res.redirect('/admin/groups');
  }
  
  try {
    await db.query(`
      INSERT INTO RecurringEvents (name, description, day_of_week, start_time, end_time, location, activity_type, max_participants, is_group_event, auto_assign, created_by, created_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      name.trim(), 
      description ? description.trim() : null,
      day_of_week,
      start_time,
      end_time,
      location.trim(),
      activity_type || null,
      max_participants || null,
      is_group_event === 'on' ? 1 : 0,
      auto_assign === 'on' ? 1 : 0,
      req.session.userId
    ]);
    
    req.session.success = `✅ Group '${name}' created successfully!`;
    res.redirect('/admin/groups');
  } catch (err) {
    console.error('Add group error:', err);
    req.session.error = `Failed to create group: ${err.message}`;
    res.redirect('/admin/groups');
  }
});

// Delete group/event
router.post('/groups/:id/delete', async (req, res) => {
  const groupId = req.params.id;
  
  try {
    await db.query('START TRANSACTION');
    
    // Get group name for success message
    const [[group]] = await db.query('SELECT name FROM RecurringEvents WHERE id = ?', [groupId]);
    if (!group) {
      await db.query('ROLLBACK');
      req.session.error = 'Group not found.';
      return res.redirect('/admin/groups');
    }
    
    // Delete related records first
    await db.query('DELETE FROM EventGroupInvitations WHERE event_id = ?', [groupId]);
    await db.query('DELETE FROM EventGroupMembers WHERE event_id = ?', [groupId]);
    
    // Delete the group
    await db.query('DELETE FROM RecurringEvents WHERE id = ?', [groupId]);
    
    await db.query('COMMIT');
    req.session.success = `✅ Group '${group.name}' deleted successfully!`;
    res.redirect('/admin/groups');
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Delete group error:', err);
    req.session.error = `Failed to delete group: ${err.message}`;
    res.redirect('/admin/groups');
  }
});

// View/manage members for a group
router.get('/groups/:id/members', async (req, res) => {
  const groupId = req.params.id;
  try {
    // Get group details
    const [[group]] = await db.query(
      `SELECT re.*, u.name AS created_by_name
       FROM RecurringEvents re
       JOIN Users u ON re.created_by = u.id
       WHERE re.id = ?`,
      [groupId]
    );
    if (!group) return res.status(404).send('Group not found');
    // Get all group members (parents and children)
    const [members] = await db.query(`
      SELECT egm.*, u.name AS user_name, u.email, c.name AS child_name, c.school, c.club
      FROM EventGroupMembers egm
      JOIN Users u ON egm.user_id = u.id
      LEFT JOIN Children c ON egm.child_id = c.id
      WHERE egm.event_id = ? AND egm.is_active = TRUE
      ORDER BY egm.role DESC, u.name, c.name
    `, [groupId]);
    // Get pending invitations
    const [invitations] = await db.query(`
      SELECT egi.*, u.name AS inviter_name
      FROM EventGroupInvitations egi
      JOIN Users u ON egi.inviter_id = u.id
      WHERE egi.event_id = ? AND egi.status = 'pending'
      ORDER BY egi.invited_at DESC
    `, [groupId]);
    res.render('admin/groupMembers', { group, members, invitations, session: req.session });
  } catch (err) {
    console.error('Admin group members error:', err);
    res.status(500).send('Failed to load group members');
  }
});

// Remove a member from the group
router.post('/groups/:id/remove-member', async (req, res) => {
  const groupId = req.params.id;
  const { member_id } = req.body;
  try {
    await db.query('UPDATE EventGroupMembers SET is_active = FALSE WHERE id = ?', [member_id]);
    res.redirect(`/admin/groups/${groupId}/members?success=Member removed`);
  } catch (err) {
    console.error('Remove member error:', err);
    res.redirect(`/admin/groups/${groupId}/members?error=Failed to remove member`);
  }
});

// Promote/demote a parent (admin/parent role)
router.post('/groups/:id/promote-demote', async (req, res) => {
  const groupId = req.params.id;
  const { member_id, new_role } = req.body;
  try {
    await db.query('UPDATE EventGroupMembers SET role = ? WHERE id = ?', [new_role, member_id]);
    res.redirect(`/admin/groups/${groupId}/members?success=Role updated`);
  } catch (err) {
    console.error('Promote/demote error:', err);
    res.redirect(`/admin/groups/${groupId}/members?error=Failed to update role`);
  }
});

// Resend invitation
router.post('/groups/:id/invites/:inviteId/resend', async (req, res) => {
  const groupId = req.params.id;
  const inviteId = req.params.inviteId;
  try {
    // Get invite details
    const [[invite]] = await db.query('SELECT * FROM EventGroupInvitations WHERE id = ?', [inviteId]);
    if (!invite) return res.redirect(`/admin/groups/${groupId}/members?error=Invite not found`);
    // Resend logic: update invited_at and (optionally) send notification
    await db.query('UPDATE EventGroupInvitations SET invited_at = NOW() WHERE id = ?', [inviteId]);
    // TODO: Optionally send in-app or email notification here
    res.redirect(`/admin/groups/${groupId}/members?success=Invitation resent`);
  } catch (err) {
    console.error('Resend invite error:', err);
    res.redirect(`/admin/groups/${groupId}/members?error=Failed to resend invitation`);
  }
});

// Approve a pending invite (manual override)
router.post('/groups/:id/invites/:inviteId/approve', async (req, res) => {
  const groupId = req.params.id;
  const inviteId = req.params.inviteId;
  try {
    await db.query('UPDATE EventGroupInvitations SET status = "accepted", responded_at = NOW() WHERE id = ?', [inviteId]);
    res.redirect(`/admin/groups/${groupId}/members?success=Invitation approved`);
  } catch (err) {
    console.error('Approve invite error:', err);
    res.redirect(`/admin/groups/${groupId}/members?error=Failed to approve invitation`);
  }
});

// Decline a pending invite (manual override)
router.post('/groups/:id/invites/:inviteId/decline', async (req, res) => {
  const groupId = req.params.id;
  const inviteId = req.params.inviteId;
  try {
    await db.query('UPDATE EventGroupInvitations SET status = "declined", responded_at = NOW() WHERE id = ?', [inviteId]);
    res.redirect(`/admin/groups/${groupId}/members?success=Invitation declined`);
  } catch (err) {
    console.error('Decline invite error:', err);
    res.redirect(`/admin/groups/${groupId}/members?error=Failed to decline invitation`);
  }
});

// GET /admin/organizations - List all organizations
router.get('/organizations', async (req, res) => {
  try {
    // Get all organizations with affiliation counts
    const [organizations] = await db.query(`
      SELECT 
        o.*,
        COALESCE(parent_count.count, 0) as parent_count,
        COALESCE(child_count.count, 0) as child_count
      FROM Organizations o
      LEFT JOIN (
        SELECT 
          organization_id, 
          COUNT(DISTINCT user_id) as count
        FROM UserAffiliations 
        WHERE role = 'parent'
        GROUP BY organization_id
      ) parent_count ON o.id = parent_count.organization_id
      LEFT JOIN (
        SELECT 
          organization_id, 
          COUNT(DISTINCT child_id) as count
        FROM UserAffiliations 
        WHERE role = 'child' AND child_id IS NOT NULL
        GROUP BY organization_id
      ) child_count ON o.id = child_count.organization_id
      ORDER BY o.name
    `);
    
    // Get popularity data: count children linked to each organization (by school)
    const [orgPopularity] = await db.query(`
      SELECT o.name, COUNT(c.id) as count
      FROM Organizations o
      LEFT JOIN Children c ON c.school = o.name
      GROUP BY o.id
      ORDER BY count DESC, o.name ASC
      LIMIT 10
    `);
    
    // Get user's affiliations (grouped by organization) for the admin
    const [userAffiliations] = await db.query(`
      SELECT 
        o.id,
        o.name,
        o.type,
        o.address,
        GROUP_CONCAT(DISTINCT ua.role ORDER BY ua.role SEPARATOR ',') as roles
      FROM UserAffiliations ua
      JOIN Organizations o ON ua.organization_id = o.id
      WHERE ua.user_id = ?
      GROUP BY o.id, o.name, o.type, o.address
      ORDER BY o.name
    `, [req.session.userId]);
    
    res.render('admin/organizations', { 
      organizations, 
      orgPopularityData: orgPopularity, 
      userAffiliations,
      session: req.session, 
      activePage: 'organizations' 
    });
  } catch (err) {
    console.error('Admin organizations error:', err);
    res.status(500).send('Failed to load organizations');
  }
});



// POST /admin/organizations/:id/delete - Delete organization
router.post('/organizations/:id/delete', async (req, res) => {
  try {
    await db.query('DELETE FROM Organizations WHERE id = ?', [req.params.id]);
    res.redirect('/admin/organizations');
  } catch (err) {
    console.error('Delete org error:', err);
    res.status(500).send('Could not delete organization: ' + err.message);
  }
});

// Admin Messages Overview
router.get('/messages', async (req, res) => {
  try {
    // Get message statistics
    let messageStats = { total_messages: 0, unread_messages: 0, unique_senders: 0, unique_recipients: 0 };
    let recentMessages = [];
    let mostActiveUsers = [];
    let dailyStats = [];
    
    try {
      const [[stats]] = await db.query(`
        SELECT 
          COUNT(*) AS total_messages,
          SUM(read_at IS NULL) AS unread_messages,
          COUNT(DISTINCT sender_id) AS unique_senders,
          COUNT(DISTINCT recipient_id) AS unique_recipients
        FROM Messages
      `);
      messageStats = stats;
    } catch (err) {
      console.log('Error getting message stats:', err.message);
    }

    try {
      const [messages] = await db.query(`
        SELECT m.*, 
          s.name AS sender_name, 
          r.name AS recipient_name,
          m.sent_at
        FROM Messages m
        JOIN Users s ON m.sender_id = s.id
        JOIN Users r ON m.recipient_id = r.id
        ORDER BY m.sent_at DESC
        LIMIT 10
      `);
      recentMessages = messages;
    } catch (err) {
      console.log('Error getting recent messages:', err.message);
    }

    try {
      const [users] = await db.query(`
        SELECT u.name, u.email, u.role,
          COUNT(m.id) AS messages_sent,
          COUNT(mr.id) AS messages_received
        FROM Users u
        LEFT JOIN Messages m ON u.id = m.sender_id
        LEFT JOIN Messages mr ON u.id = mr.recipient_id
        WHERE u.role IN ('parent', 'child')
        GROUP BY u.id
        ORDER BY messages_sent DESC
        LIMIT 10
      `);
      mostActiveUsers = users;
    } catch (err) {
      console.log('Error getting most active users:', err.message);
    }

    // Get group message statistics
    let groupMessageStats = { total_group_messages: 0, active_group_chats: 0, group_participants: 0 };
    let recentGroupMessages = [];
    
    try {
      const [[groupStats]] = await db.query(`
        SELECT 
          COUNT(*) AS total_group_messages,
          COUNT(DISTINCT event_id) AS active_group_chats,
          COUNT(DISTINCT sender_id) AS group_participants
        FROM EventGroupMessages
      `);
      groupMessageStats = groupStats;
      
      const [groupMessages] = await db.query(`
        SELECT egm.*, 
          u.name AS sender_name,
          re.name AS group_name
        FROM EventGroupMessages egm
        JOIN Users u ON egm.sender_id = u.id
        JOIN RecurringEvents re ON egm.event_id = re.id
        ORDER BY egm.sent_at DESC
        LIMIT 10
      `);
      recentGroupMessages = groupMessages;
    } catch (err) {
      console.log('EventGroupMessages table not found, using empty data');
    }

    // Note: Notification table doesn't exist in the database
    // Using empty objects/arrays for now
    const notificationStats = {
      total_notifications: 0,
      unread_notifications: 0,
      users_with_notifications: 0
    };
    const recentNotifications = [];

    try {
      const [stats] = await db.query(`
        SELECT 
          DATE(sent_at) AS date,
          COUNT(*) AS message_count,
          COUNT(DISTINCT sender_id) AS unique_senders
        FROM Messages
        WHERE sent_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        GROUP BY DATE(sent_at)
        ORDER BY date DESC
      `);
      dailyStats = stats;
    } catch (err) {
      console.log('Error getting daily stats:', err.message);
    }

    res.render('admin/messages', {
      messageStats,
      recentMessages,
      mostActiveUsers,
      groupMessageStats,
      recentGroupMessages,
      notificationStats,
      recentNotifications,
      dailyStats,
      session: req.session
    });
  } catch (err) {
    console.error('Admin messages error:', err);
    res.status(500).send('Failed to load messages overview');
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
    
    // Look up organization_id from school name
    const [[org]] = await db.query('SELECT id FROM Organizations WHERE name = ? AND type = "school"', [school.trim()]);
    const organizationId = org ? org.id : null;
    
    // Create child record for the first parent (primary parent)
    const primaryParentId = validParents[0];
    const [childResult] = await db.query(
      'INSERT INTO Children (user_id, name, school, club, created_at) VALUES (?, ?, ?, ?, NOW())',
      [primaryParentId, name.trim(), school.trim(), club ? club.trim() : null]
    );
    const childId = childResult.insertId;
    
    // Create child user account
    const hashedPassword = await bcrypt.hash(child_password, 10);
    const [userResult] = await db.query(
      'INSERT INTO Users (name, username, email, password_hash, role, parent_id, child_profile_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
      [name.trim(), child_username.trim(), `${child_username.trim()}@child.local`, hashedPassword, 'child', primaryParentId, childId]
    );
    if (userResult.affectedRows === 0) {
      throw new Error('Failed to insert into Users table');
    }
    const childUserId = userResult.insertId;
    
    // Create ParentChild entries for all parents
    for (const parentId of validParents) {
      await db.query(
        'INSERT INTO ParentChild (parent_id, child_id, created_at) VALUES (?, ?, NOW())',
        [parentId, childId]
      );
    }
    
    // Create UserAffiliations if organization was found
    if (organizationId) {
      // Parent affiliations for all parents
      for (const parentId of validParents) {
        await db.query(
          'INSERT INTO UserAffiliations (user_id, child_id, organization_id, role, created_at) VALUES (?, ?, ?, ?, NOW())',
          [parentId, childId, organizationId, 'parent']
        );
      }
      
      // Child affiliation
      await db.query(
        'INSERT INTO UserAffiliations (user_id, child_id, organization_id, role, created_at) VALUES (?, ?, ?, ?, NOW())',
        [childUserId, childId, organizationId, 'child']
      );
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
    await db.query('START TRANSACTION');
    
    // Get the current child info
    const [[currentChild]] = await db.query('SELECT * FROM Children WHERE id = ?', [req.params.id]);
    if (!currentChild) {
      await db.query('ROLLBACK');
      req.session.error = 'Child not found';
      return res.redirect('/admin/dashboard');
    }
    
    // Look up organization_id from school name
    const [[org]] = await db.query('SELECT id FROM Organizations WHERE name = ? AND type = "school"', [school.trim()]);
    const organizationId = org ? org.id : null;
    
    // Update the child record
    await db.query(
      'UPDATE Children SET name = ?, school = ?, club = ?, user_id = ? WHERE id = ?',
      [name.trim(), school.trim(), club ? club.trim() : null, user_id, req.params.id]
    );
    
    // Update ParentChild entries if the parent changed
    if (currentChild.user_id != user_id) {
      // Remove old ParentChild entry
      await db.query('DELETE FROM ParentChild WHERE child_id = ? AND parent_id = ?', [req.params.id, currentChild.user_id]);
      // Add new ParentChild entry
      await db.query('INSERT INTO ParentChild (parent_id, child_id, created_at) VALUES (?, ?, NOW())', [user_id, req.params.id]);
    }
    
    // Update UserAffiliations if organization was found
    if (organizationId) {
      // Remove old affiliations for this child
      await db.query('DELETE FROM UserAffiliations WHERE child_id = ?', [req.params.id]);
      
      // Get all parents for this child
      const [parents] = await db.query('SELECT parent_id FROM ParentChild WHERE child_id = ?', [req.params.id]);
      
      // Create new affiliations for all parents
      for (const parent of parents) {
        await db.query(
          'INSERT INTO UserAffiliations (user_id, child_id, organization_id, role, created_at) VALUES (?, ?, ?, ?, NOW())',
          [parent.parent_id, req.params.id, organizationId, 'parent']
        );
      }
      
      // Get child user account if it exists
      const [[childUser]] = await db.query('SELECT id FROM Users WHERE child_profile_id = ?', [req.params.id]);
      if (childUser) {
        await db.query(
          'INSERT INTO UserAffiliations (user_id, child_id, organization_id, role, created_at) VALUES (?, ?, ?, ?, NOW())',
          [childUser.id, req.params.id, organizationId, 'child']
        );
      }
    }
    
    await db.query('COMMIT');
    req.session.success = `✅ Child '${name}' updated successfully.`;
    res.redirect('/admin/dashboard');
  } catch (err) {
    await db.query('ROLLBACK');
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

    // Delete UserAffiliations for this child
    await db.query('DELETE FROM UserAffiliations WHERE child_id = ?', [childId]);
    console.log(`Deleted UserAffiliations entries for child ID ${childId}`);

    // Delete ParentChild entries for this child
    await db.query('DELETE FROM ParentChild WHERE child_id = ?', [childId]);
    console.log(`Deleted ParentChild entries for child ID ${childId}`);

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

// Admin: Add parent to child (link in ParentChild)
router.post('/children/:childId/add-parent', async (req, res) => {
  const childId = req.params.childId;
  const { parent_email_or_username } = req.body;
  
  if (!parent_email_or_username) {
    req.session.error = 'Parent email or username is required.';
    return res.redirect('/admin/dashboard');
  }
  
  try {
    await db.query('START TRANSACTION');
    
    // First, verify the child exists
    const [[child]] = await db.query('SELECT * FROM Children WHERE id = ?', [childId]);
    if (!child) {
      await db.query('ROLLBACK');
      req.session.error = 'Child not found.';
      return res.redirect('/admin/dashboard');
    }
    
    // Find parent by email or username
    const [[parent]] = await db.query(
      'SELECT id, name, email, role FROM Users WHERE (email = ? OR username = ?) AND role = "parent"',
      [parent_email_or_username, parent_email_or_username]
    );
    
    if (!parent) {
      await db.query('ROLLBACK');
      req.session.error = `Parent not found with email/username: ${parent_email_or_username}. Please ensure the parent exists and has the 'parent' role.`;
      return res.redirect('/admin/dashboard');
    }
    
    // Check if this parent is already linked to this child
    const [[existingLink]] = await db.query(
      'SELECT * FROM ParentChild WHERE parent_id = ? AND child_id = ?',
      [parent.id, childId]
    );
    
    if (existingLink) {
      await db.query('ROLLBACK');
      req.session.error = `Parent ${parent.name} is already linked to child ${child.name}.`;
      return res.redirect('/admin/dashboard');
    }
    
    // Link parent to child in ParentChild
    await db.query(
      'INSERT INTO ParentChild (parent_id, child_id, created_at) VALUES (?, ?, NOW())',
      [parent.id, childId]
    );
    
    await db.query('COMMIT');
    req.session.success = `✅ Parent ${parent.name} (${parent.email}) successfully linked to child ${child.name}!`;
    res.redirect('/admin/dashboard');
    
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Admin add parent to child error:', err);
    req.session.error = `Failed to link parent to child: ${err.message}`;
    res.redirect('/admin/dashboard');
  }
});

// Admin: Remove parent from child (unlink in ParentChild)
router.post('/children/:childId/remove-parent', async (req, res) => {
  const childId = req.params.childId;
  const { parent_id } = req.body;
  
  if (!parent_id) {
    req.session.error = 'Parent ID is required.';
    return res.redirect('/admin/dashboard');
  }
  
  try {
    await db.query('START TRANSACTION');
    
    // First, verify the child exists
    const [[child]] = await db.query('SELECT * FROM Children WHERE id = ?', [childId]);
    if (!child) {
      await db.query('ROLLBACK');
      req.session.error = 'Child not found.';
      return res.redirect('/admin/dashboard');
    }
    
    // Verify the parent exists and is linked to this child
    const [[parentLink]] = await db.query(
      `SELECT pc.*, u.name as parent_name, u.email as parent_email 
       FROM ParentChild pc 
       JOIN Users u ON pc.parent_id = u.id 
       WHERE pc.parent_id = ? AND pc.child_id = ?`,
      [parent_id, childId]
    );
    
    if (!parentLink) {
      await db.query('ROLLBACK');
      req.session.error = 'Parent is not linked to this child.';
      return res.redirect('/admin/dashboard');
    }
    
    // Check if this is the primary parent (the one in the Children.user_id field)
    if (child.user_id == parent_id) {
      await db.query('ROLLBACK');
      req.session.error = `Cannot remove ${parentLink.parent_name} as they are the primary parent of ${child.name}. Please reassign the primary parent first.`;
      return res.redirect('/admin/dashboard');
    }
    
    // Remove the parent-child link
    await db.query(
      'DELETE FROM ParentChild WHERE parent_id = ? AND child_id = ?',
      [parent_id, childId]
    );
    
    await db.query('COMMIT');
    req.session.success = `✅ Parent ${parentLink.parent_name} (${parentLink.parent_email}) successfully removed from child ${child.name}!`;
    res.redirect('/admin/dashboard');
    
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Admin remove parent from child error:', err);
    req.session.error = `Failed to remove parent from child: ${err.message}`;
    res.redirect('/admin/dashboard');
  }
});

module.exports = router;