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

// Notify user when added to an activity group
async function notifyUserAddedToActivityGroup(groupId, userId, groupName, addedBy, hasSchedule = false) {
  const title = `Added to Activity Group`;
  const groupType = hasSchedule ? 'scheduled activity group' : 'chat group';
  const message = `You have been added to the ${groupType} "${groupName}" by ${addedBy}. You can chat with group members and stay updated on activities.`;
  
  await createNotification(userId, 'group_added', title, message, 'activity_group', groupId);
}

// Notify user when removed from a trusted group
async function notifyUserRemovedFromGroup(groupId, userId, groupName, removedBy) {
  const title = `Removed from Trusted Group`;
  const message = `You have been removed from the trusted group "${groupName}" by ${removedBy}.`;
  
  // Only create trusted group notification (not both general and trusted group)
  await createTrustedGroupNotification(groupId, userId, 'member_removed', title, message);
}

// Notify group members about a new short-notice request
async function notifyGroupAboutRideRequest(groupId, requestId, requesterName, pickupTime, pickupLocation, dropoffLocation) {
  try {
    // Get all group members
    const [members] = await db.query(`
      SELECT user_id FROM TrustedGroupMembers WHERE group_id = ?
    `, [groupId]);
    
    const title = `New Short-Notice Request`;
    const message = `${requesterName} has sent a short-notice request. Join the discussion to coordinate.`;
    
    // Notify each member (except the requester)
    for (const member of members) {
      await createTrustedGroupNotification(groupId, member.user_id, 'short_notice_request', title, message, requestId);
    }
    
    console.log(`✅ Notified ${members.length} group members about short-notice request`);
  } catch (err) {
    console.error('❌ Error notifying group about short-notice request:', err);
  }
}

// Notify users about new messages in short-notice discussions
async function notifyGroupAboutMessage(groupId, requestId, senderName, messagePreview) {
  try {
    // Get all group members except the sender
    const [members] = await db.query(`
      SELECT tgm.user_id, u.name 
      FROM TrustedGroupMembers tgm
      JOIN Users u ON tgm.user_id = u.id
      WHERE tgm.group_id = ? AND u.name != ?
    `, [groupId, senderName]);
    
    const title = `New Message in Discussion`;
    const message = `${senderName} replied: ${messagePreview.substring(0, 100)}${messagePreview.length > 100 ? '...' : ''}`;
    
    // Notify each member
    for (const member of members) {
      await createTrustedGroupNotification(groupId, member.user_id, 'message_reply', title, message, requestId);
    }
    
    console.log(`✅ Notified ${members.length} group members about new message`);
  } catch (err) {
    console.error('❌ Error notifying group about message:', err);
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
  notifyUserAddedToActivityGroup,
  notifyUserRemovedFromGroup,
  notifyGroupAboutRideRequest,
  notifyGroupAboutMessage,
  getUnreadNotificationsCount,
  getUnreadTrustedGroupNotificationsCount,
  markNotificationAsRead,
  markTrustedGroupNotificationAsRead
}; 