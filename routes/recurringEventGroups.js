const express = require('express');
const router = express.Router();
const db = require('../db');

// Middleware to check if user is logged in
const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).send('Please log in to access this feature.');
  }
  next();
};

// Middleware to check if user is part of the event group
const requireGroupAccess = async (req, res, next) => {
  const eventId = req.params.eventId;
  const userId = req.session.userId;
  
  try {
    const [members] = await db.query(`
      SELECT * FROM EventGroupMembers 
      WHERE event_id = ? AND user_id = ? AND is_active = TRUE
    `, [eventId, userId]);
    
    if (members.length === 0) {
      // Instead of returning 403, redirect to join page or show join option
      req.needsToJoin = true;
      req.eventId = eventId;
    } else {
      req.groupMember = members[0];
    }
    next();
  } catch (err) {
    console.error('Group access check error:', err);
    res.status(500).send('Error checking group access.');
  }
};

// GET /recurring-event-groups/:eventId - View event group details
router.get('/:eventId', requireAuth, requireGroupAccess, async (req, res) => {
  const eventId = req.params.eventId;
  
  // If user needs to join, show join page
  if (req.needsToJoin) {
    try {
      // Get event details
      const [[event]] = await db.query(`
        SELECT re.*, u.name AS created_by_name
        FROM RecurringEvents re
        JOIN Users u ON re.created_by = u.id
        WHERE re.id = ? AND re.is_group_event = TRUE
      `, [eventId]);
      
      if (!event) {
        return res.status(404).send('Event group not found.');
      }
      
      // Get user's children
      const [children] = await db.query(`
        SELECT c.* FROM Children c
        JOIN ParentChild pc ON pc.child_id = c.id
        WHERE pc.parent_id = ?
      `, [req.session.userId]);
      
      res.render('join-event-group', {
        event,
        children,
        session: req.session
      });
    } catch (err) {
      console.error('Join group view error:', err);
      res.status(500).send('Error loading join group page.');
    }
    return;
  }
  
  try {
    // Get event details
    const [[event]] = await db.query(`
      SELECT re.*, u.name AS created_by_name
      FROM RecurringEvents re
      JOIN Users u ON re.created_by = u.id
      WHERE re.id = ? AND re.is_group_event = TRUE
    `, [eventId]);
    
    if (!event) {
      return res.status(404).send('Event group not found.');
    }
    
    // Get group members
    const [members] = await db.query(`
      SELECT egm.*, u.name AS user_name, u.email, c.name AS child_name, c.school
      FROM EventGroupMembers egm
      JOIN Users u ON egm.user_id = u.id
      LEFT JOIN Children c ON egm.child_id = c.id
      WHERE egm.event_id = ? AND egm.is_active = TRUE
      ORDER BY egm.role DESC, u.name, c.name
    `, [eventId]);
    
    // Get upcoming instances (next 4 weeks)
    const [instances] = await db.query(`
      SELECT ei.*, u.name AS driver_name
      FROM EventInstances ei
      LEFT JOIN Users u ON ei.driver_id = u.id
      WHERE ei.event_id = ? AND ei.event_date >= CURDATE()
      ORDER BY ei.event_date ASC
      LIMIT 4
    `, [eventId]);
    
    // Get recent group messages
    const [messages] = await db.query(`
      SELECT egm.*, u.name AS sender_name
      FROM EventGroupMessages egm
      JOIN Users u ON egm.sender_id = u.id
      WHERE egm.event_id = ?
      ORDER BY egm.sent_at DESC
      LIMIT 20
    `, [eventId]);
    
    res.render('recurring-event-group', {
      event,
      members,
      instances,
      messages,
      session: req.session
    });
  } catch (err) {
    console.error('Event group view error:', err);
    res.status(500).send('Error loading event group.');
  }
});

