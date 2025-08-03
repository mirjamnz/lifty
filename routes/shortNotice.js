// routes/shortNotice.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const notifications = require('../utils/notifications');

// GET /short-notice - Show short-notice requests page
router.get('/', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  
  try {
    const userId = req.session.userId;
    
    // Get user's trusted groups (both groups they're a member of and groups they created)
    const [trustedGroups] = await db.query(`
      SELECT 
        tg.*,
        COUNT(tgm2.user_id) as member_count
      FROM TrustedGroups tg
      LEFT JOIN TrustedGroupMembers tgm ON tg.id = tgm.group_id
      LEFT JOIN TrustedGroupMembers tgm2 ON tg.id = tgm2.group_id
      WHERE tgm.user_id = ? OR tg.creator_id = ?
      GROUP BY tg.id
      ORDER BY tg.name
    `, [userId, userId]);
    
    // Get pending requests sent by user
    const [myRequests] = await db.query(`
      SELECT 
        snr.*,
        tg.name as group_name,
        COUNT(snresp.id) as response_count
      FROM ShortNoticeRequests snr
      JOIN TrustedGroups tg ON snr.group_id = tg.id
      LEFT JOIN ShortNoticeResponses snresp ON snr.id = snresp.request_id
      WHERE snr.requester_id = ?
      GROUP BY snr.id
      ORDER BY snr.created_at DESC
    `, [userId]);
    
    // Get pending requests for groups user is in
    const [pendingRequests] = await db.query(`
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
      WHERE tgm.user_id = ? AND snr.requester_id != ? AND snr.status = 'pending'
      GROUP BY snr.id
      ORDER BY snr.created_at DESC
    `, [userId, userId]);
    
    res.render('short-notice', {
      session: req.session,
      trustedGroups,
      myRequests,
      pendingRequests
    });
  } catch (err) {
    console.error('❌ Short notice error:', err);
    req.session.error = 'Could not load short-notice requests.';
    res.redirect('/dashboard');
  }
});

