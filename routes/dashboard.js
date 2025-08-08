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
      'SELECT id, name, email, home_address, home_lat, home_lng, is_address_private, profile_completed FROM Users WHERE id = ?',
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

    // Get other users with locations (for map display) - only show public addresses
    const [neighbors] = await db.query(`
      SELECT id, name, home_address, home_lat, home_lng 
      FROM Users 
      WHERE id != ? AND home_lat IS NOT NULL AND home_lng IS NOT NULL AND home_address IS NOT NULL AND is_address_private = FALSE
      ORDER BY name
    `, [userId]);

    // Get count of private users for display
    const [[privateCount]] = await db.query(`
      SELECT COUNT(*) as count
      FROM Users 
      WHERE id != ? AND home_lat IS NOT NULL AND home_lng IS NOT NULL AND home_address IS NOT NULL AND is_address_private = TRUE
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

    // Get calendar events for the user and their children
    const childIds = children.map(c => c.id);
    let calendarEvents = [];
    
    // Define today for date calculations
    const today = new Date();
    
    // Get ride offers where user is the driver (RideOffers)
    const [rideOffers] = await db.query(`
      SELECT ro.id, ro.pickup_time, ro.school as dropoff_location, 'Home' as pickup_location, 'offer' as type
      FROM RideOffers ro 
      WHERE ro.user_id = ? AND ro.pickup_time >= NOW()
    `, [userId]);

    console.log('Ride offers found:', rideOffers.length);
    
    // Get ride requests where user is assigned as driver (RideRequests)
    const [assignedRides] = await db.query(`
      SELECT rr.id, rr.pickup_time, rr.pickup_location, rr.dropoff_location, c.name as child_name, 
             rr.status, rr.assigned_user_id, 'request' as type
      FROM RideRequests rr 
      JOIN Children c ON rr.child_id = c.id 
      WHERE rr.assigned_user_id = ? AND rr.pickup_time >= NOW()
    `, [userId]);

    console.log('Assigned rides found:', assignedRides.length);
    
    // Get ride requests for user's children (if they have children)
    let childrenRides = [];
    if (childIds.length > 0) {
      [childrenRides] = await db.query(`
        SELECT rr.id, rr.pickup_time, rr.pickup_location, rr.dropoff_location, c.name as child_name, 
               rr.status, rr.assigned_user_id, u.name as driver_name, 'child_request' as type
        FROM RideRequests rr 
        JOIN Children c ON rr.child_id = c.id 
        LEFT JOIN Users u ON rr.assigned_user_id = u.id
        WHERE rr.child_id IN (?) AND rr.pickup_time >= NOW()
      `, [childIds]);
    }

    console.log('Children rides found:', childrenRides.length);
    
    // Get ride requests created by the user (for their children)
    let myRideRequests = [];
    if (childIds.length > 0) {
      [myRideRequests] = await db.query(`
        SELECT rr.id, rr.pickup_time, rr.pickup_location, rr.dropoff_location, c.name as child_name, 
               rr.status, rr.assigned_user_id, u.name as driver_name, 'my_request' as type
        FROM RideRequests rr 
        JOIN Children c ON rr.child_id = c.id 
        LEFT JOIN Users u ON rr.assigned_user_id = u.id
        WHERE rr.user_id = ? AND rr.pickup_time >= NOW() AND rr.assigned_user_id IS NULL
      `, [userId]);
    }

    console.log('My ride requests found:', myRideRequests.length);
    
    // Get recurring event assignments for user's children (if they have children)
    let recurringAssignments = [];
    if (childIds.length > 0) {
      [recurringAssignments] = await db.query(`
        SELECT ea.event_id, ea.event_date, re.name as event_name, re.day_of_week, re.start_time, re.end_time, re.location, c.name as child_name, 'recurring' as type,
               GROUP_CONCAT(ea.assignment_type ORDER BY ea.assignment_type) AS assignment_types
        FROM EventAssignments ea
        JOIN RecurringEvents re ON ea.event_id = re.id
        JOIN Children c ON ea.child_id = c.id
        WHERE ea.child_id IN (?) AND ea.event_date >= CURDATE() AND ea.status != 'cancelled' AND ea.is_cancelled = FALSE
        GROUP BY ea.event_id, ea.event_date, re.name, re.day_of_week, re.start_time, re.end_time, re.location, c.name
        ORDER BY ea.event_date ASC
      `, [childIds]);
    }

    // Get recurring events where user is a group member (for the next 4 weeks)
    let groupRecurringEvents = [];
    const [groupEvents] = await db.query(`
      SELECT DISTINCT re.id, re.name as event_name, re.day_of_week, re.start_time, re.end_time, re.location
      FROM RecurringEvents re
      JOIN EventGroupMembers egm ON re.id = egm.event_id
      WHERE egm.user_id = ? AND egm.is_active = TRUE AND re.is_active = TRUE
      ORDER BY re.day_of_week, re.start_time
    `, [userId]);

    // Generate next 4 weeks of occurrences for group events
    for (const event of groupEvents) {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const eventDayIndex = dayNames.indexOf(event.day_of_week);
      
      for (let week = 0; week < 4; week++) {
        const eventDate = new Date(today);
        eventDate.setDate(today.getDate() + (week * 7));
        
        // Find the next occurrence of this day of the week
        while (eventDate.getDay() !== eventDayIndex) {
          eventDate.setDate(eventDate.getDate() + 1);
        }
        
        // Only add if it's in the future
        if (eventDate >= today) {
          const event_date_str = eventDate.toISOString().split('T')[0];
          // Query all dropoff and pickup assignments for this event/date
          const [dropoffDrivers] = await db.query(
            `SELECT DISTINCT u.name AS driver_name FROM EventAssignments ea
             JOIN Users u ON ea.user_id = u.id
             WHERE ea.event_id = ? AND ea.event_date = ? AND ea.assignment_type = 'dropoff' AND ea.is_cancelled = FALSE`,
            [event.id, event_date_str]
          );
          const [pickupDrivers] = await db.query(
            `SELECT DISTINCT u.name AS driver_name FROM EventAssignments ea
             JOIN Users u ON ea.user_id = u.id
             WHERE ea.event_id = ? AND ea.event_date = ? AND ea.assignment_type = 'pickup' AND ea.is_cancelled = FALSE`,
            [event.id, event_date_str]
          );
          const dropoff_driver = dropoffDrivers.length > 0
            ? dropoffDrivers.map(d => d.driver_name).join(', ')
            : 'Unassigned';
          const pickup_driver = pickupDrivers.length > 0
            ? pickupDrivers.map(d => d.driver_name).join(', ')
            : 'Unassigned';
          // Get the EventInstances.id for this event/date
          const [[instance]] = await db.query(
            'SELECT id FROM EventInstances WHERE event_id = ? AND event_date = ?',
            [event.id, event_date_str]
          );
          groupRecurringEvents.push({
            id: `group_event_${event.id}_${event_date_str}`,
            event_date: event_date_str,
            event_name: event.event_name,
            day_of_week: event.day_of_week,
            start_time: event.start_time,
            end_time: event.end_time,
            location: event.location,
            type: 'group_recurring',
            dropoff_driver: dropoff_driver,
            pickup_driver: pickup_driver,
            instance_id: instance ? instance.id : null
          });
        }
      }
    }

    // Get recurring events where user's children are subscribed (for the next 4 weeks)
    let subscribedRecurringEvents = [];
    if (childIds.length > 0) {
      const [subscribedEvents] = await db.query(`
        SELECT DISTINCT re.id, re.name as event_name, re.day_of_week, re.start_time, re.end_time, re.location, c.name as child_name, 'subscribed_recurring' as type
        FROM RecurringEvents re
        JOIN EventSubscriptions es ON re.id = es.event_id
        JOIN Children c ON es.child_id = c.id
        WHERE es.child_id IN (?) AND re.is_active = TRUE
        ORDER BY re.day_of_week, re.start_time
      `, [childIds]);

      // Generate next 4 weeks of occurrences for subscribed events
      for (const event of subscribedEvents) {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const eventDayIndex = dayNames.indexOf(event.day_of_week);
        
        for (let week = 0; week < 4; week++) {
          const eventDate = new Date(today);
          eventDate.setDate(today.getDate() + (week * 7));
          
          // Find the next occurrence of this day of the week
          while (eventDate.getDay() !== eventDayIndex) {
            eventDate.setDate(eventDate.getDate() + 1);
          }
          
          // Only add if it's in the future
          if (eventDate >= today) {
            subscribedRecurringEvents.push({
              id: `subscribed_event_${event.id}_${eventDate.toISOString().split('T')[0]}`,
              event_date: eventDate.toISOString().split('T')[0],
              event_name: event.event_name,
              day_of_week: event.day_of_week,
              start_time: event.start_time,
              end_time: event.end_time,
              location: event.location,
              child_name: event.child_name,
              type: event.type
            });
          }
        }
      }
    }

    console.log('Recurring assignments found:', recurringAssignments.length);
    console.log('Group recurring events found:', groupRecurringEvents.length);
    
    // Get ActivityGroups with schedules where user is a member (for the next 4 weeks)
    let activityGroupEvents = [];
    const [activityGroups] = await db.query(`
      SELECT DISTINCT ag.id, ag.name, ag.day_of_week, ag.start_time, ag.end_time, ag.location, ag.activity_type
      FROM ActivityGroups ag
      JOIN ActivityGroupMembers agm ON ag.id = agm.group_id
      WHERE agm.user_id = ? AND agm.is_active = TRUE AND ag.is_active = TRUE AND ag.has_schedule = TRUE
      ORDER BY ag.day_of_week, ag.start_time
    `, [userId]);

    // Generate next 4 weeks of occurrences for activity groups
    for (const group of activityGroups) {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const groupDayIndex = dayNames.indexOf(group.day_of_week);
      
      for (let week = 0; week < 4; week++) {
        const groupDate = new Date(today);
        groupDate.setDate(today.getDate() + (week * 7));
        
        // Find the next occurrence of this day of the week
        while (groupDate.getDay() !== groupDayIndex) {
          groupDate.setDate(groupDate.getDate() + 1);
        }
        
        // Only add if it's in the future
        if (groupDate >= today) {
          const group_date_str = groupDate.toISOString().split('T')[0];
          
          activityGroupEvents.push({
            id: `activity_group_${group.id}_${group_date_str}`,
            group_date: group_date_str,
            group_name: group.name,
            day_of_week: group.day_of_week,
            start_time: group.start_time,
            end_time: group.end_time,
            location: group.location,
            activity_type: group.activity_type,
            type: 'activity_group'
          });
        }
      }
    }

    // Get ActivityGroup assignments for each event (to show driver status)
    for (const event of activityGroupEvents) {
      const groupId = event.id.split('_')[2];
      const eventDate = event.group_date;
      
      // Get current assignments for this event (including parent-only assignments)
      const [assignments] = await db.query(`
        SELECT aga.*, u.name as driver_name, c.name as child_name
        FROM ActivityGroupAssignments aga
        JOIN Users u ON aga.user_id = u.id
        LEFT JOIN Children c ON aga.child_id = c.id
        WHERE aga.group_id = ? AND aga.assignment_date = ? AND aga.status = 'confirmed'
      `, [groupId, eventDate]);
      
      // Add assignment info to the event
      event.assignments = assignments;
      event.current_driver = assignments.length > 0 ? assignments[0].driver_name : 'Not assigned';
      event.group_id = groupId;
      
      // Get dropoff and pickup drivers
      const dropoffAssignment = assignments.find(a => a.assignment_type === 'dropoff');
      const pickupAssignment = assignments.find(a => a.assignment_type === 'pickup');
      
      event.dropoff_driver = dropoffAssignment ? dropoffAssignment.driver_name : 'Unassigned';
      event.pickup_driver = pickupAssignment ? pickupAssignment.driver_name : 'Unassigned';
    }

    console.log('Activity group events found:', activityGroupEvents.length);
    console.log('Subscribed recurring events found:', subscribedRecurringEvents.length);

    // Format events for FullCalendar
    calendarEvents = [
      ...rideOffers.map(offer => ({
        id: `offer_${offer.id}`,
        title: `Drive: To ${offer.dropoff_location}`,
        start: offer.pickup_time,
        description: `${offer.pickup_location} → ${offer.dropoff_location}`,
        backgroundColor: '#dc3545',
        borderColor: '#c82333',
        type: offer.type
      })),
      ...assignedRides.map(ride => ({
        id: `ride_${ride.id}`,
        title: `Drive: ${ride.child_name}`,
        start: ride.pickup_time,
        description: `${ride.pickup_location} → ${ride.dropoff_location || 'Unknown'}`,
        backgroundColor: '#dc3545',
        borderColor: '#c82333',
        type: ride.type,
        status: ride.status || 'assigned'
      })),
      ...childrenRides.map(ride => ({
        id: `child_ride_${ride.id}`,
        title: `Ride: ${ride.child_name}`,
        start: ride.pickup_time,
        description: `${ride.pickup_location} → ${ride.dropoff_location || 'Unknown'}`,
        backgroundColor: '#28a745',
        borderColor: '#1e7e34',
        type: ride.type,
        driver_name: ride.driver_name,
        status: ride.status || (ride.assigned_user_id ? 'assigned' : 'pending')
      })),
      ...myRideRequests.map(ride => ({
        id: `my_ride_${ride.id}`,
        title: `My Request: ${ride.child_name}`,
        start: ride.pickup_time,
        description: `${ride.pickup_location} → ${ride.dropoff_location || 'Unknown'}`,
        backgroundColor: '#007bff',
        borderColor: '#0056b3',
        type: ride.type,
        driver_name: ride.driver_name,
        status: ride.status || (ride.assigned_user_id ? 'assigned' : 'pending')
      })),
      ...recurringAssignments.map(event => ({
        id: `event_${event.event_id}_${event.event_date}_${event.child_name.replace(/\s+/g, '_')}`,
        title: `${event.event_name} (${event.child_name})`,
        start: `${event.event_date}T${event.start_time}`,
        end: event.end_time ? `${event.event_date}T${event.end_time}` : undefined,
        description: `${event.location}`,
        backgroundColor: '#ffc107',
        borderColor: '#e0a800',
        type: event.type
      })),
      ...groupRecurringEvents.map(event => ({
        id: event.id,
        title: `${event.event_name}`,
        start: `${event.event_date}T${event.start_time}`,
        end: event.end_time ? `${event.event_date}T${event.end_time}` : undefined,
        description: `${event.location}`,
        backgroundColor: '#007bff',
        borderColor: '#0056b3',
        type: event.type,
        dropoff_driver: event.dropoff_driver,
        pickup_driver: event.pickup_driver,
        instance_id: event.instance_id
      })),
      ...subscribedRecurringEvents.map(event => ({
        id: event.id,
        title: `${event.event_name} (${event.child_name})`,
        start: `${event.event_date}T${event.start_time}`,
        end: event.end_time ? `${event.event_date}T${event.end_time}` : undefined,
        description: `${event.location}`,
        backgroundColor: '#6c757d',
        borderColor: '#5a6268',
        type: event.type
      }))
    ];

    // Add activity group events to calendar
    calendarEvents = [
      ...calendarEvents,
      ...activityGroupEvents.map(event => ({
        id: event.id,
        title: `${event.group_name}`,
        start: `${event.group_date}T${event.start_time}`,
        end: event.end_time ? `${event.group_date}T${event.end_time}` : undefined,
        description: `${event.location}`,
        backgroundColor: '#17a2b8',
        borderColor: '#138496',
        type: event.type,
        activity_type: event.activity_type,
        dropoff_driver: event.dropoff_driver,
        pickup_driver: event.pickup_driver
      }))
    ];

    console.log('Total calendar events:', calendarEvents.length);
    console.log('Calendar events:', calendarEvents);

    // Load user affiliations
    const [affiliations] = await db.query('SELECT * FROM UserAffiliations WHERE user_id = ?', [userId]);
    // Load all organizations for the wizard
    const [organizations] = await db.query('SELECT * FROM Organizations ORDER BY name ASC');

    // Get user's trusted groups for dashboard integration
    const [trustedGroups] = await db.query(`
      SELECT 
        tg.*,
        COUNT(tgm2.user_id) as member_count
      FROM TrustedGroups tg
      LEFT JOIN TrustedGroupMembers tgm ON tg.id = tgm.group_id
      LEFT JOIN TrustedGroupMembers tgm2 ON tg.id = tgm2.group_id
      WHERE tgm.user_id = ? OR tg.creator_id = ?
      GROUP BY tg.id
      ORDER BY tg.created_at DESC
      LIMIT 3
    `, [userId, userId]);

    // Get recent short notice requests for dashboard
    const [recentShortNoticeRequests] = await db.query(`
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
      WHERE tgm.user_id = ? AND snr.status = 'pending'
      GROUP BY snr.id
      ORDER BY snr.created_at DESC
      LIMIT 5
    `, [userId]);

    // Get my short notice requests for dashboard
    const [myShortNoticeRequests] = await db.query(`
      SELECT 
        snr.*,
        tg.name as group_name,
        COUNT(snresp.id) as response_count
      FROM ShortNoticeRequests snr
      JOIN TrustedGroups tg ON snr.group_id = tg.id
      LEFT JOIN ShortNoticeResponses snresp ON snr.id = snresp.request_id
      WHERE snr.requester_id = ? AND snr.status = 'pending'
      GROUP BY snr.id
      ORDER BY snr.created_at DESC
      LIMIT 3
    `, [userId]);

    // Determine if profile is incomplete
    // const missingAddress = !user.home_address;
    // const missingChildren = children.length === 0;
    // const missingAffiliations = affiliations.length === 0;
    // const showProfileWizard = missingAddress || missingChildren || missingAffiliations;
    const showProfileWizard = user.profile_completed !== 1 && user.profile_completed !== '1';

    // DEBUG PRINT
    console.log('DEBUG: user.profile_completed =', user.profile_completed, 'showProfileWizard =', showProfileWizard);
    console.log('DEBUG: trustedGroups =', trustedGroups.length, 'items');
    console.log('DEBUG: recentShortNoticeRequests =', recentShortNoticeRequests.length, 'items');
    console.log('DEBUG: myShortNoticeRequests =', myShortNoticeRequests.length, 'items');

    res.render('dashboard', {
      session: req.session,
      user,
      children,
      neighbors,
      privateCount,
      groupInvitations,
      calendarEvents,
      trustedGroups,
      recentShortNoticeRequests,
      myShortNoticeRequests,
      success: req.session.success,
      error: req.session.error,
      organizations,
      affiliations,
      showProfileWizard
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
  const { home_address, home_lat, home_lng, is_address_private } = req.body;

  console.log('Update address request:', { home_address, home_lat, home_lng, is_address_private });

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
    // Fix: Properly handle checkbox value - if it's 'on' then true, otherwise false
    const isPrivate = is_address_private === 'on' ? 1 : 0;
    
    await db.query(
      'UPDATE Users SET home_address = ?, home_lat = ?, home_lng = ?, is_address_private = ? WHERE id = ?',
      [home_address, parseFloat(lat), parseFloat(lng), isPrivate, userId]
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

  let childId = null;
  let childUserId = null;
  try {
    // If a username is provided, check for uniqueness first
    if (child_username) {
      const [[existingUser]] = await db.query(
        'SELECT id FROM Users WHERE username = ? OR email = ?',
        [child_username.trim(), `${child_username.trim()}@child.local`]
      );
      if (existingUser) {
        req.session.error = `Username '${child_username.trim()}' is already taken. Please choose another username.`;
        return res.redirect('/dashboard');
      }
    }

    // Look up organization_id from school name
    const [[org]] = await db.query('SELECT id FROM Organizations WHERE name = ? AND type = "school"', [school.trim()]);
    const organizationId = org ? org.id : null;

    // Insert child row
    const [childResult] = await db.query(
      'INSERT INTO Children (user_id, name, school, club) VALUES (?, ?, ?, ?)',
      [parentId, name.trim(), school.trim(), club?.trim() || null]
    );
    childId = childResult.insertId;

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
        const [childUserResult] = await db.query(
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
        childUserId = childUserResult.insertId;
      } catch (err) {
        // If user creation fails, delete the child row and parent-child link
        await db.query('DELETE FROM ParentChild WHERE child_id = ?', [childId]);
        await db.query('DELETE FROM Children WHERE id = ?', [childId]);
        console.error("❌ Failed to create child login account:", err.message);
        req.session.error = `Child profile could not be created: ${err.message}`;
        return res.redirect('/dashboard');
      }
    }

    // Create UserAffiliations if organization was found
    if (organizationId) {
      // Parent affiliation
      await db.query(
        'INSERT INTO UserAffiliations (user_id, child_id, organization_id, role, created_at) VALUES (?, ?, ?, ?, NOW())',
        [parentId, childId, organizationId, 'parent']
      );
      
      // Child affiliation (if child user account was created)
      if (childUserId) {
        await db.query(
          'INSERT INTO UserAffiliations (user_id, child_id, organization_id, role, created_at) VALUES (?, ?, ?, ?, NOW())',
          [childUserId, childId, organizationId, 'child']
        );
      }
    }

    req.session.success = `✅ Child '${name}' added${child_username ? ' with login' : ''}.`;
    res.redirect('/dashboard');
  } catch (err) {
    // If child row was created but something else failed, clean up
    if (childId) {
      await db.query('DELETE FROM ParentChild WHERE child_id = ?', [childId]);
      await db.query('DELETE FROM Children WHERE id = ?', [childId]);
    }
    console.error('❌ Add child error:', err.message, '\n', err.stack);
    req.session.error = `Something went wrong while adding the child: ${err.message}`;
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

    // Look up organization_id from school name
    const [[org]] = await db.query('SELECT id FROM Organizations WHERE name = ? AND type = "school"', [school.trim()]);
    const organizationId = org ? org.id : null;

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

    // Update UserAffiliations
    if (organizationId) {
      // Remove old affiliations for this child
      await db.query('DELETE FROM UserAffiliations WHERE child_id = ?', [childId]);
      
      // Get all parents for this child
      const [parents] = await db.query('SELECT parent_id FROM ParentChild WHERE child_id = ?', [childId]);
      
      // Create new affiliations for all parents
      for (const parent of parents) {
        await db.query(
          'INSERT INTO UserAffiliations (user_id, child_id, organization_id, role, created_at) VALUES (?, ?, ?, ?, NOW())',
          [parent.parent_id, childId, organizationId, 'parent']
        );
      }
      
      // Create affiliation for child user account if it exists
      if (user) {
        await db.query(
          'INSERT INTO UserAffiliations (user_id, child_id, organization_id, role, created_at) VALUES (?, ?, ?, ?, NOW())',
          [user.id, childId, organizationId, 'child']
        );
      }
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
      // Delete UserAffiliations for this child
      await db.query('DELETE FROM UserAffiliations WHERE child_id = ?', [childId]);
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

// GET /api/calendar-events
// Returns all rides and recurring events for the logged-in user and their children in FullCalendar JSON format
router.get('/api/calendar-events', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ error: 'Not logged in' });

  try {
    // 1. Get user's children IDs
    const [children] = await db.query(
      'SELECT c.id, c.name FROM Children c JOIN ParentChild pc ON pc.child_id = c.id WHERE pc.parent_id = ?',
      [userId]
    );
    const childIds = children.map(c => c.id);

    // 2. Get rides where user is a driver or passenger (for themselves or their children)
    // Example: RideOffers (as driver)
    const [rideOffers] = await db.query(
      'SELECT id, date, start_time, end_time, from_location, to_location FROM RideOffers WHERE driver_id = ? AND date >= CURDATE()',
      [userId]
    );
    // Example: RideBookings (as passenger for children)
    let rideBookings = [];
    if (childIds.length > 0) {
      [rideBookings] = await db.query(
        'SELECT rb.id, rb.date, rb.start_time, rb.end_time, rb.from_location, rb.to_location, c.name as child_name FROM RideBookings rb JOIN Children c ON rb.child_id = c.id WHERE rb.child_id IN (?) AND rb.date >= CURDATE()',
        [childIds]
      );
    }

    // 3. Get recurring events (for user and children)
    // For simplicity, show next 30 days of assignments
    let recurringAssignments = [];
    if (childIds.length > 0) {
      [recurringAssignments] = await db.query(
        `SELECT ea.event_id, ea.event_date, re.name as event_name, re.day_of_week, re.start_time, re.end_time, re.location, c.name as child_name,
                GROUP_CONCAT(ea.assignment_type ORDER BY ea.assignment_type) AS assignment_types
         FROM EventAssignments ea
         JOIN RecurringEvents re ON ea.event_id = re.id
         JOIN Children c ON ea.child_id = c.id
         WHERE ea.child_id IN (?) AND ea.event_date >= CURDATE() AND ea.event_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
         GROUP BY ea.event_id, ea.event_date, re.name, re.day_of_week, re.start_time, re.end_time, re.location, c.name`,
        [childIds]
      );
    }

    // Get recurring events where user is a group member (for the next 4 weeks)
    let groupRecurringEvents = [];
    const [groupEvents] = await db.query(`
      SELECT DISTINCT re.id, re.name as event_name, re.day_of_week, re.start_time, re.end_time, re.location
      FROM RecurringEvents re
      JOIN EventGroupMembers egm ON re.id = egm.event_id
      WHERE egm.user_id = ? AND egm.is_active = TRUE AND re.is_active = TRUE
      ORDER BY re.day_of_week, re.start_time
    `, [userId]);

    // Generate next 4 weeks of occurrences for group events
    const today = new Date();
    for (const event of groupEvents) {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const eventDayIndex = dayNames.indexOf(event.day_of_week);
      
      for (let week = 0; week < 4; week++) {
        const eventDate = new Date(today);
        eventDate.setDate(today.getDate() + (week * 7));
        
        // Find the next occurrence of this day of the week
        while (eventDate.getDay() !== eventDayIndex) {
          eventDate.setDate(eventDate.getDate() + 1);
        }
        
        // Only add if it's in the future
        if (eventDate >= today) {
          groupRecurringEvents.push({
            id: `group_event_${event.id}_${eventDate.toISOString().split('T')[0]}`,
            event_date: eventDate.toISOString().split('T')[0],
            event_name: event.event_name,
            day_of_week: event.day_of_week,
            start_time: event.start_time,
            end_time: event.end_time,
            location: event.location
          });
        }
      }
    }

    // Get recurring events where user's children are subscribed (for the next 4 weeks)
    let subscribedRecurringEvents = [];
    if (childIds.length > 0) {
      const [subscribedEvents] = await db.query(`
        SELECT DISTINCT re.id, re.name as event_name, re.day_of_week, re.start_time, re.end_time, re.location, c.name as child_name
        FROM RecurringEvents re
        JOIN EventSubscriptions es ON re.id = es.event_id
        JOIN Children c ON es.child_id = c.id
        WHERE es.child_id IN (?) AND re.is_active = TRUE
        ORDER BY re.day_of_week, re.start_time
      `, [childIds]);

      // Generate next 4 weeks of occurrences for subscribed events
      for (const event of subscribedEvents) {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const eventDayIndex = dayNames.indexOf(event.day_of_week);
        
        for (let week = 0; week < 4; week++) {
          const eventDate = new Date(today);
          eventDate.setDate(today.getDate() + (week * 7));
          
          // Find the next occurrence of this day of the week
          while (eventDate.getDay() !== eventDayIndex) {
            eventDate.setDate(eventDate.getDate() + 1);
          }
          
          // Only add if it's in the future
          if (eventDate >= today) {
            subscribedRecurringEvents.push({
              id: `subscribed_event_${event.id}_${eventDate.toISOString().split('T')[0]}`,
              event_date: eventDate.toISOString().split('T')[0],
              event_name: event.event_name,
              day_of_week: event.day_of_week,
              start_time: event.start_time,
              end_time: event.end_time,
              location: event.location,
              child_name: event.child_name
            });
          }
        }
      }
    }

    // 4. Format all events for FullCalendar
    const events = [];
    // Ride offers (as driver)
    for (const offer of rideOffers) {
      events.push({
        title: `Drive: ${offer.from_location} → ${offer.to_location}`,
        start: `${offer.date}T${offer.start_time}`,
        end: offer.end_time ? `${offer.date}T${offer.end_time}` : undefined,
        description: 'You are the driver for this ride.'
      });
    }
    // Ride bookings (as passenger for children)
    for (const booking of rideBookings) {
      events.push({
        title: `Ride for ${booking.child_name}: ${booking.from_location} → ${booking.to_location}`,
        start: `${booking.date}T${booking.start_time}`,
        end: booking.end_time ? `${booking.date}T${booking.end_time}` : undefined,
        description: `Your child ${booking.child_name} is booked for this ride.`
      });
    }
    // Recurring assignments (for children)
    for (const assignment of recurringAssignments) {
      events.push({
        title: `Event: ${assignment.event_name} (${assignment.child_name})`,
        start: `${assignment.event_date}T${assignment.start_time}`,
        end: assignment.end_time ? `${assignment.event_date}T${assignment.end_time}` : undefined,
        description: `${assignment.child_name} has ${assignment.event_name} at ${assignment.location}`
      });
    }

    // Group recurring events
    for (const event of groupRecurringEvents) {
      events.push({
        title: `${event.event_name}`,
        start: `${event.event_date}T${event.start_time}`,
        end: event.end_time ? `${event.event_date}T${event.end_time}` : undefined,
        description: `${event.location}`,
        backgroundColor: '#007bff',
        borderColor: '#0056b3',
        type: 'group_recurring'
      });
    }

    // Subscribed recurring events
    for (const event of subscribedRecurringEvents) {
      events.push({
        title: `${event.event_name} (${event.child_name})`,
        start: `${event.event_date}T${event.start_time}`,
        end: event.end_time ? `${event.event_date}T${event.end_time}` : undefined,
        description: `${event.location}`,
        backgroundColor: '#6c757d',
        borderColor: '#5a6268',
        type: 'subscribed_recurring'
      });
    }

    // 5. Get ride requests where user is the assigned driver
    const [assignedRideRequests] = await db.query(
      'SELECT rr.id, rr.pickup_time, rr.pickup_location, rr.dropoff_location, c.name as child_name FROM RideRequests rr JOIN Children c ON rr.child_id = c.id WHERE rr.assigned_user_id = ? AND rr.pickup_time >= NOW()',
      [userId]
    );
    // Add assigned ride requests to events
    for (const request of assignedRideRequests) {
      events.push({
        title: `Drive for ${request.child_name}: ${request.pickup_location} → ${request.dropoff_location}`,
        start: request.pickup_time,
        description: `You are the assigned driver for ${request.child_name} from ${request.pickup_location} to ${request.dropoff_location}.`
      });
    }

    res.json(events);
  } catch (err) {
    console.error('Calendar events error:', err);
    res.status(500).json({ error: 'Failed to load calendar events' });
  }
});

// Standalone calendar test page for troubleshooting FullCalendar
router.get('/calendar-test', (req, res) => {
  res.render('calendar-test');
});

// GET /calendar - Detailed calendar page
router.get('/calendar', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.redirect('/login');

  try {
    // Get user's children using ParentChild join
    const [children] = await db.query(`
      SELECT c.* FROM Children c
      JOIN ParentChild pc ON pc.child_id = c.id
      WHERE pc.parent_id = ?
    `, [userId]);

    // Get calendar events (same logic as dashboard)
    const childIds = children.map(c => c.id);
    let calendarEvents = [];
    
    // Define today for date calculations
    const today = new Date();
    
    // Get ride offers where user is the driver (RideOffers)
    const [rideOffers] = await db.query(`
      SELECT ro.id, ro.pickup_time, ro.school as dropoff_location, 'Home' as pickup_location, 'offer' as type
      FROM RideOffers ro 
      WHERE ro.user_id = ? AND ro.pickup_time >= NOW()
    `, [userId]);
    
    // Get ride requests where user is assigned as driver (RideRequests)
    const [assignedRides] = await db.query(`
      SELECT rr.id, rr.pickup_time, rr.pickup_location, rr.dropoff_location, c.name as child_name, 
             rr.status, rr.assigned_user_id, 'request' as type
      FROM RideRequests rr 
      JOIN Children c ON rr.child_id = c.id 
      WHERE rr.assigned_user_id = ? AND rr.pickup_time >= NOW()
    `, [userId]);

    // Get ride requests for user's children (if they have children)
    let childrenRides = [];
    if (childIds.length > 0) {
      [childrenRides] = await db.query(`
        SELECT rr.id, rr.pickup_time, rr.pickup_location, rr.dropoff_location, c.name as child_name, 
               rr.status, rr.assigned_user_id, u.name as driver_name, 'child_request' as type
        FROM RideRequests rr 
        JOIN Children c ON rr.child_id = c.id 
        LEFT JOIN Users u ON rr.assigned_user_id = u.id
        WHERE rr.child_id IN (?) AND rr.pickup_time >= NOW()
      `, [childIds]);
    }

    // Get ride requests created by the user (for their children)
    let myRideRequests = [];
    if (childIds.length > 0) {
      [myRideRequests] = await db.query(`
        SELECT rr.id, rr.pickup_time, rr.pickup_location, rr.dropoff_location, c.name as child_name, 
               rr.status, rr.assigned_user_id, u.name as driver_name, 'my_request' as type
        FROM RideRequests rr 
        JOIN Children c ON rr.child_id = c.id 
        LEFT JOIN Users u ON rr.assigned_user_id = u.id
        WHERE rr.user_id = ? AND rr.pickup_time >= NOW() AND rr.assigned_user_id IS NULL
      `, [userId]);
    }

    // Get recurring event assignments for user's children (if they have children)
    let recurringAssignments = [];
    if (childIds.length > 0) {
      [recurringAssignments] = await db.query(`
        SELECT ea.event_id, ea.event_date, re.name as event_name, re.day_of_week, re.start_time, re.end_time, re.location, c.name as child_name, 'recurring' as type,
               GROUP_CONCAT(ea.assignment_type ORDER BY ea.assignment_type) AS assignment_types
        FROM EventAssignments ea
        JOIN RecurringEvents re ON ea.event_id = re.id
        JOIN Children c ON ea.child_id = c.id
        WHERE ea.child_id IN (?) AND ea.event_date >= CURDATE() AND ea.status != 'cancelled' AND ea.is_cancelled = FALSE
        GROUP BY ea.event_id, ea.event_date, re.name, re.day_of_week, re.start_time, re.end_time, re.location, c.name
        ORDER BY ea.event_date ASC
      `, [childIds]);
    }

    // Get recurring events where user is a group member (for the next 4 weeks)
    let groupRecurringEvents = [];
    const [groupEvents] = await db.query(`
      SELECT DISTINCT re.id, re.name as event_name, re.day_of_week, re.start_time, re.end_time, re.location, 'group_recurring' as type
      FROM RecurringEvents re
      JOIN EventGroupMembers egm ON re.id = egm.event_id
      WHERE egm.user_id = ? AND egm.is_active = TRUE AND re.is_active = TRUE
      ORDER BY re.day_of_week, re.start_time
    `, [userId]);

    // Generate next 4 weeks of occurrences for group events
    for (const event of groupEvents) {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const eventDayIndex = dayNames.indexOf(event.day_of_week);
      
      for (let week = 0; week < 4; week++) {
        const eventDate = new Date(today);
        eventDate.setDate(today.getDate() + (week * 7));
        
        // Find the next occurrence of this day of the week
        while (eventDate.getDay() !== eventDayIndex) {
          eventDate.setDate(eventDate.getDate() + 1);
        }
        
        // Only add if it's in the future
        if (eventDate >= today) {
          const event_date_str = eventDate.toISOString().split('T')[0];
          // Query all dropoff and pickup assignments for this event/date
          const [dropoffDrivers] = await db.query(
            `SELECT DISTINCT u.name AS driver_name FROM EventAssignments ea
             JOIN Users u ON ea.user_id = u.id
             WHERE ea.event_id = ? AND ea.event_date = ? AND ea.assignment_type = 'dropoff' AND ea.is_cancelled = FALSE`,
            [event.id, event_date_str]
          );
          const [pickupDrivers] = await db.query(
            `SELECT DISTINCT u.name AS driver_name FROM EventAssignments ea
             JOIN Users u ON ea.user_id = u.id
             WHERE ea.event_id = ? AND ea.event_date = ? AND ea.assignment_type = 'pickup' AND ea.is_cancelled = FALSE`,
            [event.id, event_date_str]
          );
          const dropoff_driver = dropoffDrivers.length > 0
            ? dropoffDrivers.map(d => d.driver_name).join(', ')
            : 'Unassigned';
          const pickup_driver = pickupDrivers.length > 0
            ? pickupDrivers.map(d => d.driver_name).join(', ')
            : 'Unassigned';
          // Get the EventInstances.id for this event/date
          const [[instance]] = await db.query(
            'SELECT id FROM EventInstances WHERE event_id = ? AND event_date = ?',
            [event.id, event_date_str]
          );
          groupRecurringEvents.push({
            id: `group_event_${event.id}_${event_date_str}`,
            event_date: event_date_str,
            event_name: event.event_name,
            day_of_week: event.day_of_week,
            start_time: event.start_time,
            end_time: event.end_time,
            location: event.location,
            type: 'group_recurring',
            dropoff_driver: dropoff_driver,
            pickup_driver: pickup_driver,
            instance_id: instance ? instance.id : null
          });
        }
      }
    }

    // Get recurring events where user's children are subscribed (for the next 4 weeks)
    let subscribedRecurringEvents = [];
    if (childIds.length > 0) {
      const [subscribedEvents] = await db.query(`
        SELECT DISTINCT re.id, re.name as event_name, re.day_of_week, re.start_time, re.end_time, re.location, c.name as child_name, 'subscribed_recurring' as type
        FROM RecurringEvents re
        JOIN EventSubscriptions es ON re.id = es.event_id
        JOIN Children c ON es.child_id = c.id
        WHERE es.child_id IN (?) AND re.is_active = TRUE
        ORDER BY re.day_of_week, re.start_time
      `, [childIds]);

      // Generate next 4 weeks of occurrences for subscribed events
      for (const event of subscribedEvents) {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const eventDayIndex = dayNames.indexOf(event.day_of_week);
        
        for (let week = 0; week < 4; week++) {
          const eventDate = new Date(today);
          eventDate.setDate(today.getDate() + (week * 7));
          
          // Find the next occurrence of this day of the week
          while (eventDate.getDay() !== eventDayIndex) {
            eventDate.setDate(eventDate.getDate() + 1);
          }
          
          // Only add if it's in the future
          if (eventDate >= today) {
            subscribedRecurringEvents.push({
              id: `subscribed_event_${event.id}_${eventDate.toISOString().split('T')[0]}`,
              event_date: eventDate.toISOString().split('T')[0],
              event_name: event.event_name,
              day_of_week: event.day_of_week,
              start_time: event.start_time,
              end_time: event.end_time,
              location: event.location,
              child_name: event.child_name,
              type: event.type
            });
          }
        }
      }
    }

    // Format events for FullCalendar
    calendarEvents = [
      ...rideOffers.map(offer => ({
        id: `offer_${offer.id}`,
        title: `Drive: To ${offer.dropoff_location}`,
        start: offer.pickup_time, // Use the original date string directly
        description: `${offer.pickup_location} → ${offer.dropoff_location}`,
        backgroundColor: '#dc3545',
        borderColor: '#c82333',
        type: offer.type
      })),
      ...assignedRides.map(ride => ({
        id: `ride_${ride.id}`,
        title: `Drive: ${ride.child_name}`,
        start: ride.pickup_time, // Use the original date string directly
        description: `${ride.pickup_location} → ${ride.dropoff_location || 'Unknown'}`,
        backgroundColor: '#dc3545',
        borderColor: '#c82333',
        type: ride.type,
        status: ride.status || 'assigned'
      })),
      ...childrenRides.map(ride => ({
        id: `child_ride_${ride.id}`,
        title: `Ride: ${ride.child_name}`,
        start: ride.pickup_time, // Use the original date string directly
        description: `${ride.pickup_location} → ${ride.dropoff_location || 'Unknown'}`,
        backgroundColor: '#28a745',
        borderColor: '#1e7e34',
        type: ride.type,
        driver_name: ride.driver_name,
        status: ride.status || (ride.assigned_user_id ? 'assigned' : 'pending')
      })),
      ...myRideRequests.map(ride => ({
        id: `my_ride_${ride.id}`,
        title: `My Request: ${ride.child_name}`,
        start: ride.pickup_time, // Use the original date string directly
        description: `${ride.pickup_location} → ${ride.dropoff_location || 'Unknown'}`,
        backgroundColor: '#007bff', // A different color for my requests
        borderColor: '#0056b3',
        type: ride.type,
        driver_name: ride.driver_name,
        status: ride.status || (ride.assigned_user_id ? 'assigned' : 'pending')
      })),
      ...recurringAssignments.map(event => ({
        id: `event_${event.event_id}_${event.event_date}_${event.child_name.replace(/\s+/g, '_')}`,
        title: `${event.event_name} (${event.child_name})`,
        start: `${event.event_date}T${event.start_time}`,
        end: event.end_time ? `${event.event_date}T${event.end_time}` : undefined,
        description: `${event.location}`,
        backgroundColor: '#ffc107',
        borderColor: '#e0a800',
        type: event.type
      })),
      ...groupRecurringEvents.map(event => ({
        id: event.id,
        title: `${event.event_name}`,
        start: `${event.event_date}T${event.start_time}`,
        end: event.end_time ? `${event.event_date}T${event.end_time}` : undefined,
        description: `${event.location}`,
        backgroundColor: '#007bff',
        borderColor: '#0056b3',
        type: event.type,
        dropoff_driver: event.dropoff_driver,
        pickup_driver: event.pickup_driver,
        instance_id: event.instance_id
      })),
      ...subscribedRecurringEvents.map(event => ({
        id: event.id,
        title: `${event.event_name} (${event.child_name})`,
        start: `${event.event_date}T${event.start_time}`,
        end: event.end_time ? `${event.event_date}T${event.end_time}` : undefined,
        description: `${event.location}`,
        backgroundColor: '#6c757d',
        borderColor: '#5a6268',
        type: event.type
      }))
    ];

    res.render('calendar-detail', {
      session: req.session,
      children,
      calendarEvents
    });
  } catch (err) {
    console.error('Calendar page error:', err);
    res.status(500).send('Failed to load calendar page.');
  }
});

// API: Save home address from profile wizard
router.post('/api/profile/address', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ error: 'Not logged in' });
  const { home_address, home_lat, home_lng, is_address_private } = req.body;
  if (!home_address || !home_lat || !home_lng) {
    return res.status(400).json({ error: 'Address, latitude, and longitude are required.' });
  }
  try {
    const isPrivate = is_address_private === true || is_address_private === 'true' || is_address_private === 'on' ? 1 : 0;
    await db.query(
      'UPDATE Users SET home_address = ?, home_lat = ?, home_lng = ?, is_address_private = ? WHERE id = ?',
      [home_address, parseFloat(home_lat), parseFloat(home_lng), isPrivate, userId]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('Wizard address save error:', err);
    return res.status(500).json({ error: 'Failed to save address.' });
  }
});

// API: Save children from profile wizard
router.post('/api/profile/children', async (req, res) => {
  console.log('🧙‍♂️ API: ==========================================');
  console.log('🧙‍♂️ API: WIZARD API CALLED!');
  console.log('🧙‍♂️ API: Request method:', req.method);
  console.log('🧙‍♂️ API: Request URL:', req.url);
  console.log('🧙‍♂️ API: Request headers:', req.headers);
  console.log('🧙‍♂️ API: Request body:', req.body);
  console.log('🧙‍♂️ API: Session user ID:', req.session.userId);
  console.log('🧙‍♂️ API: Received children data:', JSON.stringify(req.body, null, 2));
  console.log('🧙‍♂️ API: Timestamp:', new Date().toISOString());
  
  const parentId = req.session.userId;
  if (!parentId) {
    console.log('🧙‍♂️ API: ERROR - Not logged in!');
    return res.status(401).json({ success: false, error: 'Not logged in' });
  }
  
  const { children } = req.body;
  if (!Array.isArray(children) || children.length === 0) {
    console.log('🧙‍♂️ API: ERROR - Invalid children data!');
    return res.status(400).json({ success: false, error: 'At least one child is required.' });
  }
  
  // Process children without transactions to avoid connection issues
  try {
    console.log('🧙‍♂️ API: Processing children without transactions');
    
    for (const child of children) {
      const { name, organization_id, org_id, club, username, password } = child;
      const actualOrgId = organization_id || org_id;
      
      console.log('🧙‍♂️ API: Processing child:', { name, actualOrgId, username });
      
      if (!name || !actualOrgId || !username || !password) {
        return res.status(400).json({ success: false, error: 'Each child must have a name, organization, username, and password.' });
      }
      
      // Check for existing username/email
      const [[existingUser]] = await db.query(
        'SELECT id FROM Users WHERE username = ? OR email = ?',
        [username.trim(), `${username.trim()}@child.local`]
      );
      if (existingUser) {
        return res.status(400).json({ success: false, error: `Username '${username.trim()}' is already taken. Please choose another username.` });
      }
      
      // Lookup organization name by organization_id
      const [[org]] = await db.query('SELECT name FROM Organizations WHERE id = ?', [actualOrgId]);
      if (!org) {
        return res.status(400).json({ success: false, error: `Organization not found for child: ${name}` });
      }
      
      // Insert child
      const [childResult] = await db.query(
        'INSERT INTO Children (user_id, name, school, club) VALUES (?, ?, ?, ?)',
        [parentId, name.trim(), org.name, club?.trim() || null]
      );
      const childId = childResult.insertId;
      console.log('🧙‍♂️ API: Created child record with ID:', childId);
      
      // Create ParentChild link
      await db.query(
        'INSERT INTO ParentChild (parent_id, child_id) VALUES (?, ?)',
        [parentId, childId]
      );
      console.log('🧙‍♂️ API: Created ParentChild link');
      
      // Create child user account
      const hashedPassword = await bcrypt.hash(password, 10);
      const [childUserResult] = await db.query(
        `INSERT INTO Users (name, username, email, password_hash, role, parent_id, child_profile_id)
         VALUES (?, ?, ?, ?, 'child', ?, ?)`,
        [
          name.trim(),
          username.trim(),
          `${username.trim()}@child.local`,
          hashedPassword,
          parentId,
          childId
        ]
      );
      const childUserId = childUserResult.insertId;
      console.log('🧙‍♂️ API: Created child user account with ID:', childUserId);
      
      // Create UserAffiliations for both parent and child (using admin-style approach)
      console.log('🧙‍♂️ API: Creating UserAffiliations for child:', name, 'childId:', childId, 'orgId:', actualOrgId);
      
      // Parent affiliation (like admin interface)
      console.log('🧙‍♂️ API: Creating parent affiliation:', { parentId, childId, actualOrgId });
      await db.query(
        'INSERT INTO UserAffiliations (user_id, child_id, organization_id, role, created_at) VALUES (?, ?, ?, ?, NOW())',
        [parentId, childId, actualOrgId, 'parent']
      );
      console.log('🧙‍♂️ API: ✅ Parent affiliation created');
      
      // Child affiliation (like admin interface)
      console.log('🧙‍♂️ API: Creating child affiliation:', { childUserId, childId, actualOrgId });
      await db.query(
        'INSERT INTO UserAffiliations (user_id, child_id, organization_id, role, created_at) VALUES (?, ?, ?, ?, NOW())',
        [childUserId, childId, actualOrgId, 'child']
      );
      console.log('🧙‍♂️ API: ✅ Child affiliation created');
    }
    
    console.log('🧙‍♂️ API: All children processed successfully');
    return res.json({ success: true });
    
  } catch (err) {
    console.error('🧙‍♂️ API: Wizard children save error:', err);
    console.error('🧙‍♂️ API: Error message:', err.message);
    console.error('🧙‍♂️ API: Error code:', err.code);
    
    return res.status(500).json({ success: false, error: 'Failed to save children.' });
  }
});

// Add endpoint to mark profile as completed
router.post('/api/profile/complete', async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ success: false, error: 'Not logged in' });
    await db.query('UPDATE Users SET profile_completed = 1 WHERE id = ?', [userId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error marking profile as completed:', err);
    res.status(500).json({ success: false, error: 'Failed to mark profile as completed' });
  }
});

// API: Get UserAffiliations for debugging
router.get('/api/user-affiliations', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ error: 'Not logged in' });
  
  try {
    const [affiliations] = await db.query(`
      SELECT ua.*, u.name as user_name, c.name as child_name, o.name as organization_name
      FROM UserAffiliations ua
      JOIN Users u ON ua.user_id = u.id
      JOIN Children c ON ua.child_id = c.id
      JOIN Organizations o ON ua.organization_id = o.id
      WHERE ua.user_id = ?
      ORDER BY ua.created_at DESC
    `, [userId]);
    
    return res.json({ success: true, affiliations });
  } catch (err) {
    console.error('Get user affiliations error:', err);
    return res.status(500).json({ error: 'Failed to get user affiliations.' });
  }
});

module.exports = router;