// POST /recurring-event-groups/:eventId/join - Join event group
router.post('/:eventId/join', requireAuth, async (req, res) => {
  const eventId = req.params.eventId;
  const { child_ids, can_drive } = req.body;
  const userId = req.session.userId;
  
  try {
    // Verify the event exists and is a group event
    const [[event]] = await db.query(`
      SELECT * FROM RecurringEvents 
      WHERE id = ? AND is_group_event = TRUE
    `, [eventId]);
    
    if (!event) {
      return res.status(404).send('Event group not found.');
    }
    
    // Check if user is already a member
    const [existingMembership] = await db.query(`
      SELECT * FROM EventGroupMembers 
      WHERE event_id = ? AND user_id = ? AND is_active = TRUE
    `, [eventId, userId]);
    
    if (existingMembership.length > 0) {
      return res.redirect(`/recurring-event-groups/${eventId}?error=Already a member`);
    }
    
    // Add user as parent member
    await db.query(`
      INSERT INTO EventGroupMembers (event_id, user_id, role, can_drive)
      VALUES (?, ?, 'parent', ?)
    `, [eventId, userId, can_drive === 'on']);
    
    // Check if user is already assigned as a driver for this event
    const [existingDriverAssignments] = await db.query(`
      SELECT COUNT(*) as count FROM EventAssignments 
      WHERE event_id = ? AND user_id = ? AND status != 'cancelled'
    `, [eventId, userId]);
    
    // If user is already assigned as a driver, update their can_drive flag
    if (existingDriverAssignments[0].count > 0) {
      await db.query(`
        UPDATE EventGroupMembers 
        SET can_drive = TRUE 
        WHERE event_id = ? AND user_id = ?
      `, [eventId, userId]);
    }
    
    // Add children if selected
    if (child_ids && Array.isArray(child_ids)) {
      for (const childId of child_ids) {
        // Verify the child belongs to this user
        const [children] = await db.query(`
          SELECT c.* FROM Children c
          JOIN ParentChild pc ON c.id = pc.child_id
          WHERE pc.parent_id = ? AND c.id = ?
        `, [userId, childId]);
        
        if (children.length > 0) {
          await db.query(`
            INSERT INTO EventGroupMembers (event_id, user_id, child_id, role)
            VALUES (?, ?, ?, 'child')
          `, [eventId, userId, childId]);
        }
      }
    }
    
    // Send welcome message
    await db.query(`
      INSERT INTO EventGroupMessages (event_id, sender_id, message, message_type)
      VALUES (?, ?, ?, 'general')
    `, [eventId, userId, 'Joined the group!']);
    
    res.redirect(`/recurring-event-groups/${eventId}?success=Successfully joined the group`);
  } catch (err) {
    console.error('Join group error:', err);
    res.status(500).send('Error joining group.');
  }
});

