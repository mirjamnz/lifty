const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /recurring-events - List all recurring events
router.get('/', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.redirect('/login');

  try {
    // Get all active events
    const [events] = await db.query(
      `SELECT re.*, u.name AS created_by_name,
              (SELECT COUNT(*) FROM EventSubscriptions WHERE event_id = re.id) AS subscriber_count,
              (SELECT COUNT(*) FROM EventGroupMembers WHERE event_id = re.id AND is_active = TRUE) AS group_member_count
       FROM RecurringEvents re
       JOIN Users u ON re.created_by = u.id
       WHERE re.is_active = TRUE
       ORDER BY re.day_of_week, re.start_time`
    );

    // Get user's children (using ParentChild join)
    const [children] = await db.query(`
      SELECT c.* FROM Children c
      JOIN ParentChild pc ON pc.child_id = c.id
      WHERE pc.parent_id = ?
    `, [userId]);

    // Get user's subscriptions (individual events)
    const [subscriptions] = await db.query(
      `SELECT es.*, re.name AS event_name, c.name AS child_name
       FROM EventSubscriptions es
       JOIN RecurringEvents re ON es.event_id = re.id
       JOIN Children c ON es.child_id = c.id
       WHERE es.user_id = ?`,
      [userId]
    );

    // Get user's group memberships
    const [groupMemberships] = await db.query(`
      SELECT egm.*, re.name AS event_name, re.is_group_event, c.name AS child_name
      FROM EventGroupMembers egm
      JOIN RecurringEvents re ON egm.event_id = re.id
      LEFT JOIN Children c ON egm.child_id = c.id
      WHERE egm.user_id = ? AND egm.is_active = TRUE
    `, [userId]);

    res.render('recurring-events', {
      session: req.session,
      events,
      children,
      subscriptions,
      groupMemberships,
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    console.error('GET /recurring-events error:', err);
    res.status(500).send('Failed to load recurring events.');
  }
});

// GET /recurring-events/create - Show create event form
router.get('/create', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.redirect('/login');

  res.render('create-recurring-event', { session: req.session });
});

