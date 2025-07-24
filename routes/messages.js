const express = require('express');
const router = express.Router();
const db = require('../db');

// POST /messages/send - Send a message
router.post('/send', async (req, res) => {
  const senderId = req.session.userId;
  const { target_type, target_id, message, include_child } = req.body;

  if (!senderId || !target_type || !target_id || !message) {
    return res.status(400).send('Missing required fields.');
  }

  // If include_child is checked and this is a ride request, send as group message
  if (include_child && target_type === 'request') {
    // Insert group message (recipient_id=NULL, related_type='request', related_id=target_id)
    await db.query(
      'INSERT INTO Messages (sender_id, recipient_id, content, related_type, related_id) VALUES (?, NULL, ?, ?, ?)',
      [senderId, message, 'request', target_id]
    );
    return res.redirect(req.get('Referer') || '/messages/inbox');
  }

  // Otherwise, send as direct message as before
  let recipientId = null;
  if (target_type === 'request') {
    // Message about a ride request
    const [[request]] = await db.query('SELECT user_id FROM RideRequests WHERE id = ?', [target_id]);
    if (!request) return res.status(404).send('Request not found.');
    recipientId = request.user_id;
  } else if (target_type === 'offer') {
    // Message about a ride offer
    const [[offer]] = await db.query('SELECT user_id FROM RideOffers WHERE id = ?', [target_id]);
    if (!offer) return res.status(404).send('Offer not found.');
    recipientId = offer.user_id;
  } else {
    return res.status(400).send('Invalid target type.');
  }

  if (recipientId === senderId) {
    return res.status(400).send('Cannot message yourself.');
  }

  await db.query(
    'INSERT INTO Messages (sender_id, recipient_id, content, related_type, related_id) VALUES (?, ?, ?, ?, ?)',
    [senderId, recipientId, message, target_type, target_id]
  );

  res.redirect(req.get('Referer') || '/messages/inbox');
});

// GET /messages/inbox - Get messages for the logged-in user
router.get('/inbox', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).send('Not logged in');

  // Get regular messages
  const [messages] = await db.query(
    `SELECT m.*, u.name AS sender_name
     FROM Messages m
     JOIN Users u ON m.sender_id = u.id
     WHERE m.recipient_id = ?
     ORDER BY m.sent_at DESC
     LIMIT 100`,
    [userId]
  );

  // Get group invitations for this user
  const [groupInvitations] = await db.query(`
    SELECT egi.*, re.name AS event_name, re.day_of_week, re.start_time, re.end_time, re.location, u.name AS inviter_name
    FROM EventGroupInvitations egi
    JOIN RecurringEvents re ON egi.event_id = re.id
    JOIN Users u ON egi.inviter_id = u.id
    WHERE egi.invitee_email = (SELECT email FROM Users WHERE id = ?) AND egi.status = 'pending'
    ORDER BY egi.invited_at DESC
  `, [userId]);

  res.render('messages-inbox', { 
    session: req.session, 
    messages,
    groupInvitations
  });
});

// POST /messages/read/:id - Mark a message as read
router.post('/read/:id', async (req, res) => {
  const userId = req.session.userId;
  const messageId = req.params.id;
  if (!userId) return res.status(401).send('Not logged in');

  await db.query(
    'UPDATE Messages SET read_at = NOW() WHERE id = ? AND recipient_id = ?',
    [messageId, userId]
  );

  res.sendStatus(200);
});

// GET /messages/sent - Get sent messages for the logged-in user
router.get('/sent', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).send('Not logged in');

  const [messages] = await db.query(
    `SELECT m.*, u.name AS recipient_name
     FROM Messages m
     JOIN Users u ON m.recipient_id = u.id
     WHERE m.sender_id = ?
     ORDER BY m.sent_at DESC
     LIMIT 100`,
    [userId]
  );

  res.render('messages-sent', { session: req.session, messages });
});