// POST /recurring-event-groups/:eventId/confirm-attendance - Confirm child attendance
router.post('/:eventId/confirm-attendance', requireAuth, requireGroupAccess, async (req, res) => {
  const eventId = req.params.eventId;
  let { child_id, will_attend, instance_date } = req.body;
  const userId = req.session.userId;
  
  try {
    // Convert instance_date to YYYY-MM-DD format
    const dateObj = new Date(instance_date);
    const formattedDate = dateObj.toISOString().split('T')[0];

    // Verify the child belongs to this user
    const [children] = await db.query(`
      SELECT c.* FROM Children c
      JOIN ParentChild pc ON c.id = pc.child_id
      WHERE pc.parent_id = ? AND c.id = ?
    `, [userId, child_id]);
    
    if (children.length === 0) {
      return res.status(403).send('You can only confirm attendance for your own children.');
    }
    
    // Get or create event instance
    let instanceId;
    const [[existingInstance]] = await db.query(`
      SELECT id FROM EventInstances 
      WHERE event_id = ? AND event_date = ?
    `, [eventId, formattedDate]);
    
    if (existingInstance) {
      instanceId = existingInstance.id;
    } else {
      const [result] = await db.query(`
        INSERT INTO EventInstances (event_id, event_date) 
        VALUES (?, ?)
      `, [eventId, formattedDate]);
      instanceId = result.insertId;
    }
    
    // Update or create attendance record
    await db.query(`
      INSERT INTO EventInstanceAttendance (instance_id, child_id, parent_id, will_attend, confirmed_at, confirmed_by)
      VALUES (?, ?, ?, ?, NOW(), ?)
      ON DUPLICATE KEY UPDATE 
        will_attend = VALUES(will_attend),
        confirmed_at = VALUES(confirmed_at),
        confirmed_by = VALUES(confirmed_by)
    `, [instanceId, child_id, userId, will_attend, userId]);
    
    // Update group member attendance confirmation
    await db.query(`
      UPDATE EventGroupMembers 
      SET attendance_confirmed = TRUE, 
          attendance_confirmed_at = NOW(),
          attendance_confirmed_by = ?
      WHERE event_id = ? AND child_id = ? AND user_id = ?
    `, [userId, eventId, child_id, userId]);
    
    // Send group message about attendance confirmation
    const childName = children[0].name;
    const status = will_attend ? 'will attend' : 'will not attend';
    await db.query(`
      INSERT INTO EventGroupMessages (event_id, sender_id, message, message_type)
      VALUES (?, ?, ?, 'general')
    `, [eventId, userId, `${childName} ${status} on ${formattedDate}`]);
    
    res.redirect(`/recurring-event-groups/${eventId}?success=Attendance confirmed`);
  } catch (err) {
    console.error('Confirm attendance error:', err);
    res.status(500).send('Error confirming attendance.');
  }
});

// POST /recurring-event-groups/:eventId/assign-driver - Assign driver for an instance
router.post('/:eventId/assign-driver', requireAuth, requireGroupAccess, async (req, res) => {
  const eventId = req.params.eventId;
  let { instance_date, driver_id } = req.body;
  const userId = req.session.userId;

  try {
    // Convert instance_date to YYYY-MM-DD format
    const dateObj = new Date(instance_date);
    const formattedDate = dateObj.toISOString().split('T')[0];

    // Verify the driver is a group member (parent role)
    const [driver] = await db.query(`
      SELECT * FROM EventGroupMembers 
      WHERE event_id = ? AND user_id = ? AND role = 'parent' AND is_active = TRUE
    `, [eventId, driver_id]);
    
    if (driver.length === 0) {
      return res.status(400).send('Selected driver is not a valid group member.');
    }
    
    // Get or create event instance
    let instanceId;
    const [[existingInstance]] = await db.query(`
      SELECT id FROM EventInstances 
      WHERE event_id = ? AND event_date = ?
    `, [eventId, formattedDate]);
    
    if (existingInstance) {
      instanceId = existingInstance.id;
      await db.query(`
        UPDATE EventInstances 
        SET driver_id = ?, driver_assigned_at = NOW(), driver_assigned_by = ?
        WHERE id = ?
      `, [driver_id, userId, instanceId]);
    } else {
      const [result] = await db.query(`
        INSERT INTO EventInstances (event_id, event_date, driver_id, driver_assigned_at, driver_assigned_by)
        VALUES (?, ?, ?, NOW(), ?)
      `, [eventId, formattedDate, driver_id, userId]);
      instanceId = result.insertId;
    }
    
    // Update the user's can_drive flag to TRUE since they're now assigned as a driver
    await db.query(`
      UPDATE EventGroupMembers 
      SET can_drive = TRUE 
      WHERE event_id = ? AND user_id = ?
    `, [eventId, driver_id]);
    
    // Send group message about driver assignment
    const driverName = driver[0].user_name;
    await db.query(`
      INSERT INTO EventGroupMessages (event_id, sender_id, message, message_type)
      VALUES (?, ?, ?, 'assignment')
    `, [eventId, userId, `${driverName} has been assigned as driver for ${formattedDate}`]);
    
    res.redirect(`/recurring-event-groups/${eventId}?success=Driver assigned`);
  } catch (err) {
    console.error('Assign driver error:', err);
    res.status(500).send('Error assigning driver.');
  }
});