// POST /recurring-events/create - Create new recurring event
router.post('/create', async (req, res) => {
  const userId = req.session.userId;
  const { 
    name, description, day_of_week, start_time, end_time, location, activity_type,
    is_group_event, max_participants, auto_assign, group_description 
  } = req.body;

  if (!userId || !name || !day_of_week || !start_time || !end_time || !location || !activity_type) {
    return res.status(400).send('All fields are required.');
  }

  try {
    // Create the event
    const [result] = await db.query(
      `INSERT INTO RecurringEvents (name, description, day_of_week, start_time, end_time, location, activity_type, created_by, is_group_event, max_participants, auto_assign, group_description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, description, day_of_week, start_time, end_time, location, activity_type, userId, 
       is_group_event === 'on', max_participants || null, auto_assign === 'on', group_description]
    );

    const eventId = result.insertId;

    // If it's a group event, add the creator as admin
    if (is_group_event === 'on') {
      await db.query(
        'INSERT INTO EventGroupMembers (event_id, user_id, role) VALUES (?, ?, ?)',
        [eventId, userId, 'admin']
      );
    }

    res.redirect('/recurring-events?success=Event created successfully');
  } catch (err) {
    console.error('POST /recurring-events/create error:', err);
    res.status(500).send('Failed to create event.');
  }
});

// GET /recurring-events/:id/group - View group management page
router.get('/:id/group', async (req, res) => {
  const userId = req.session.userId;
  const eventId = req.params.id;

  if (!userId) return res.redirect('/login');

  try {
    // Get event details
    const [[event]] = await db.query(
      `SELECT re.*, u.name AS created_by_name
       FROM RecurringEvents re
       JOIN Users u ON re.created_by = u.id
       WHERE re.id = ?`,
      [eventId]
    );

    if (!event) {
      return res.status(404).send('Event not found.');
    }

    // Check if user is a member of this group
    const [[membership]] = await db.query(
      'SELECT * FROM EventGroupMembers WHERE event_id = ? AND user_id = ? AND is_active = TRUE',
      [eventId, userId]
    );

    if (!membership) {
      return res.status(403).send('You are not a member of this group.');
    }

    // Get all group members
    const [members] = await db.query(`
      SELECT egm.*, u.name AS user_name, u.email, c.name AS child_name
      FROM EventGroupMembers egm
      JOIN Users u ON egm.user_id = u.id
      LEFT JOIN Children c ON egm.child_id = c.id
      WHERE egm.event_id = ? AND egm.is_active = TRUE
      ORDER BY egm.role DESC, u.name, c.name
    `, [eventId]);

    // Get pending invitations
    const [invitations] = await db.query(`
      SELECT egi.*, u.name AS inviter_name
      FROM EventGroupInvitations egi
      JOIN Users u ON egi.inviter_id = u.id
      WHERE egi.event_id = ? AND egi.status = 'pending'
      ORDER BY egi.invited_at DESC
    `, [eventId]);

    // Get group chat messages
    const [messages] = await db.query(`
      SELECT egm.*, u.name AS sender_name
      FROM EventGroupMessages egm
      JOIN Users u ON egm.sender_id = u.id
      WHERE egm.event_id = ?
      ORDER BY egm.sent_at DESC
      LIMIT 50
    `, [eventId]);

    // Get upcoming assignments
    const [assignments] = await db.query(`
      SELECT ea.*, u.name AS assigned_parent_name, c.name AS child_name
      FROM EventAssignments ea
      JOIN Users u ON ea.user_id = u.id
      JOIN Children c ON ea.child_id = c.id
      WHERE ea.event_id = ? AND ea.event_date >= CURDATE() AND ea.is_cancelled = FALSE
      ORDER BY ea.event_date, ea.assignment_type
    `, [eventId]);

    // --- Addable Children Logic ---
    // Get user's children
    const [children] = await db.query(`
      SELECT c.* FROM Children c
      JOIN ParentChild pc ON pc.child_id = c.id
      WHERE pc.parent_id = ?
    `, [userId]);
    // Get user's children already in the group
    const [groupChildren] = await db.query(
      'SELECT child_id FROM EventGroupMembers WHERE event_id = ? AND user_id = ? AND child_id IS NOT NULL AND is_active = TRUE',
      [eventId, userId]
    );
    const groupChildIds = groupChildren.map(gc => gc.child_id);
    const addableChildren = children.filter(c => !groupChildIds.includes(c.id));
    // --- End Addable Children Logic ---

    res.render('event-group', {
      session: req.session,
      event,
      membership,
      members,
      invitations,
      messages,
      assignments,
      success: req.query.success,
      error: req.query.error,
      addableChildren
    });
  } catch (err) {
    console.error('GET /recurring-events/:id/group error:', err);
    res.status(500).send('Failed to load group page.');
  }
});

// POST /recurring-events/:id/invite - Invite someone to the group
router.post('/:id/invite', async (req, res) => {
  const userId = req.session.userId;
  const eventId = req.params.id;
  const { invitee_email, invitee_name } = req.body;

  if (!userId || !invitee_email) {
    return res.status(400).send('Email is required.');
  }

  try {
    // Check if user is a member of this group
    const [[membership]] = await db.query(
      'SELECT * FROM EventGroupMembers WHERE event_id = ? AND user_id = ? AND is_active = TRUE',
      [eventId, userId]
    );

    if (!membership) {
      return res.status(403).send('You are not a member of this group.');
    }

    // Get event details for the invitation message
    const [[event]] = await db.query(
      'SELECT * FROM RecurringEvents WHERE id = ?',
      [eventId]
    );

    // Check if the invitee is already a registered user
    const [[inviteeUser]] = await db.query(
      'SELECT id, name, email FROM Users WHERE email = ?',
      [invitee_email]
    );

    if (!inviteeUser) {
      return res.redirect(`/recurring-events/${eventId}/group?error=User with this email is not registered. Please ask them to sign up first.`);
    }

    // Check if invitation already exists
    const [[existing]] = await db.query(
      'SELECT * FROM EventGroupInvitations WHERE event_id = ? AND invitee_email = ? AND status = "pending"',
      [eventId, invitee_email]
    );

    if (existing) {
      return res.redirect(`/recurring-events/${eventId}/group?error=Invitation already sent to this email`);
    }

    // Check if user is already a member
    const [[existingMember]] = await db.query(
      'SELECT * FROM EventGroupMembers WHERE event_id = ? AND user_id = ? AND is_active = TRUE',
      [eventId, inviteeUser.id]
    );

    if (existingMember) {
      return res.redirect(`/recurring-events/${eventId}/group?error=This user is already a member of the group`);
    }

    // Create invitation
    const [invitationResult] = await db.query(
      'INSERT INTO EventGroupInvitations (event_id, inviter_id, invitee_email, invitee_name, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))',
      [eventId, userId, invitee_email, invitee_name]
    );

    // Send in-app message to the invitee
    const inviterName = req.session.userName;
    const invitationMessage = `You've been invited to join the group "${event.name}" by ${inviterName}. This group meets ${event.day_of_week}s from ${event.start_time} to ${event.end_time} at ${event.location}. Click the link below to accept or decline the invitation.`;
    
    await db.query(
      'INSERT INTO Messages (sender_id, recipient_id, content, related_type, related_id) VALUES (?, ?, ?, ?, ?)',
      [userId, inviteeUser.id, invitationMessage, 'group_invitation', invitationResult.insertId]
    );

    res.redirect(`/recurring-events/${eventId}/group?success=Invitation sent successfully to ${inviteeUser.name}`);
  } catch (err) {
    console.error('POST /recurring-events/:id/invite error:', err);
    res.status(500).send('Failed to send invitation.');
  }
});

// POST /recurring-events/:id/join - Join group (for invited users)
router.post('/:id/join', async (req, res) => {
  const userId = req.session.userId;
  const eventId = req.params.id;
  const { child_ids } = req.body;

  if (!userId) {
    return res.status(400).send('You must be logged in to join.');
  }

  try {
    // Check if user has a pending invitation
    const [[invitation]] = await db.query(
      'SELECT * FROM EventGroupInvitations WHERE event_id = ? AND invitee_email = (SELECT email FROM Users WHERE id = ?) AND status = "pending"',
      [eventId, userId]
    );

    if (!invitation) {
      return res.status(403).send('You do not have a valid invitation to join this group.');
    }

    // Add user as member
    await db.query(
      'INSERT INTO EventGroupMembers (event_id, user_id, role) VALUES (?, ?, ?)',
      [eventId, userId, 'parent']
    );

    // Add children if specified
    if (child_ids && Array.isArray(child_ids)) {
      for (const childId of child_ids) {
        await db.query(
          'INSERT INTO EventGroupMembers (event_id, user_id, child_id, role) VALUES (?, ?, ?, ?)',
          [eventId, userId, childId, 'child']
        );
      }
    }

    // Update invitation status
    await db.query(
      'UPDATE EventGroupInvitations SET status = "accepted", responded_at = NOW() WHERE id = ?',
      [invitation.id]
    );

    // Send confirmation message to the inviter
    const [[event]] = await db.query('SELECT name FROM RecurringEvents WHERE id = ?', [eventId]);
    const [[inviter]] = await db.query('SELECT id FROM Users WHERE id = ?', [invitation.inviter_id]);
    const [[newMember]] = await db.query('SELECT name FROM Users WHERE id = ?', [userId]);
    
    if (inviter && newMember) {
      const confirmationMessage = `${newMember.name} has accepted your invitation to join "${event.name}"!`;
      await db.query(
        'INSERT INTO Messages (sender_id, recipient_id, content, related_type, related_id) VALUES (?, ?, ?, ?, ?)',
        [userId, inviter.id, confirmationMessage, 'group_invitation_accepted', eventId]
      );
    }

    res.redirect(`/recurring-events/${eventId}/group?success=Successfully joined the group`);
  } catch (err) {
    console.error('POST /recurring-events/:id/join error:', err);
    res.status(500).send('Failed to join group.');
  }
});

// POST /recurring-events/:id/decline-invitation - Decline group invitation
router.post('/:id/decline-invitation', async (req, res) => {
  const userId = req.session.userId;
  const eventId = req.params.id;
  const { invitation_id } = req.body;

  if (!userId || !invitation_id) {
    return res.status(400).send('Missing required fields.');
  }

  try {
    // Check if user has a pending invitation
    const [[invitation]] = await db.query(
      'SELECT * FROM EventGroupInvitations WHERE id = ? AND event_id = ? AND invitee_email = (SELECT email FROM Users WHERE id = ?) AND status = "pending"',
      [invitation_id, eventId, userId]
    );

    if (!invitation) {
      return res.status(403).send('You do not have a valid invitation to decline.');
    }

    // Update invitation status
    await db.query(
      'UPDATE EventGroupInvitations SET status = "declined", responded_at = NOW() WHERE id = ?',
      [invitation_id]
    );

    // Send decline message to the inviter
    const [[event]] = await db.query('SELECT name FROM RecurringEvents WHERE id = ?', [eventId]);
    const [[inviter]] = await db.query('SELECT id FROM Users WHERE id = ?', [invitation.inviter_id]);
    const [[decliner]] = await db.query('SELECT name FROM Users WHERE id = ?', [userId]);
    
    if (inviter && decliner) {
      const declineMessage = `${decliner.name} has declined your invitation to join "${event.name}".`;
      await db.query(
        'INSERT INTO Messages (sender_id, recipient_id, content, related_type, related_id) VALUES (?, ?, ?, ?, ?)',
        [userId, inviter.id, declineMessage, 'group_invitation_declined', eventId]
      );
    }

    res.redirect('/dashboard?success=Invitation declined successfully');
  } catch (err) {
    console.error('POST /recurring-events/:id/decline-invitation error:', err);
    res.status(500).send('Failed to decline invitation.');
  }
});

// POST /recurring-events/:id/message - Send group message
router.post('/:id/message', async (req, res) => {
  const userId = req.session.userId;
  const eventId = req.params.id;
  const { message, message_type = 'general' } = req.body;

  if (!userId || !message) {
    return res.status(400).send('Message is required.');
  }

  try {
    // Check if user is a member of this group
    const [[membership]] = await db.query(
      'SELECT * FROM EventGroupMembers WHERE event_id = ? AND user_id = ? AND is_active = TRUE',
      [eventId, userId]
    );

    if (!membership) {
      return res.status(403).send('You are not a member of this group.');
    }

    // Send message
    await db.query(
      'INSERT INTO EventGroupMessages (event_id, sender_id, message, message_type) VALUES (?, ?, ?, ?)',
      [eventId, userId, message, message_type]
    );

    res.redirect(`/recurring-events/${eventId}/group?success=Message sent`);
  } catch (err) {
    console.error('POST /recurring-events/:id/message error:', err);
    res.status(500).send('Failed to send message.');
  }
});

// POST /recurring-events/:id/assign - Assign drop-off/pickup (enhanced for groups)
router.post('/:id/assign', async (req, res) => {
  const userId = req.session.userId;
  const eventId = req.params.id;
  let { event_date, child_id, assignment_type, notes } = req.body;

  if (!userId || !event_date || !child_id || !assignment_type) {
    return res.status(400).send('Missing required fields.');
  }

  // Support multiple children
  if (!Array.isArray(child_id)) {
    child_id = [child_id];
  }

  try {
    // Check if this is a group event and user is a member
    const [[event]] = await db.query(
      'SELECT is_group_event FROM RecurringEvents WHERE id = ?',
      [eventId]
    );

    if (event.is_group_event) {
      const [[membership]] = await db.query(
        'SELECT * FROM EventGroupMembers WHERE event_id = ? AND user_id = ? AND is_active = TRUE',
        [eventId, userId]
      );

      if (!membership) {
        return res.status(403).send('You are not a member of this group.');
      }
    }

    let created = 0, skipped = 0;
    for (const cid of child_id) {
      // Check if assignment already exists
      const [[existing]] = await db.query(
        'SELECT id FROM EventAssignments WHERE event_id = ? AND event_date = ? AND child_id = ? AND assignment_type = ?',
        [eventId, event_date, cid, assignment_type]
      );
      if (existing) {
        skipped++;
        continue;
      }
      await db.query(
        `INSERT INTO EventAssignments (event_id, event_date, user_id, child_id, assignment_type, notes, group_assignment)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [eventId, event_date, userId, cid, assignment_type, notes, event.is_group_event]
      );
      created++;
    }
    let msg = `${created} assignment(s) created.`;
    if (skipped) msg += ` ${skipped} already existed.`;
    
    const redirectUrl = event.is_group_event 
      ? `/recurring-events/${eventId}/group?success=${encodeURIComponent(msg)}`
      : `/recurring-events/${eventId}/assignments?success=${encodeURIComponent(msg)}`;
    
    res.redirect(redirectUrl);
  } catch (err) {
    console.error('POST /recurring-events/:id/assign error:', err);
    res.status(500).send('Failed to create assignment.');
  }
});

// POST /recurring-events/:id/cancel-assignment - Cancel a child's assignment for a week
router.post('/:id/cancel-assignment', async (req, res) => {
  const userId = req.session.userId;
  const eventId = req.params.id;
  const { assignment_id, cancellation_reason } = req.body;

  if (!userId || !assignment_id) {
    return res.status(400).send('Missing required fields.');
  }

  try {
    // Check if user can cancel this assignment (they must be the assigned parent or the child's parent)
    const [[assignment]] = await db.query(`
      SELECT ea.*, c.user_id as child_parent_id
      FROM EventAssignments ea
      JOIN Children c ON ea.child_id = c.id
      WHERE ea.id = ?
    `, [assignment_id]);

    if (!assignment) {
      return res.status(404).send('Assignment not found.');
    }

    if (assignment.user_id !== userId && assignment.child_parent_id !== userId) {
      return res.status(403).send('You can only cancel your own assignments or your child\'s assignments.');
    }

    // Cancel the assignment
    await db.query(
      'UPDATE EventAssignments SET is_cancelled = TRUE, cancelled_by = ?, cancelled_at = NOW(), cancellation_reason = ? WHERE id = ?',
      [userId, cancellation_reason, assignment_id]
    );

    // Add a message to the group chat if it's a group event
    const [[event]] = await db.query(
      'SELECT is_group_event FROM RecurringEvents WHERE id = ?',
      [eventId]
    );

    if (event.is_group_event) {
      const [[child]] = await db.query(
        'SELECT name FROM Children WHERE id = ?',
        [assignment.child_id]
      );

      await db.query(
        'INSERT INTO EventGroupMessages (event_id, sender_id, message, message_type, related_assignment_id) VALUES (?, ?, ?, ?, ?)',
        [eventId, userId, `${child.name} cannot attend this week${cancellation_reason ? ': ' + cancellation_reason : ''}`, 'cancellation', assignment_id]
      );
    }

    const redirectUrl = event.is_group_event 
      ? `/recurring-events/${eventId}/group?success=Assignment cancelled`
      : `/recurring-events/${eventId}/assignments?success=Assignment cancelled`;
    
    res.redirect(redirectUrl);
  } catch (err) {
    console.error('POST /recurring-events/:id/cancel-assignment error:', err);
    res.status(500).send('Failed to cancel assignment.');
  }
});

// Legacy routes for individual events (keep for backward compatibility)
// POST /recurring-events/:id/subscribe - Subscribe to an event
router.post('/:id/subscribe', async (req, res) => {
  const userId = req.session.userId;
  const eventId = req.params.id;
  const { child_id } = req.body;

  if (!userId || !child_id) {
    return res.status(400).send('Missing required fields.');
  }

  try {
    // Check if this is a group event
    const [[event]] = await db.query(
      'SELECT is_group_event FROM RecurringEvents WHERE id = ?',
      [eventId]
    );

    if (event.is_group_event) {
      return res.redirect(`/recurring-events/${eventId}/group?error=This is a group event. Please join the group instead.`);
    }

    // Check if already subscribed
    const [[existing]] = await db.query(
      'SELECT id FROM EventSubscriptions WHERE event_id = ? AND user_id = ? AND child_id = ?',
      [eventId, userId, child_id]
    );

    if (existing) {
      return res.redirect('/recurring-events?error=Already subscribed to this event');
    }

    await db.query(
      'INSERT INTO EventSubscriptions (event_id, user_id, child_id) VALUES (?, ?, ?)',
      [eventId, userId, child_id]
    );

    res.redirect('/recurring-events?success=Subscribed to event successfully');
  } catch (err) {
    console.error('POST /recurring-events/:id/subscribe error:', err);
    res.status(500).send('Failed to subscribe to event.');
  }
});

// POST /recurring-events/:id/unsubscribe - Unsubscribe from an event
router.post('/:id/unsubscribe', async (req, res) => {
  const userId = req.session.userId;
  const eventId = req.params.id;
  const { child_id } = req.body;

  if (!userId || !child_id) {
    return res.status(400).send('Missing required fields.');
  }

  try {
    await db.query(
      'DELETE FROM EventSubscriptions WHERE event_id = ? AND user_id = ? AND child_id = ?',
      [eventId, userId, child_id]
    );

    res.redirect('/recurring-events?success=Unsubscribed from event successfully');
  } catch (err) {
    console.error('POST /recurring-events/:id/unsubscribe error:', err);
    res.status(500).send('Failed to unsubscribe from event.');
  }
});

// GET /recurring-events/:id/assignments - View event assignments (legacy)
router.get('/:id/assignments', async (req, res) => {
  const userId = req.session.userId;
  const eventId = req.params.id;

  if (!userId) return res.redirect('/login');

  try {
    // Get event details
    const [[event]] = await db.query(
      `SELECT re.*, u.name AS created_by_name
       FROM RecurringEvents re
       JOIN Users u ON re.created_by = u.id
       WHERE re.id = ?`,
      [eventId]
    );

    if (!event) {
      return res.status(404).send('Event not found.');
    }

    // If it's a group event, redirect to group page
    if (event.is_group_event) {
      return res.redirect(`/recurring-events/${eventId}/group`);
    }

    // Get subscribers
    const [subscribers] = await db.query(
      `SELECT es.*, u.name AS parent_name, c.name AS child_name
       FROM EventSubscriptions es
       JOIN Users u ON es.user_id = u.id
       JOIN Children c ON es.child_id = c.id
       WHERE es.event_id = ?`,
      [eventId]
    );

    // Get upcoming assignments (excluding cancelled)
    const [assignments] = await db.query(
      `SELECT ea.*, u.name AS assigned_parent_name, c.name AS child_name
       FROM EventAssignments ea
       JOIN Users u ON ea.user_id = u.id
       JOIN Children c ON ea.child_id = c.id
       WHERE ea.event_id = ? AND ea.event_date >= CURDATE() AND ea.is_cancelled = FALSE
       ORDER BY ea.event_date, ea.assignment_type`,
      [eventId]
    );

    res.render('event-assignments', {
      session: req.session,
      event,
      subscribers,
      assignments,
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    console.error('GET /recurring-events/:id/assignments error:', err);
    res.status(500).send('Failed to load event assignments.');
  }
});

// GET /recurring-events/:id/add-children - Show add children form for group members
router.get('/:id/add-children', async (req, res) => {
  const userId = req.session.userId;
  const eventId = req.params.id;
  if (!userId) return res.status(401).send('Not logged in');

  // Get user's children
  const [children] = await db.query(`
    SELECT c.* FROM Children c
    JOIN ParentChild pc ON pc.child_id = c.id
    WHERE pc.parent_id = ?
  `, [userId]);

  // Get children already in the group
  const [groupChildren] = await db.query(
    'SELECT child_id FROM EventGroupMembers WHERE event_id = ? AND user_id = ? AND child_id IS NOT NULL AND is_active = TRUE',
    [eventId, userId]
  );
  const groupChildIds = groupChildren.map(gc => gc.child_id);

  // Filter to only children not already in the group
  const addableChildren = children.filter(c => !groupChildIds.includes(c.id));

  res.render('partials/add-children-modal', { eventId, addableChildren });
});

// POST /recurring-events/:id/add-children - Add selected children to group
router.post('/:id/add-children', async (req, res) => {
  const userId = req.session.userId;
  const eventId = req.params.id;
  let { child_ids } = req.body;
  if (!userId || !child_ids) return res.status(400).send('Missing required fields.');
  if (!Array.isArray(child_ids)) child_ids = [child_ids];

  try {
    for (const childId of child_ids) {
      // Check if already in group
      const [[existing]] = await db.query(
        'SELECT id FROM EventGroupMembers WHERE event_id = ? AND user_id = ? AND child_id = ? AND is_active = TRUE',
        [eventId, userId, childId]
      );
      if (!existing) {
        await db.query(
          'INSERT INTO EventGroupMembers (event_id, user_id, child_id, role) VALUES (?, ?, ?, ?)',
          [eventId, userId, childId, 'child']
        );
      }
    }
    res.redirect(`/recurring-events/${eventId}/group?success=Children added to group`);
  } catch (err) {
    console.error('POST /recurring-events/:id/add-children error:', err);
    res.status(500).send('Failed to add children to group.');
  }
});

module.exports = router; 