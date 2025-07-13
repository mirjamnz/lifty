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
    // Fetch all ParentChild links
    const [parentChildLinks] = await db.query('SELECT * FROM ParentChild');
    // Build whānau groups: group by unique set of parents for each set of children
    // Map: child_id -> [parent_id]
    const childToParents = {};
    parentChildLinks.forEach(link => {
      if (!childToParents[link.child_id]) childToParents[link.child_id] = [];
      childToParents[link.child_id].push(link.parent_id);
    });
    // Map: parent_id -> [child_id]
    const parentToChildren = {};
    parentChildLinks.forEach(link => {
      if (!parentToChildren[link.parent_id]) parentToChildren[link.parent_id] = [];
      parentToChildren[link.parent_id].push(link.child_id);
    });
    // Group children by their set of parents (sorted for uniqueness)
    const whanauMap = {};
    Object.entries(childToParents).forEach(([childId, parentIds]) => {
      const key = parentIds.sort((a,b)=>a-b).join('-');
      if (!whanauMap[key]) whanauMap[key] = { parentIds: parentIds.slice(), childIds: [] };
      whanauMap[key].childIds.push(Number(childId));
    });
    // Build whanauGroups: [{parents: [user], children: [child]}]
    const whanauGroups = Object.values(whanauMap).map(group => {
      const parents = users.filter(u => group.parentIds.includes(u.id));
      const kids = children.filter(c => group.childIds.includes(c.id));
      return { parents, children: kids };
    });
    // Fetch all groups/events
    const [groups] = await db.query(`
      SELECT re.*, u.name AS created_by_name,
        (SELECT COUNT(*) FROM EventGroupMembers WHERE event_id = re.id AND is_active = TRUE) AS group_member_count
      FROM RecurringEvents re
      JOIN Users u ON re.created_by = u.id
      ORDER BY re.day_of_week, re.start_time
    `);
    // --- Statistics ---
    const [[userStats]] = await db.query(`
      SELECT COUNT(*) AS total_users,
        SUM(role = 'parent') AS total_parents,
        SUM(role = 'child') AS total_children,
        SUM(is_admin = 1) AS total_admins
      FROM Users
    `);
    const [[groupStats]] = await db.query('SELECT COUNT(*) AS total_groups FROM RecurringEvents');
    const [[childStats]] = await db.query('SELECT COUNT(*) AS total_children FROM Children');
    const [[activeMembersStats]] = await db.query('SELECT COUNT(*) AS total_active_group_members FROM EventGroupMembers WHERE is_active = TRUE');
    const [[pendingInvitesStats]] = await db.query('SELECT COUNT(*) AS total_pending_invitations FROM EventGroupInvitations WHERE status = "pending"');
    const [[recentSignupsStats]] = await db.query('SELECT COUNT(*) AS recent_signups FROM Users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)');
    const [[mostActiveGroup]] = await db.query(`
      SELECT re.name, COUNT(egm.id) AS member_count
      FROM RecurringEvents re
      JOIN EventGroupMembers egm ON egm.event_id = re.id AND egm.is_active = TRUE
      GROUP BY re.id
      ORDER BY member_count DESC
      LIMIT 1
    `);
    const stats = {
      total_users: userStats.total_users,
      total_parents: userStats.total_parents,
      total_children: userStats.total_children,
      total_admins: userStats.total_admins,
      total_groups: groupStats.total_groups,
      total_children_table: childStats.total_children,
      total_active_group_members: activeMembersStats.total_active_group_members,
      total_pending_invitations: pendingInvitesStats.total_pending_invitations,
      recent_signups: recentSignupsStats.recent_signups,
      most_active_group: mostActiveGroup ? mostActiveGroup.name : null,
      most_active_group_count: mostActiveGroup ? mostActiveGroup.member_count : 0
    };
    // --- End Statistics ---
    res.render('admin/dashboard', {
      organizations,
      users,
      children,
      groups,
      stats,
      session: req.session,
      activePage: 'dashboard',
      whanauGroups // <-- pass to view
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
    if (!org) return res.status(404).send('Organization not found');
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
    res.redirect('/admin/organizations');
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

// Admin: Add parent to child (link in ParentChild)
router.post('/children/:childId/add-parent', async (req, res) => {
  const childId = req.params.childId;
  const { parent_email_or_username } = req.body;
  if (!parent_email_or_username) {
    req.session.error = 'Parent email or username is required.';
    return res.redirect('/admin/dashboard');
  }
  try {
    // Find parent by email or username
    const [[parent]] = await db.query(
      'SELECT id FROM Users WHERE email = ? OR username = ?',
      [parent_email_or_username, parent_email_or_username]
    );
    if (!parent) {
      req.session.error = 'Parent not found.';
      return res.redirect('/admin/dashboard');
    }
    // Link parent to child in ParentChild
    await db.query(
      'INSERT IGNORE INTO ParentChild (parent_id, child_id) VALUES (?, ?)',
      [parent.id, childId]
    );
    req.session.success = 'Parent linked to child successfully!';
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Admin add parent to child error:', err);
    req.session.error = 'Failed to link parent to child.';
    res.redirect('/admin/dashboard');
  }
});

// List all groups/events
router.get('/groups', async (req, res) => {
  try {
    const [groups] = await db.query(`
      SELECT re.*, u.name AS created_by_name
      FROM RecurringEvents re
      JOIN Users u ON re.created_by = u.id
      ORDER BY re.day_of_week, re.start_time
    `);
    res.render('admin/groups', { groups, session: req.session });
  } catch (err) {
    console.error('Admin groups error:', err);
    res.status(500).send('Failed to load groups');
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
    const [organizations] = await db.query('SELECT * FROM Organizations ORDER BY name ASC');
    // Get popularity data: count children linked to each organization (by school)
    const [orgPopularity] = await db.query(`
      SELECT o.name, COUNT(c.id) as count
      FROM Organizations o
      LEFT JOIN Children c ON c.school = o.name
      GROUP BY o.id
      ORDER BY count DESC, o.name ASC
      LIMIT 10
    `);
    res.render('admin/organizations', { organizations, orgPopularityData: orgPopularity, session: req.session, activePage: 'organizations' });
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

module.exports = router;