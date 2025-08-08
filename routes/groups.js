// routes/groups.js - Unified Activity Groups System
const express = require('express');
const router = express.Router();
const db = require('../db');
const notifications = require('../utils/notifications');

// GET /groups - Show all activity groups for the user
router.get('/', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  
  try {
    const userId = req.session.userId;
    
    // Get groups created by the user
    const [myGroups] = await db.query(`
      SELECT 
        ag.*,
        COUNT(DISTINCT agm.user_id) as member_count,
        COUNT(DISTINCT agm.child_id) as child_count
      FROM ActivityGroups ag
      LEFT JOIN ActivityGroupMembers agm ON ag.id = agm.group_id AND agm.is_active = TRUE
      WHERE ag.creator_id = ? AND ag.is_active = TRUE
      GROUP BY ag.id
      ORDER BY ag.created_at DESC
    `, [userId]);
    
    // Get groups where user is a member (but not creator)
    const [memberGroups] = await db.query(`
      SELECT 
        ag.*,
        u.name as creator_name,
        COUNT(DISTINCT agm2.user_id) as member_count,
        COUNT(DISTINCT agm2.child_id) as child_count
      FROM ActivityGroups ag
      JOIN ActivityGroupMembers agm ON ag.id = agm.group_id
      LEFT JOIN ActivityGroupMembers agm2 ON ag.id = agm2.group_id AND agm2.is_active = TRUE
      JOIN Users u ON ag.creator_id = u.id
      WHERE agm.user_id = ? AND ag.creator_id != ? AND agm.is_active = TRUE AND ag.is_active = TRUE
      GROUP BY ag.id
      ORDER BY ag.created_at DESC
    `, [userId, userId]);
    
    // Get user's children
    const [children] = await db.query(`
      SELECT c.* FROM Children c
      JOIN ParentChild pc ON pc.child_id = c.id
      WHERE pc.parent_id = ?
    `, [userId]);
    
    // Get all users for adding to groups (excluding current user)
    const [allUsers] = await db.query(`
      SELECT id, name, email 
      FROM Users 
      WHERE id != ? AND role = 'parent'
      ORDER BY name
    `, [userId]);
    
    res.render('groups', {
      session: req.session,
      myGroups,
      memberGroups,
      children,
      allUsers
    });
  } catch (err) {
    console.error('❌ Groups error:', err);
    req.session.error = 'Could not load groups.';
    res.redirect('/dashboard');
  }
});

