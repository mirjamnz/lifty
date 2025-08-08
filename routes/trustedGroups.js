// routes/trustedGroups.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const notifications = require('../utils/notifications');

// GET /trusted-groups/debug-session - Debug session info
router.get('/debug-session', async (req, res) => {
  try {
    const sessionInfo = {
      hasSession: !!req.session,
      userId: req.session && req.session.userId,
      userEmail: req.session && req.session.userEmail,
      userName: req.session && req.session.userName,
      role: req.session && req.session.role,
      sessionId: req.sessionID
    };
    
    if (req.session && req.session.userId) {
      try {
        const [[user]] = await db.query('SELECT * FROM Users WHERE id = ?', [req.session.userId]);
        sessionInfo.userFromDB = user;
        
        const [memberships] = await db.query(`
          SELECT tgm.*, tg.name as group_name
          FROM TrustedGroupMembers tgm
          JOIN TrustedGroups tg ON tgm.group_id = tg.id
          WHERE tgm.user_id = ?
        `, [req.session.userId]);
        sessionInfo.groupMemberships = memberships;
      } catch (err) {
        sessionInfo.error = err.message;
      }
    }
    
    res.json(sessionInfo);
  } catch (err) {
    res.status(500).json({ error: 'Debug endpoint error: ' + err.message });
  }
});

// GET /trusted-groups - Show all trusted groups for the user
router.get('/', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  
  try {
    const userId = req.session.userId;
    
    // Get groups created by the user
    const [myGroups] = await db.query(`
      SELECT 
        tg.*,
        COUNT(tgm.user_id) as member_count
      FROM TrustedGroups tg
      LEFT JOIN TrustedGroupMembers tgm ON tg.id = tgm.group_id
      WHERE tg.creator_id = ?
      GROUP BY tg.id
      ORDER BY tg.created_at DESC
    `, [userId]);
    
    // Get groups where user is a member (but not creator)
    const [memberGroups] = await db.query(`
      SELECT 
        tg.*,
        u.name as creator_name,
        COUNT(tgm2.user_id) as member_count
      FROM TrustedGroups tg
      JOIN TrustedGroupMembers tgm ON tg.id = tgm.group_id
      LEFT JOIN TrustedGroupMembers tgm2 ON tg.id = tgm2.group_id
      JOIN Users u ON tg.creator_id = u.id
      WHERE tgm.user_id = ? AND tg.creator_id != ?
      GROUP BY tg.id
      ORDER BY tg.created_at DESC
    `, [userId, userId]);
    
    // Get all users for adding to groups
    const [allUsers] = await db.query(`
      SELECT id, name, email 
      FROM Users 
      WHERE id != ? AND role = 'parent'
      ORDER BY name
    `, [userId]);
    
    res.render('trusted-groups', {
      session: req.session,
      myGroups,
      memberGroups,
      allUsers
    });
  } catch (err) {
    console.error('❌ Trusted groups error:', err);
    req.session.error = 'Could not load trusted groups.';
    res.redirect('/dashboard');
  }
});

// POST /trusted-groups - Create a new trusted group
router.post('/', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  
  try {
    const { name, description, member_ids } = req.body;
    const creatorId = req.session.userId;
    
    if (!name) {
      req.session.error = 'Group name is required.';
      return res.redirect('/trusted-groups');
    }
    
    // Create the group
    const [result] = await db.query(`
      INSERT INTO TrustedGroups (name, description, creator_id)
      VALUES (?, ?, ?)
    `, [name, description, creatorId]);
    
    const groupId = result.insertId;
    
    // Add members to the group and notify them
    if (member_ids && member_ids.length > 0) {
      const memberValues = member_ids.map(userId => [groupId, userId]);
      await db.query(`
        INSERT INTO TrustedGroupMembers (group_id, user_id)
        VALUES ?
      `, [memberValues]);
      
      // Get creator name for notifications
      const [[creator]] = await db.query('SELECT name FROM Users WHERE id = ?', [creatorId]);
      
      // Notify each added member
      for (const userId of member_ids) {
        await notifications.notifyUserAddedToGroup(groupId, userId, name, creator.name);
      }
    }
    
    req.session.success = `Trusted group "${name}" created successfully!`;
    res.redirect('/trusted-groups');
  } catch (err) {
    console.error('❌ Create trusted group error:', err);
    req.session.error = 'Could not create trusted group.';
    res.redirect('/trusted-groups');
  }
});

