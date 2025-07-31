// routes/trustedGroups.js
const express = require('express');
const router = express.Router();
const db = require('../db');

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
    
    // Add members to the group
    if (member_ids && member_ids.length > 0) {
      const memberValues = member_ids.map(userId => [groupId, userId]);
      await db.query(`
        INSERT INTO TrustedGroupMembers (group_id, user_id)
        VALUES ?
      `, [memberValues]);
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
    
    // Add member
    await db.query(`
      INSERT INTO TrustedGroupMembers (group_id, user_id)
      VALUES (?, ?)
    `, [groupId, user_id]);
    
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
    
    // Remove member
    await db.query(`
      DELETE FROM TrustedGroupMembers 
      WHERE group_id = ? AND user_id = ?
    `, [groupId, user_id]);
    
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
    
    // Remove user from group
    await db.query(`
      DELETE FROM TrustedGroupMembers 
      WHERE group_id = ? AND user_id = ?
    `, [groupId, userId]);
    
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

module.exports = router; 