// GET /messages/thread/:userId - Show chat thread between logged-in user and another user
router.get('/thread/:userId', async (req, res) => {
  const userId = req.session.userId;
  const otherUserId = req.params.userId;
  if (!userId) return res.status(401).send('Not logged in');
  if (!otherUserId) return res.status(400).send('Missing userId');

  // Get the other user's name
  const [[otherUser]] = await db.query('SELECT id, name FROM Users WHERE id = ?', [otherUserId]);
  if (!otherUser) return res.status(404).send('User not found');

  // Get all messages between the two users
  const [messages] = await db.query(
    `SELECT m.*, u1.name AS sender_name, u2.name AS recipient_name
     FROM Messages m
     JOIN Users u1 ON m.sender_id = u1.id
     JOIN Users u2 ON m.recipient_id = u2.id
     WHERE (m.sender_id = ? AND m.recipient_id = ?)
        OR (m.sender_id = ? AND m.recipient_id = ?)
     ORDER BY m.sent_at ASC`,
    [userId, otherUserId, otherUserId, userId]
  );

  // Mark all messages from otherUser as read
  await db.query(
    'UPDATE Messages SET read_at = NOW() WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL',
    [otherUserId, userId]
  );

  res.render('messages-thread', {
    session: req.session,
    messages,
    otherUser
  });
});

// POST /messages/thread/:userId/reply - Send a reply in a thread
router.post('/thread/:userId/reply', async (req, res) => {
  const senderId = req.session.userId;
  const recipientId = req.params.userId;
  const { message } = req.body;
  if (!senderId || !recipientId || !message) {
    return res.status(400).send('Missing required fields.');
  }
  await db.query(
    'INSERT INTO Messages (sender_id, recipient_id, content) VALUES (?, ?, ?)',
    [senderId, recipientId, message]
  );
  res.redirect(`/messages/thread/${recipientId}`);
});

// GROUP CHAT FOR ASSIGNED RIDE
// GET /messages/group/ride/:rideRequestId
router.get('/group/ride/:rideRequestId', async (req, res) => {
  const userId = req.session.userId;
  const userRole = req.session.role;
  const rideRequestId = req.params.rideRequestId;
  if (!userId || !rideRequestId) return res.status(401).send('Not logged in');

  // Get ride request and involved users
  const [[ride]] = await db.query('SELECT * FROM RideRequests WHERE id = ?', [rideRequestId]);
  if (!ride) return res.status(404).send('Ride request not found');
  const [[child]] = await db.query('SELECT * FROM Children WHERE id = ?', [ride.child_id]);
  const [[childUser]] = await db.query('SELECT * FROM Users WHERE child_profile_id = ?', [child.id]);
  
  // Get all parents of this child (support multiple parents via ParentChild)
  const [parentLinks] = await db.query('SELECT parent_id FROM ParentChild WHERE child_id = ?', [child.id]);
  const parentIds = parentLinks.map(p => p.parent_id);
  const parentUsers = [];
  if (parentIds.length > 0) {
    const [parents] = await db.query('SELECT * FROM Users WHERE id IN (?)', [parentIds]);
    parentUsers.push(...parents);
  }
  
  const [[driverUser]] = ride.assigned_user_id ? await db.query('SELECT * FROM Users WHERE id = ?', [ride.assigned_user_id]) : [null];

  // Allow child, any parent (via ParentChild), or assigned driver
  const allowedUserIds = [
    childUser?.id, 
    ...parentIds, 
    driverUser?.id
  ].filter(Boolean);
  
  if (!allowedUserIds.includes(userId)) return res.status(403).send('Access denied');

  // Get all group messages for this ride
  const [messages] = await db.query(
    `SELECT m.*, u.name AS sender_name
     FROM Messages m
     JOIN Users u ON m.sender_id = u.id
     WHERE m.related_type = 'request' AND m.related_id = ?
     ORDER BY m.sent_at ASC`,
    [rideRequestId]
  );

  // Mark all group messages as read for this user
  await db.query(
    'UPDATE Messages SET read_at = NOW() WHERE related_type = "request" AND related_id = ? AND sender_id != ? AND read_at IS NULL',
    [rideRequestId, userId]
  );

  // For display: get names (use first parent for display purposes)
  const parentUser = parentUsers[0] || null;
  
  res.render('messages-group', {
    session: req.session,
    ride,
    child,
    parentUser,
    driverUser,
    messages,
    eventType: 'ride'
  });
});