// POST /trusted-groups/:id/add-member - Add member to group
router.post('/:id/add-member', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  
  try {
    const groupId = req.params.id;
    const { user_id } = req.body;
    
    // Check if user is the creator of the group
    const [[group]] = await db.query(`
      SELECT * FROM TrustedGroups WHERE id = ? AND creator_id = ?
    `, [groupId, req.session.userId]);
    
    if (!group) {
      req.session.error = 'You can only add members to groups you created.';
      return res.redirect('/trusted-groups');
    }
    
    // Check if user is already a member
    const [[existingMember]] = await db.query(`
      SELECT * FROM TrustedGroupMembers WHERE group_id = ? AND user_id = ?
    `, [groupId, user_id]);
    
    if (existingMember) {
      req.session.error = 'User is already a member of this group.';
      return res.redirect('/trusted-groups');
    }
    
    // Add member
    await db.query(`
      INSERT INTO TrustedGroupMembers (group_id, user_id)
      VALUES (?, ?)
    `, [groupId, user_id]);
    
    // Get creator name for notification
    const [[creator]] = await db.query('SELECT name FROM Users WHERE id = ?', [req.session.userId]);
    
    // Notify the added user
    await notifications.notifyUserAddedToGroup(groupId, user_id, group.name, creator.name);
    
    req.session.success = 'Member added to group successfully!';
    res.redirect('/trusted-groups');
  } catch (err) {
    console.error('❌ Add member error:', err);
    req.session.error = 'Could not add member to group.';
    res.redirect('/trusted-groups');
  }
});

// POST /trusted-groups/:id/remove-member - Remove member from group
router.post('/:id/remove-member', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  
  try {
    const groupId = req.params.id;
    const { user_id } = req.body;
    
    // Check if user is the creator
    const [[group]] = await db.query(`
      SELECT * FROM TrustedGroups WHERE id = ? AND creator_id = ?
    `, [groupId, req.session.userId]);
    
    if (!group) {
      req.session.error = 'You can only remove members from groups you created.';
      return res.redirect('/trusted-groups');
    }
    
    // Get member name for notification
    const [[member]] = await db.query('SELECT name FROM Users WHERE id = ?', [user_id]);
    const [[creator]] = await db.query('SELECT name FROM Users WHERE id = ?', [req.session.userId]);
    
    // Remove member
    await db.query(`
      DELETE FROM TrustedGroupMembers 
      WHERE group_id = ? AND user_id = ?
    `, [groupId, user_id]);
    
    // Notify the removed user
    if (member) {
      await notifications.notifyUserRemovedFromGroup(groupId, user_id, group.name, creator.name);
    }
    
    req.session.success = 'Member removed from group successfully!';
    res.redirect('/trusted-groups');
  } catch (err) {
    console.error('❌ Remove member error:', err);
    req.session.error = 'Could not remove member from group.';
    res.redirect('/trusted-groups');
  }
});

// POST /trusted-groups/:id/leave - Leave a group
router.post('/:id/leave', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  
  try {
    const groupId = req.params.id;
    const userId = req.session.userId;
    
    // Get group info for notification
    const [[group]] = await db.query('SELECT name FROM TrustedGroups WHERE id = ?', [groupId]);
    const [[user]] = await db.query('SELECT name FROM Users WHERE id = ?', [userId]);
    
    // Remove user from group
    await db.query(`
      DELETE FROM TrustedGroupMembers 
      WHERE group_id = ? AND user_id = ?
    `, [groupId, userId]);
    
    // Notify group creator about the leave
    const [[creator]] = await db.query('SELECT creator_id FROM TrustedGroups WHERE id = ?', [groupId]);
    if (creator && creator.creator_id !== userId) {
      await notifications.createNotification(
        creator.creator_id,
        'group_removal',
        'Member Left Group',
        `${user.name} has left the "${group.name}" group.`,
        'trusted_group',
        groupId
      );
    }
    
    req.session.success = 'You have left the group successfully!';
    res.redirect('/trusted-groups');
  } catch (err) {
    console.error('❌ Leave group error:', err);
    req.session.error = 'Could not leave group.';
    res.redirect('/trusted-groups');
  }
});