// POST /recurring-event-groups/:eventId/send-message - Send group message
router.post('/:eventId/send-message', requireAuth, requireGroupAccess, async (req, res) => {
  const eventId = req.params.eventId;
  const { message } = req.body;
  const userId = req.session.userId;
  
  if (!message || message.trim().length === 0) {
    return res.status(400).send('Message cannot be empty.');
  }
  
  try {
    await db.query(`
      INSERT INTO EventGroupMessages (event_id, sender_id, message, message_type)
      VALUES (?, ?, ?, 'general')
    `, [eventId, userId, message.trim()]);
    
    res.redirect(`/recurring-event-groups/${eventId}`);
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).send('Error sending message.');
  }
});

// GET /recurring-event-groups/:eventId/upcoming - Get upcoming instances
router.get('/:eventId/upcoming', requireAuth, requireGroupAccess, async (req, res) => {
  const eventId = req.params.eventId;
  
  try {
    const [instances] = await db.query(`
      SELECT ei.*, u.name AS driver_name,
             (SELECT COUNT(*) FROM EventInstanceAttendance eia 
              WHERE eia.instance_id = ei.id AND eia.will_attend = TRUE) AS attending_count
      FROM EventInstances ei
      LEFT JOIN Users u ON ei.driver_id = u.id
      WHERE ei.event_id = ? AND ei.event_date >= CURDATE()
      ORDER BY ei.event_date ASC
      LIMIT 8
    `, [eventId]);
    
    res.json(instances);
  } catch (err) {
    console.error('Get upcoming instances error:', err);
    res.status(500).json({ error: 'Error loading upcoming instances.' });
  }
});

// GET /recurring-event-groups/:eventId/generate-instances - Generate upcoming instances (for testing)
router.get('/:eventId/generate-instances', requireAuth, requireGroupAccess, async (req, res) => {
  const eventId = req.params.eventId;
  
  if (req.needsToJoin) {
    return res.status(403).send('You need to join the group first.');
  }
  
  try {
    // Get event details
    const [[event]] = await db.query(`
      SELECT * FROM RecurringEvents WHERE id = ?
    `, [eventId]);
    
    if (!event) {
      return res.status(404).send('Event not found.');
    }
    
    // Generate next 4 instances
    const instances = [];
    const today = new Date();
    let currentDate = new Date(today);
    
    // Find the next occurrence of the event day
    const dayMap = { 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6, 'Sun': 0 };
    const targetDay = dayMap[event.day_of_week];
    
    while (currentDate.getDay() !== targetDay) {
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // Generate 4 instances
    for (let i = 0; i < 4; i++) {
      const instanceDate = new Date(currentDate);
      instanceDate.setDate(instanceDate.getDate() + (i * 7));
      
      // Check if instance already exists
      const [[existingInstance]] = await db.query(`
        SELECT id FROM EventInstances 
        WHERE event_id = ? AND event_date = ?
      `, [eventId, instanceDate.toISOString().split('T')[0]]);
      
      if (!existingInstance) {
        const [result] = await db.query(`
          INSERT INTO EventInstances (event_id, event_date) 
          VALUES (?, ?)
        `, [eventId, instanceDate.toISOString().split('T')[0]]);
        
        instances.push({
          id: result.insertId,
          event_date: instanceDate.toISOString().split('T')[0]
        });
      }
    }
    
    res.redirect(`/recurring-event-groups/${eventId}?success=Generated ${instances.length} upcoming instances`);
  } catch (err) {
    console.error('Generate instances error:', err);
    res.status(500).send('Error generating instances.');
  }
});

module.exports = router; 