// POST /short-notice - Create a new short-notice request
router.post('/', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  
  try {
    const { 
      group_id, 
      message 
    } = req.body;
    
    if (!group_id) {
      req.session.error = 'Please select a target group.';
      return res.redirect('/short-notice');
    }
    
    // Check if user is a member of the group
    const [[membership]] = await db.query(`
      SELECT * FROM TrustedGroupMembers 
      WHERE group_id = ? AND user_id = ?
    `, [group_id, req.session.userId]);
    
    if (!membership) {
      req.session.error = 'You must be a member of the group to send requests.';
      return res.redirect('/short-notice');
    }
    
    // Set default times (current time + 1 hour for pickup, + 2 hours for dropoff)
    const now = new Date();
    const pickupTime = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now
    const dropoffTime = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours from now
    
    // Create the request with default values
    const [result] = await db.query(`
      INSERT INTO ShortNoticeRequests (
        requester_id, group_id, pickup_time, dropoff_time, 
        pickup_location, dropoff_location, message
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [req.session.userId, group_id, pickupTime, dropoffTime, 
        'To be arranged', 'To be arranged', message || '']);
    
    const requestId = result.insertId;
    
    // Get requester name and group name for notification
    const [[requester]] = await db.query('SELECT name FROM Users WHERE id = ?', [req.session.userId]);
    const [[group]] = await db.query('SELECT name FROM TrustedGroups WHERE id = ?', [group_id]);
    
    // Notify group members about the new ride request
    await notifications.notifyGroupAboutRideRequest(
      group_id, 
      requestId, 
      requester.name, 
      pickupTime, 
      'To be arranged', 
      'To be arranged'
    );
    
    req.session.success = 'Short-notice request sent successfully!';
    res.redirect('/short-notice');
  } catch (err) {
    console.error('❌ Create short notice request error:', err);
    req.session.error = 'Could not create short-notice request.';
    res.redirect('/short-notice');
  }
});

// POST /short-notice/:id/respond - Respond to a short-notice request
router.post('/:id/respond', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  
  try {
    const requestId = req.params.id;
    const { response_type, message } = req.body;
    
    // Check if user is a member of the group
    const [[request]] = await db.query(`
      SELECT snr.*, tgm.user_id as member_id, tg.name as group_name
      FROM ShortNoticeRequests snr
      JOIN TrustedGroupMembers tgm ON snr.group_id = tgm.group_id
      JOIN TrustedGroups tg ON snr.group_id = tg.id
      WHERE snr.id = ? AND tgm.user_id = ?
    `, [requestId, req.session.userId]);
    
    if (!request) {
      req.session.error = 'You can only respond to requests from groups you are a member of.';
      return res.redirect('/short-notice');
    }
    
    // Check if user already responded
    const [[existingResponse]] = await db.query(`
      SELECT * FROM ShortNoticeResponses 
      WHERE request_id = ? AND responder_id = ?
    `, [requestId, req.session.userId]);
    
    if (existingResponse) {
      req.session.error = 'You have already responded to this request.';
      return res.redirect('/short-notice');
    }
    
    // Add response
    await db.query(`
      INSERT INTO ShortNoticeResponses (request_id, responder_id, response_type, message)
      VALUES (?, ?, ?, ?)
    `, [requestId, req.session.userId, response_type, message]);
    
    // Get responder name for notification
    const [[responder]] = await db.query('SELECT name FROM Users WHERE id = ?', [req.session.userId]);
    
    // If someone accepted, update the request status
    if (response_type === 'ok' || response_type === 'ok_with_message') {
      await db.query(`
        UPDATE ShortNoticeRequests 
        SET status = 'accepted', accepted_by = ?
        WHERE id = ?
      `, [req.session.userId, requestId]);
    }
    
    // Notify the requester about the response
    await notifications.notifyRideRequestResponse(
      requestId, 
      responder.name, 
      response_type, 
      request.group_name
    );
    
    req.session.success = 'Response sent successfully!';
    res.redirect('/short-notice');
  } catch (err) {
    console.error('❌ Respond to request error:', err);
    req.session.error = 'Could not respond to request.';
    res.redirect('/short-notice');
  }
});

// GET /short-notice/:id - View details of a specific request
router.get('/:id', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  
  try {
    const requestId = req.params.id;
    
    // Get request details
    const [[request]] = await db.query(`
      SELECT 
        snr.*,
        tg.name as group_name,
        u.name as requester_name,
        u.email as requester_email
      FROM ShortNoticeRequests snr
      JOIN TrustedGroups tg ON snr.group_id = tg.id
      JOIN Users u ON snr.requester_id = u.id
      WHERE snr.id = ?
    `, [requestId]);
    
    if (!request) {
      req.session.error = 'Request not found.';
      return res.redirect('/short-notice');
    }
    
    // Check if user is a member of the group
    const [[membership]] = await db.query(`
      SELECT * FROM TrustedGroupMembers 
      WHERE group_id = ? AND user_id = ?
    `, [request.group_id, req.session.userId]);
    
    if (!membership) {
      req.session.error = 'You do not have access to this request.';
      return res.redirect('/short-notice');
    }
    
    // Get responses
    const [responses] = await db.query(`
      SELECT 
        snresp.*,
        u.name as responder_name
      FROM ShortNoticeResponses snresp
      JOIN Users u ON snresp.responder_id = u.id
      WHERE snresp.request_id = ?
      ORDER BY snresp.responded_at
    `, [requestId]);
    
    // Check if user has already responded
    const [[userResponse]] = await db.query(`
      SELECT * FROM ShortNoticeResponses 
      WHERE request_id = ? AND responder_id = ?
    `, [requestId, req.session.userId]);
    
    res.render('short-notice-detail', {
      session: req.session,
      request,
      responses,
      userResponse
    });
  } catch (err) {
    console.error('❌ Short notice detail error:', err);
    req.session.error = 'Could not load request details.';
    res.redirect('/short-notice');
  }
});

// API endpoint to get suggested parents from existing activities
router.get('/api/suggested-parents', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  
  try {
    const userId = req.session.userId;
    
    // Get parents from recurring events where user is involved
    const [recurringParents] = await db.query(`
      SELECT DISTINCT
        u.id,
        u.name,
        u.email,
        'recurring_event' as source
      FROM Users u
      JOIN EventAssignments ea ON u.id = ea.user_id
      JOIN EventInstances ei ON ea.event_id = ei.event_id AND ea.event_date = ei.event_date
      JOIN RecurringEventGroups reg ON ei.event_id = reg.id
      WHERE reg.creator_id = ? OR ea.user_id = ?
      AND u.id != ?
      AND u.role = 'parent'
    `, [userId, userId, userId]);
    
    // Get parents from ride requests where user is involved
    const [rideParents] = await db.query(`
      SELECT DISTINCT
        u.id,
        u.name,
        u.email,
        'ride_request' as source
      FROM Users u
      JOIN RideRequests rr ON u.id = rr.user_id OR u.id = rr.assigned_user_id
      WHERE (rr.user_id = ? OR rr.assigned_user_id = ?)
      AND u.id != ?
      AND u.role = 'parent'
    `, [userId, userId, userId]);
    
    // Get parents from organizations where both users are affiliated
    const [orgParents] = await db.query(`
      SELECT DISTINCT
        u.id,
        u.name,
        u.email,
        'organization' as source
      FROM Users u
      JOIN UserAffiliations ua1 ON u.id = ua1.user_id
      JOIN UserAffiliations ua2 ON ua1.organization_id = ua2.organization_id
      WHERE ua2.user_id = ?
      AND u.id != ?
      AND u.role = 'parent'
    `, [userId, userId]);
    
    // Combine and deduplicate
    const allParents = [...recurringParents, ...rideParents, ...orgParents];
    const uniqueParents = allParents.filter((parent, index, self) => 
      index === self.findIndex(p => p.id === parent.id)
    );
    
    res.json({ parents: uniqueParents });
  } catch (err) {
    console.error('❌ Suggested parents error:', err);
    res.status(500).json({ error: 'Could not get suggested parents' });
  }
});

module.exports = router; 