// DELETE /trusted-groups/:id - Delete a group (creator only)
router.delete('/:id', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  
  try {
    const groupId = req.params.id;
    
    // Check if user is the creator
    const [[group]] = await db.query(`
      SELECT * FROM TrustedGroups WHERE id = ? AND creator_id = ?
    `, [groupId, req.session.userId]);
    
    if (!group) {
      req.session.error = 'You can only delete groups you created.';
      return res.redirect('/trusted-groups');
    }
    
    // Get all members to notify them
    const [members] = await db.query(`
      SELECT user_id FROM TrustedGroupMembers WHERE group_id = ?
    `, [groupId]);
    
    const [[creator]] = await db.query('SELECT name FROM Users WHERE id = ?', [req.session.userId]);
    
    // Notify all members about group deletion
    for (const member of members) {
      await notifications.createNotification(
        member.user_id,
        'group_removal',
        'Group Deleted',
        `The trusted group "${group.name}" has been deleted by ${creator.name}.`,
        'trusted_group',
        groupId
      );
    }
    
    // Delete the group (cascades to members and requests)
    await db.query('DELETE FROM TrustedGroups WHERE id = ?', [groupId]);
    
    req.session.success = `Group "${group.name}" deleted successfully!`;
    res.redirect('/trusted-groups');
  } catch (err) {
    console.error('❌ Delete group error:', err);
    req.session.error = 'Could not delete group.';
    res.redirect('/trusted-groups');
  }
});

// GET /trusted-groups/recent-requests - Get recent ride requests for user's groups
router.get('/recent-requests', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  
  try {
    const userId = req.session.userId;
    
    // Get recent ride requests from groups user is a member of
    const [recentRequests] = await db.query(`
      SELECT 
        snr.*,
        tg.name as group_name,
        u.name as requester_name,
        COUNT(snresp.id) as response_count
      FROM ShortNoticeRequests snr
      JOIN TrustedGroups tg ON snr.group_id = tg.id
      JOIN TrustedGroupMembers tgm ON tg.id = tgm.group_id
      JOIN Users u ON snr.requester_id = u.id
      LEFT JOIN ShortNoticeResponses snresp ON snr.id = snresp.request_id
      WHERE tgm.user_id = ?
      GROUP BY snr.id
      ORDER BY snr.created_at DESC
      LIMIT 10
    `, [userId]);
    
    res.json({ requests: recentRequests });
  } catch (err) {
    console.error('❌ Get recent requests error:', err);
    res.status(500).json({ error: 'Could not load recent requests' });
  }
});

// GET /trusted-groups/:id/members - Get group members
router.get('/:id/members', async (req, res) => {
  if (!req.session.userId) {
    console.log('❌ No session userId found');
    return res.status(401).json({ error: 'Not logged in - no session found' });
  }
  
  try {
    const groupId = req.params.id;
    const userId = req.session.userId;
    
    // Check if user exists
    const [[user]] = await db.query('SELECT * FROM Users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(403).json({ error: `User ${userId} not found` });
    }
    
    // Check if user is a member of this group OR is the creator
    const [[membership]] = await db.query(`
      SELECT tgm.*, tg.name as group_name, tg.creator_id
      FROM TrustedGroupMembers tgm
      JOIN TrustedGroups tg ON tgm.group_id = tg.id
      WHERE tgm.group_id = ? AND tgm.user_id = ?
    `, [groupId, userId]);
    
    // Also check if user is the creator
    const [[creatorCheck]] = await db.query(`
      SELECT * FROM TrustedGroups WHERE id = ? AND creator_id = ?
    `, [groupId, userId]);
    
    if (!membership && !creatorCheck) {
      return res.status(403).json({ 
        error: `You are not a member of this group`,
        userId: userId,
        groupId: groupId
      });
    }
    
    // Get group details
    const [[group]] = await db.query(`
      SELECT * FROM TrustedGroups WHERE id = ?
    `, [groupId]);
    
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    // Get all members with their details
    const [members] = await db.query(`
      SELECT 
        u.id,
        u.name,
        u.email,
        tgm.added_at as joined_at,
        CASE WHEN tg.creator_id = u.id THEN 'Creator' ELSE 'Member' END as role
      FROM TrustedGroupMembers tgm
      JOIN Users u ON tgm.user_id = u.id
      JOIN TrustedGroups tg ON tgm.group_id = tg.id
      WHERE tgm.group_id = ?
      ORDER BY 
        CASE WHEN tg.creator_id = u.id THEN 0 ELSE 1 END,
        u.name
    `, [groupId]);
    

    
    res.json({
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        creator_id: group.creator_id
      },
      members: members
    });
  } catch (err) {
    console.error('❌ Get group members error:', err);
    res.status(500).json({ error: 'Could not load group members' });
  }
});

module.exports = router; 