// POST /messages/group/ride/:rideRequestId/send - Send message to group chat
router.post('/group/ride/:rideRequestId/send', async (req, res) => {
  const senderId = req.session.userId;
  const rideRequestId = req.params.rideRequestId;
  const { message } = req.body;
  if (!senderId || !rideRequestId || !message) return res.status(400).send('Missing required fields.');

  // Get ride request and involved users
  const [[ride]] = await db.query('SELECT * FROM RideRequests WHERE id = ?', [rideRequestId]);
  if (!ride) return res.status(404).send('Ride request not found');
  const [[child]] = await db.query('SELECT * FROM Children WHERE id = ?', [ride.child_id]);
  const [[childUser]] = await db.query('SELECT * FROM Users WHERE child_profile_id = ?', [child.id]);
  
  // Get all parents of this child (support multiple parents)
  // Find the parent user for this child (Children.user_id points to parent)
  const [[parentUserLookup]] = await db.query('SELECT * FROM Users WHERE id = ?', [child.user_id]);
  const parentUsers = parentUserLookup ? [parentUserLookup] : [];
  
  const [[driverUser]] = ride.assigned_user_id ? await db.query('SELECT * FROM Users WHERE id = ?', [ride.assigned_user_id]) : [null];
  
  // Allow child, any parent, or assigned driver
  const allowedUserIds = [
    childUser?.id, 
    ...parentUsers.map(p => p.id), 
    driverUser?.id
  ].filter(Boolean);
  
  if (!allowedUserIds.includes(senderId)) return res.status(403).send('Access denied');

  // Send message to all group members (store as related_type='request', related_id=rideRequestId)
  // For group chat, store one message per send, all can read
  // Note: recipient_id is NULL for group chat messages
  await db.query(
    'INSERT INTO Messages (sender_id, recipient_id, content, related_type, related_id) VALUES (?, NULL, ?, ?, ?)',
    [senderId, message, 'request', rideRequestId]
  );
  res.redirect(`/messages/group/ride/${rideRequestId}`);
});

// GROUP CHAT FOR RIDE OFFER
// GET /messages/group/offer/:offerId
router.get('/group/offer/:offerId', async (req, res) => {
  const userId = req.session.userId;
  const offerId = req.params.offerId;
  if (!userId || !offerId) return res.status(401).send('Not logged in');

  // Get the ride offer
  const [[offer]] = await db.query('SELECT * FROM RideOffers WHERE id = ?', [offerId]);
  if (!offer) return res.status(404).send('Ride offer not found');

  // Get the driver
  const [[driverUser]] = await db.query('SELECT * FROM Users WHERE id = ?', [offer.user_id]);

  // Get all bookings for this offer
  const [bookings] = await db.query('SELECT * FROM RideBookings WHERE offer_id = ? AND status = "confirmed"', [offerId]);
  const bookedChildIds = bookings.map(b => b.child_id);
  const bookedParentIds = bookings.map(b => b.user_id);

  // Get all parents of booked children (via ParentChild)
  let parentIds = new Set();
  if (bookedChildIds.length > 0) {
    const [parents] = await db.query('SELECT parent_id FROM ParentChild WHERE child_id IN (?)', [bookedChildIds]);
    parents.forEach(p => parentIds.add(p.parent_id));
  }
  // Add the driver
  parentIds.add(offer.user_id);
  // Add the booking parents (in case not in ParentChild)
  bookedParentIds.forEach(pid => parentIds.add(pid));

  // Only allow access for driver or any parent
  if (!parentIds.has(userId)) return res.status(403).send('Access denied');

  // Get all group messages for this offer
  const [messages] = await db.query(
    `SELECT m.*, u.name AS sender_name
     FROM Messages m
     JOIN Users u ON m.sender_id = u.id
     WHERE m.related_type = 'offer' AND m.related_id = ?
     ORDER BY m.sent_at ASC`,
    [offerId]
  );

  // Mark all group messages as read for this user
  await db.query(
    'UPDATE Messages SET read_at = NOW() WHERE related_type = "offer" AND related_id = ? AND sender_id != ? AND read_at IS NULL',
    [offerId, userId]
  );

  res.render('messages-group', {
    session: req.session,
    offer,
    driverUser,
    messages,
    eventType: 'offer'
  });
});

