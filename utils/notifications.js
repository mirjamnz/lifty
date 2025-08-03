// utils/notifications.js
const db = require('../db');

// Create a notification for a user
async function createNotification(userId, type, title, message, relatedType = null, relatedId = null) {
  try {
    await db.query(`
      INSERT INTO Notifications (user_id, type, title, message, related_type, related_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [userId, type, title, message, relatedType, relatedId]);
    
    console.log(`✅ Notification created for user ${userId}: ${title}`);
    return true;
  } catch (err) {
    console.error('❌ Error creating notification:', err);
    return false;
  }
}

// Create a trusted group notification
async function createTrustedGroupNotification(groupId, userId, notificationType, title, message, relatedRequestId = null) {
  try {
    await db.query(`
      INSERT INTO TrustedGroupNotifications (group_id, user_id, notification_type, title, message, related_request_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [groupId, userId, notificationType, title, message, relatedRequestId]);
    
    console.log(`✅ Trusted group notification created for user ${userId}: ${title}`);
    return true;
  } catch (err) {
    console.error('❌ Error creating trusted group notification:', err);
    return false;
  }
}

// Notify user when added to a trusted group
async function notifyUserAddedToGroup(groupId, userId, groupName, addedBy) {
  const title = `Added to Trusted Group`;
  const message = `You have been added to the trusted group "${groupName}" by ${addedBy}. You can now send and receive ride requests within this group.`;
  
  // Only create trusted group notification (not both general and trusted group)
  await createTrustedGroupNotification(groupId, userId, 'member_added', title, message);
}

// Notify user when removed from a trusted group
async function notifyUserRemovedFromGroup(groupId, userId, groupName, removedBy) {
  const title = `Removed from Trusted Group`;
  const message = `You have been removed from the trusted group "${groupName}" by ${removedBy}.`;
  
  // Only create trusted group notification (not both general and trusted group)
  await createTrustedGroupNotification(groupId, userId, 'member_removed', title, message);
}

// Notify group members about a new ride request
async function notifyGroupAboutRideRequest(groupId, requestId, requesterName, pickupTime, pickupLocation, dropoffLocation) {
  try {
    // Get all group members
    const [members] = await db.query(`
      SELECT user_id FROM TrustedGroupMembers WHERE group_id = ?
    `, [groupId]);
    
    const title = `New Ride Request`;
    const message = `${requesterName} has requested a ride from ${pickupLocation} to ${dropoffLocation} at ${pickupTime}.`;
    
    // Notify each member (except the requester)
    for (const member of members) {
      await createTrustedGroupNotification(groupId, member.user_id, 'ride_request', title, message, requestId);
    }
    
    console.log(`✅ Notified ${members.length} group members about ride request`);
  } catch (err) {
    console.error('❌ Error notifying group about ride request:', err);
  }
}

// Notify requester about ride request response
async function notifyRideRequestResponse(requestId, responderName, response, groupName) {
  try {
    // Get the request details
    const [[request]] = await db.query(`
      SELECT requester_id, group_id FROM ShortNoticeRequests WHERE id = ?
    `, [requestId]);
    
    if (!request) return;
    
    const title = `Ride Request Response`;
    const message = `${responderName} has ${response} your ride request in the "${groupName}" group.`;
    
    // Only create trusted group notification (not both general and trusted group)
    await createTrustedGroupNotification(request.group_id, request.requester_id, 'ride_response', title, message, requestId);
    
    console.log(`✅ Notified requester about ride response`);
  } catch (err) {
    console.error('❌ Error notifying about ride response:', err);
  }
}

// Get unread notifications count for a user
async function getUnreadNotificationsCount(userId) {
  try {
    const [[result]] = await db.query(`
      SELECT COUNT(*) as count FROM Notifications 
      WHERE user_id = ? AND is_read = FALSE
    `, [userId]);
    
    return result.count;
  } catch (err) {
    console.error('❌ Error getting unread notifications count:', err);
    return 0;
  }
}

// Get unread trusted group notifications count for a user
async function getUnreadTrustedGroupNotificationsCount(userId) {
  try {
    const [[result]] = await db.query(`
      SELECT COUNT(*) as count FROM TrustedGroupNotifications 
      WHERE user_id = ? AND is_read = FALSE
    `, [userId]);
    
    return result.count;
  } catch (err) {
    console.error('❌ Error getting unread trusted group notifications count:', err);
    return 0;
  }
}

// Mark notification as read
async function markNotificationAsRead(notificationId, userId) {
  try {
    await db.query(`
      UPDATE Notifications SET is_read = TRUE 
      WHERE id = ? AND user_id = ?
    `, [notificationId, userId]);
    
    return true;
  } catch (err) {
    console.error('❌ Error marking notification as read:', err);
    return false;
  }
}

// Mark trusted group notification as read
async function markTrustedGroupNotificationAsRead(notificationId, userId) {
  try {
    await db.query(`
      UPDATE TrustedGroupNotifications SET is_read = TRUE 
      WHERE id = ? AND user_id = ?
    `, [notificationId, userId]);
    
    return true;
  } catch (err) {
    console.error('❌ Error marking trusted group notification as read:', err);
    return false;
  }
}

module.exports = {
  createNotification,
  createTrustedGroupNotification,
  notifyUserAddedToGroup,
  notifyUserRemovedFromGroup,
  notifyGroupAboutRideRequest,
  notifyRideRequestResponse,
  getUnreadNotificationsCount,
  getUnreadTrustedGroupNotificationsCount,
  markNotificationAsRead,
  markTrustedGroupNotificationAsRead
}; 