// POST /groups - Create a new activity group
router.post('/', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  
  try {
    const { 
      name, description, privacy, invite_only, 
      has_schedule, day_of_week, start_time, end_time, location, activity_type,
      member_ids, child_ids 
    } = req.body;
    const creatorId = req.session.userId;
    
    if (!name) {
      req.session.error = 'Group name is required.';
      return res.redirect('/groups');
    }
    
    // Validate schedule fields if has_schedule is checked
    if (has_schedule === 'on') {
      if (!day_of_week || !start_time || !end_time || !location) {
        req.session.error = 'For scheduled groups, day, times, and location are required.';
        return res.redirect('/groups');
      }
    }
    
    // Create the group
    const [result] = await db.query(`
      INSERT INTO ActivityGroups (
        name, description, creator_id, privacy, invite_only,
        has_schedule, day_of_week, start_time, end_time, location, activity_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      name, description, creatorId, privacy || 'public', invite_only === 'on',
      has_schedule === 'on', day_of_week || null, start_time || null, 
      end_time || null, location || null, activity_type || 'Social'
    ]);
    
    const groupId = result.insertId;
    
    // Add creator as admin member
    await db.query(`
      INSERT INTO ActivityGroupMembers (group_id, user_id, role)
      VALUES (?, ?, 'admin')
    `, [groupId, creatorId]);
    
    // Add selected members
    if (member_ids && member_ids.length > 0) {
      const memberValues = member_ids.map(userId => [groupId, userId, 'member']);
      await db.query(`
        INSERT INTO ActivityGroupMembers (group_id, user_id, role)
        VALUES ?
      `, [memberValues]);
      
      // Get creator name for notifications
      const [[creator]] = await db.query('SELECT name FROM Users WHERE id = ?', [creatorId]);
      
      // Notify each added member
      for (const userId of member_ids) {
        await notifications.notifyUserAddedToActivityGroup(groupId, userId, name, creator.name, has_schedule === 'on');
      }
    }
    
    // Add selected children (for scheduled groups)
    if (child_ids && child_ids.length > 0 && has_schedule === 'on') {
      for (const childId of child_ids) {
        // Get the child's parent
        const [[child]] = await db.query('SELECT user_id FROM Children WHERE id = ?', [childId]);
        if (child) {
          await db.query(`
            INSERT INTO ActivityGroupMembers (group_id, user_id, child_id, role)
            VALUES (?, ?, ?, 'member')
            ON DUPLICATE KEY UPDATE child_id = VALUES(child_id)
          `, [groupId, child.user_id, childId]);
        }
      }
    }
    
    const groupType = has_schedule === 'on' ? 'scheduled' : 'chat';
    req.session.success = `${groupType === 'scheduled' ? 'Scheduled' : 'Chat'} group "${name}" created successfully!`;
    res.redirect('/groups');
  } catch (err) {
    console.error('❌ Create group error:', err);
    req.session.error = 'Could not create group.';
    res.redirect('/groups');
  }
});

// GET /groups/api/locations - Get organization locations for autocomplete
router.get('/api/locations', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    const search = req.query.q || '';
    const [locations] = await db.query(`
      SELECT DISTINCT 
        CONCAT(name, ' - ', COALESCE(address, 'No address')) as label,
        CONCAT(name, ', ', COALESCE(address, '')) as value,
        name,
        address,
        type
      FROM Organizations 
      WHERE (name LIKE ? OR address LIKE ?) 
        AND name IS NOT NULL 
        AND name != ''
      ORDER BY 
        CASE 
          WHEN name LIKE ? THEN 1 
          WHEN address LIKE ? THEN 2 
          ELSE 3 
        END,
        name ASC
      LIMIT 20
    `, [
      `%${search}%`, `%${search}%`,
      `${search}%`, `${search}%`
    ]);
    
    res.json(locations);
  } catch (err) {
    console.error('❌ Location autocomplete error:', err);
    res.status(500).json({ error: 'Could not fetch locations' });
  }
});

// GET /groups/:id - View group details
router.get('/:id', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  
  try {
    const groupId = req.params.id;
    const userId = req.session.userId;
    
    // Get user details to check if it's a child user
    const [[user]] = await db.query('SELECT * FROM Users WHERE id = ?', [userId]);
    
    // Get group details
    const [[group]] = await db.query(`
      SELECT ag.*, u.name AS creator_name
      FROM ActivityGroups ag
      JOIN Users u ON ag.creator_id = u.id
      WHERE ag.id = ? AND ag.is_active = TRUE
    `, [groupId]);
    
    if (!group) {
      req.session.error = 'Group not found.';
      return res.redirect('/groups');
    }
    
    let membership = null;
    let hasAccess = false;
    
    if (user.role === 'child') {
      // For child users, check if they are assigned to this group as a child
      const [[childMembership]] = await db.query(`
        SELECT agm.*, u.name as parent_name
        FROM ActivityGroupMembers agm
        JOIN Users u ON agm.user_id = u.id
        WHERE agm.group_id = ? AND agm.child_id = ? AND agm.is_active = TRUE
      `, [groupId, user.child_profile_id]);
      
      if (childMembership) {
        hasAccess = true;
        membership = childMembership;
        membership.role = 'child'; // Set role as child for display purposes
      }
    } else {
      // For parent users, check if they are a member or creator
      const [[parentMembership]] = await db.query(`
        SELECT * FROM ActivityGroupMembers 
        WHERE group_id = ? AND user_id = ? AND is_active = TRUE
      `, [groupId, userId]);
      
      if (parentMembership || group.creator_id === userId) {
        hasAccess = true;
        membership = parentMembership;
      }
    }
    
    if (!hasAccess) {
      req.session.error = 'You do not have access to this group.';
      return res.redirect('/groups');
    }
    
    // Get group members
    const [members] = await db.query(`
      SELECT agm.*, u.name AS user_name, u.email, c.name AS child_name
      FROM ActivityGroupMembers agm
      JOIN Users u ON agm.user_id = u.id
      LEFT JOIN Children c ON agm.child_id = c.id
      WHERE agm.group_id = ? AND agm.is_active = TRUE
      ORDER BY agm.role DESC, u.name, c.name
    `, [groupId]);
    
    // Get recent messages
    const [messages] = await db.query(`
      SELECT agm.*, u.name AS sender_name
      FROM ActivityGroupMessages agm
      JOIN Users u ON agm.sender_id = u.id
      WHERE agm.group_id = ?
      ORDER BY agm.sent_at DESC
      LIMIT 50
    `, [groupId]);
    
    // Get upcoming assignments (if scheduled group)
    let assignments = [];
    let overrides = [];
    
    if (group.has_schedule) {
      const [assignmentsResult] = await db.query(`
        SELECT aga.*, u.name AS user_name, c.name AS child_name
        FROM ActivityGroupAssignments aga
        JOIN Users u ON aga.user_id = u.id
        JOIN Children c ON aga.child_id = c.id
        WHERE aga.group_id = ? AND aga.assignment_date >= CURDATE() AND aga.is_cancelled = FALSE
        ORDER BY aga.assignment_date ASC
        LIMIT 10
      `, [groupId]);
      assignments = assignmentsResult;
      
      // Get schedule overrides
      const [overridesResult] = await db.query(`
        SELECT aso.*, u.name AS created_by_name
        FROM ActivityScheduleOverrides aso
        JOIN Users u ON aso.created_by = u.id
        WHERE aso.group_id = ? AND aso.override_date >= CURDATE()
        ORDER BY aso.override_date ASC
      `, [groupId]);
      overrides = overridesResult;
    }
    
    // Get available children for adding to group (only for parent users)
    let availableChildren = [];
    if (membership && user.role !== 'child') {
      if (membership.role === 'admin') {
        // Admins can add any group member's children
        const [availableChildrenResult] = await db.query(`
          SELECT DISTINCT c.id, c.name, u.name AS parent_name, c.user_id
          FROM Children c
          JOIN Users u ON c.user_id = u.id
          JOIN ActivityGroupMembers agm ON u.id = agm.user_id
          WHERE agm.group_id = ? AND agm.is_active = TRUE
            AND c.id NOT IN (
              SELECT child_id FROM ActivityGroupMembers 
              WHERE group_id = ? AND child_id IS NOT NULL AND is_active = TRUE
            )
          ORDER BY u.name, c.name
        `, [groupId, groupId]);
        availableChildren = availableChildrenResult;
      } else {
        // Regular members can only add their own children
        const [availableChildrenResult] = await db.query(`
          SELECT DISTINCT c.id, c.name, u.name AS parent_name, c.user_id
          FROM Children c
          JOIN Users u ON c.user_id = u.id
          WHERE u.id = ? 
            AND c.id NOT IN (
              SELECT child_id FROM ActivityGroupMembers 
              WHERE group_id = ? AND child_id IS NOT NULL AND is_active = TRUE
            )
          ORDER BY c.name
        `, [userId, groupId]);
        availableChildren = availableChildrenResult;
      }
    }
    
    res.render('group-detail', {
      session: req.session,
      group,
      members,
      messages: messages.reverse(), // Show oldest first
      assignments,
      overrides,
      userMembership: membership,
      availableChildren,
      user: user // Pass user object for role checking in template
    });
  } catch (err) {
    console.error('❌ Group detail error:', err);
    req.session.error = 'Could not load group details.';
    res.redirect('/groups');
  }
});

// POST /groups/:id/add-children - Add children to group
router.post('/:id/add-children', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  
  try {
    const groupId = req.params.id;
    const userId = req.session.userId;
    const childIds = Array.isArray(req.body.child_ids) ? req.body.child_ids : [req.body.child_ids].filter(Boolean);
    
    if (!childIds || childIds.length === 0) {
      req.session.error = 'Please select at least one child to add.';
      return res.redirect(`/groups/${groupId}`);
    }
    
    // Check if user is a member of this group
    const [[membership]] = await db.query(`
      SELECT * FROM ActivityGroupMembers 
      WHERE group_id = ? AND user_id = ? AND is_active = TRUE
    `, [groupId, userId]);
    
    if (!membership) {
      req.session.error = 'You are not a member of this group.';
      return res.redirect(`/groups/${groupId}`);
    }
    
    // Get group name for notifications
    const [[group]] = await db.query('SELECT name FROM ActivityGroups WHERE id = ?', [groupId]);
    const [[user]] = await db.query('SELECT name FROM Users WHERE id = ?', [userId]);
    
    let addedCount = 0;
    
    for (const childId of childIds) {
      // Get child and parent info
      const [[child]] = await db.query(`
        SELECT c.*, u.name AS parent_name, u.id AS parent_id
        FROM Children c
        JOIN Users u ON c.user_id = u.id
        WHERE c.id = ?
      `, [childId]);
      
      if (child) {
        // If user is not an admin, they can only add their own children
        if (membership.role !== 'admin' && child.parent_id !== userId) {
          continue; // Skip this child - not allowed
        }
        
        // Add child to group
        await db.query(`
          INSERT INTO ActivityGroupMembers (group_id, user_id, child_id, role)
          VALUES (?, ?, ?, 'member')
          ON DUPLICATE KEY UPDATE is_active = TRUE
        `, [groupId, child.parent_id, childId]);
        
        // Send notification to parent (if different from current user)
        if (child.parent_id !== userId) {
          await db.query(`
            INSERT INTO Notifications (user_id, type, title, message, related_type, related_id)
            VALUES (?, 'child_added_to_group', 'Child Added to Group', ?, 'activity_group', ?)
          `, [child.parent_id, `${child.name} has been added to the group "${group.name}" by ${user.name}.`, groupId]);
        }
        
        addedCount++;
      }
    }
    
    // Send group message about children being added
    const childNames = [];
    for (const childId of childIds) {
      const [[child]] = await db.query('SELECT name FROM Children WHERE id = ?', [childId]);
      if (child) childNames.push(child.name);
    }
    
    const message = `${user.name} added ${childNames.length} child${childNames.length > 1 ? 'ren' : ''} to the group: ${childNames.join(', ')}`;
    await db.query(`
      INSERT INTO ActivityGroupMessages (group_id, sender_id, message, message_type)
      VALUES (?, ?, ?, 'admin_action')
    `, [groupId, userId, message]);
    
    req.session.success = `Successfully added ${addedCount} child${addedCount > 1 ? 'ren' : ''} to the group.`;
    res.redirect(`/groups/${groupId}`);
  } catch (err) {
    console.error('❌ Add children error:', err);
    req.session.error = 'Could not add children to group.';
    res.redirect(`/groups/${req.params.id}`);
  }
});

// POST /groups/:id/message - Send message to group
router.post('/:id/message', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  
  try {
    const groupId = req.params.id;
    const userId = req.session.userId;
    const { message } = req.body;
    
    if (!message || !message.trim()) {
      req.session.error = 'Message cannot be empty.';
      return res.redirect(`/groups/${groupId}`);
    }
    
    // Get user details to check if it's a child user
    const [[user]] = await db.query('SELECT * FROM Users WHERE id = ?', [userId]);
    
    let hasAccess = false;
    
    if (user.role === 'child') {
      // For child users, check if they are assigned to this group as a child
      const [[childMembership]] = await db.query(`
        SELECT agm.*
        FROM ActivityGroupMembers agm
        WHERE agm.group_id = ? AND agm.child_id = ? AND agm.is_active = TRUE
      `, [groupId, user.child_profile_id]);
      
      if (childMembership) {
        hasAccess = true;
      }
    } else {
      // For parent users, check if they are a member
      const [[parentMembership]] = await db.query(`
        SELECT * FROM ActivityGroupMembers 
        WHERE group_id = ? AND user_id = ? AND is_active = TRUE
      `, [groupId, userId]);
      
      if (parentMembership) {
        hasAccess = true;
      }
    }
    
    if (!hasAccess) {
      req.session.error = 'You are not a member of this group.';
      return res.redirect('/groups');
    }
    
    // Send message
    await db.query(`
      INSERT INTO ActivityGroupMessages (group_id, sender_id, message)
      VALUES (?, ?, ?)
    `, [groupId, userId, message.trim()]);
    
    res.redirect(`/groups/${groupId}`);
  } catch (err) {
    console.error('❌ Send group message error:', err);
    req.session.error = 'Could not send message.';
    res.redirect(`/groups/${groupId}`);
  }
});

module.exports = router;