// POST /messages/group/offer/:offerId/send - Send message to group chat for offer
router.post('/group/offer/:offerId/send', async (req, res) => {
  const senderId = req.session.userId;
  const offerId = req.params.offerId;
  const { message } = req.body;
  if (!senderId || !offerId || !message) return res.status(400).send('Missing required fields.');

  // Get the ride offer
  const [[offer]] = await db.query('SELECT * FROM RideOffers WHERE id = ?', [offerId]);
  if (!offer) return res.status(404).send('Ride offer not found');

  // Get all bookings for this offer
  const [bookings] = await db.query('SELECT * FROM RideBookings WHERE offer_id = ? AND status = "confirmed"', [offerId]);
  const bookedChildIds = bookings.map(b => b.child_id);
  const bookedParentIds = bookings.map(b => b.user_id);

  // Get all parents of booked children (via ParentChild)
  let parentIds = new Set();
  if (bookedChildIds.length > 0) {
    const [parents] = await db.query('SELECT parent_id FROM ParentChild WHERE child_id IN (?)', [bookedChildIds]);
    parents.forEach(p => parentIds.add(p.parent_id));
  }
  // Add the driver
  parentIds.add(offer.user_id);
  // Add the booking parents
  bookedParentIds.forEach(pid => parentIds.add(pid));

  // Only allow access for driver or any parent
  if (!parentIds.has(senderId)) return res.status(403).send('Access denied');

  // Send message to all group members (store as related_type='offer', related_id=offerId)
  await db.query(
    'INSERT INTO Messages (sender_id, recipient_id, content, related_type, related_id) VALUES (?, NULL, ?, ?, ?)',
    [senderId, message, 'offer', offerId]
  );
  res.redirect(`/messages/group/offer/${offerId}`);
});

// GET /messages/group/recurring/:eventId - Get group messages for a recurring event
router.get('/group/recurring/:eventId', async (req, res) => {
  const userId = req.session.userId;
  const eventId = req.params.eventId;
  
  if (!userId) return res.status(401).send('Not logged in');

  try {
    // Check if user is a child and has assignments to this event
    const [[user]] = await db.query('SELECT * FROM Users WHERE id = ?', [userId]);
    if (user.role !== 'child') {
      return res.status(403).send('Access denied. This route is for children only.');
    }

    // Check if child has assignments to this event
    const [assignments] = await db.query(`
      SELECT ea.*, re.name AS event_name, re.location, re.day_of_week, re.start_time, re.end_time
      FROM EventAssignments ea
      JOIN RecurringEvents re ON ea.event_id = re.id
      WHERE ea.event_id = ? AND ea.child_id = ? AND ea.status != 'cancelled' AND ea.is_cancelled = FALSE
    `, [eventId, user.child_profile_id]);

    if (assignments.length === 0) {
      return res.status(403).send('You do not have access to this event group.');
    }

    // Get event details
    const [[event]] = await db.query(`
      SELECT re.*, u.name AS created_by_name
      FROM RecurringEvents re
      JOIN Users u ON re.created_by = u.id
      WHERE re.id = ?
    `, [eventId]);

    if (!event) {
      return res.status(404).send('Event not found.');
    }

    // Get group messages
    const [messages] = await db.query(`
      SELECT egm.*, u.name AS sender_name
      FROM EventGroupMessages egm
      JOIN Users u ON egm.sender_id = u.id
      WHERE egm.event_id = ?
      ORDER BY egm.sent_at ASC
    `, [eventId]);

    // Get group members (parents only, not children)
    const [members] = await db.query(`
      SELECT egm.*, u.name AS user_name, u.email
      FROM EventGroupMembers egm
      JOIN Users u ON egm.user_id = u.id
      WHERE egm.event_id = ? AND egm.is_active = TRUE AND egm.child_id IS NULL
      ORDER BY egm.role DESC, u.name
    `, [eventId]);

    res.render('messages-group', {
      session: req.session,
      messages,
      members,
      event,
      eventType: 'recurring',
      eventId: eventId,
      childName: assignments[0].child_name || 'Child'
    });

  } catch (err) {
    console.error('Recurring event group messages error:', err);
    res.status(500).send('Error loading group messages.');
  }
});

// POST /messages/group/recurring/:eventId/send - Send message to recurring event group chat
router.post('/group/recurring/:eventId/send', async (req, res) => {
  const userId = req.session.userId;
  const eventId = req.params.eventId;
  const { message } = req.body;

  if (!userId || !message || !message.trim()) {
    return res.status(400).send('Message cannot be empty.');
  }

  try {
    // Check if user is a child and has assignments to this event
    const [[user]] = await db.query('SELECT * FROM Users WHERE id = ?', [userId]);
    if (user.role !== 'child') {
      return res.status(403).send('Access denied. This route is for children only.');
    }

    // Check if child has assignments to this event
    const [assignments] = await db.query(`
      SELECT ea.* FROM EventAssignments ea
      WHERE ea.event_id = ? AND ea.child_id = ? AND ea.status != 'cancelled' AND ea.is_cancelled = FALSE
    `, [eventId, user.child_profile_id]);

    if (assignments.length === 0) {
      return res.status(403).send('You do not have access to this event group.');
    }

    // Insert the message
    await db.query(
      'INSERT INTO EventGroupMessages (event_id, sender_id, message, message_type) VALUES (?, ?, ?, ?)',
      [eventId, userId, message.trim(), 'chat']
    );

    res.redirect(`/messages/group/recurring/${eventId}`);
  } catch (err) {
    console.error('Send recurring event group message error:', err);
    res.status(500).send('Error sending message.');
  }
});

// GET /messages/all - Get all messages (direct + group) for the logged-in user
router.get('/all', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).send('Not logged in');

  // Get direct messages
  const [directMessages] = await db.query(
    `SELECT m.*, u.name AS sender_name, 'direct' as message_type
     FROM Messages m
     JOIN Users u ON m.sender_id = u.id
     WHERE m.recipient_id = ?
     ORDER BY m.sent_at DESC
     LIMIT 50`,
    [userId]
  );

  // Get group messages where user is involved
  const [groupRides] = await db.query(`
    SELECT DISTINCT rr.id as ride_id, rr.pickup_location, rr.dropoff_location, c.name as child_name
    FROM RideRequests rr
    JOIN Children c ON rr.child_id = c.id
    JOIN Users childUser ON childUser.child_profile_id = c.id
    WHERE childUser.id = ? OR c.user_id = ? OR rr.assigned_user_id = ?
  `, [userId, userId, userId]);

  let groupThreads = [];
  if (groupRides.length > 0) {
    const rideIds = groupRides.map(r => r.ride_id);
    
    // Get all group messages for these rides
    const [allGroupMessages] = await db.query(
      `SELECT m.*, u.name AS sender_name, 'group' as message_type, 
              rr.pickup_location, rr.dropoff_location, c.name as child_name
       FROM Messages m
       JOIN Users u ON m.sender_id = u.id
       JOIN RideRequests rr ON m.related_id = rr.id
       JOIN Children c ON rr.child_id = c.id
       WHERE m.related_type = "request" AND m.related_id IN (?)
       ORDER BY m.sent_at ASC`,
      [rideIds]
    );

    // Group messages by ride_id
    const groupedByRide = {};
    allGroupMessages.forEach(msg => {
      if (!groupedByRide[msg.related_id]) {
        groupedByRide[msg.related_id] = {
          ride_id: msg.related_id,
          child_name: msg.child_name,
          pickup_location: msg.pickup_location,
          dropoff_location: msg.dropoff_location,
          messages: [],
          unread_count: 0,
          latest_message: null
        };
      }
      groupedByRide[msg.related_id].messages.push(msg);
      
      // Count unread messages (excluding user's own messages)
      if (!msg.read_at && msg.sender_id !== userId) {
        groupedByRide[msg.related_id].unread_count++;
      }
      
      // Track latest message
      if (!groupedByRide[msg.related_id].latest_message || 
          new Date(msg.sent_at) > new Date(groupedByRide[msg.related_id].latest_message.sent_at)) {
        groupedByRide[msg.related_id].latest_message = msg;
      }
    });

    // Convert to array and sort by latest message time
    groupThreads = Object.values(groupedByRide)
      .sort((a, b) => new Date(b.latest_message.sent_at) - new Date(a.latest_message.sent_at));
  }

  // Combine direct messages and group threads
  const allItems = [
    ...directMessages.map(msg => ({ type: 'direct', data: msg })),
    ...groupThreads.map(thread => ({ type: 'group_thread', data: thread }))
  ].sort((a, b) => {
    const aTime = a.type === 'direct' ? a.data.sent_at : a.data.latest_message.sent_at;
    const bTime = b.type === 'direct' ? b.data.sent_at : b.data.latest_message.sent_at;
    return new Date(bTime) - new Date(aTime);
  });

  res.render('messages-all', { 
    session: req.session, 
    items: allItems,
    directCount: directMessages.length,
    groupCount: groupThreads.length
  });
});

module.exports = router; 