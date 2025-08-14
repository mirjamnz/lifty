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

// Legacy function - now redirects to unified notification system
async function notifyUserAddedToGroup(groupId, userId, groupName, addedBy) {
  const title = `Added to Group`;
  const message = `You have been added to the group "${groupName}" by ${addedBy}. You can now participate in group activities.`;
  
  await createNotification(userId, 'group_add', title, message, 'activity_group', groupId);
}

// Notify user when added to an activity group
async function notifyUserAddedToActivityGroup(groupId, userId, groupName, addedBy, hasSchedule = false) {
  const title = `Added to Activity Group`;
  const groupType = hasSchedule ? 'scheduled activity group' : 'chat group';
  const message = `You have been added to the ${groupType} "${groupName}" by ${addedBy}. You can chat with group members and stay updated on activities.`;
  
  await createNotification(userId, 'group_add', title, message, 'activity_group', groupId);
}

// Legacy function - now redirects to unified notification system  
async function notifyUserRemovedFromGroup(groupId, userId, groupName, removedBy) {
  const title = `Removed from Group`;
  const message = `You have been removed from the group "${groupName}" by ${removedBy}.`;
  
  await createNotification(userId, 'group_rem', title, message, 'activity_group', groupId);
}

// Legacy functions - these are no longer used since ShortNotice system was removed
// Keeping stubs for backward compatibility
async function notifyGroupAboutRideRequest(groupId, requestId, requesterName, pickupTime, pickupLocation, dropoffLocation) {
  console.log('⚠️  notifyGroupAboutRideRequest called but ShortNotice system has been removed');
  return;
}

async function notifyGroupAboutMessage(groupId, requestId, senderName, messagePreview) {
  console.log('⚠️  notifyGroupAboutMessage called but ShortNotice system has been removed');
  return;
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

// Legacy function - now returns 0 since TrustedGroupNotifications table was removed
async function getUnreadTrustedGroupNotificationsCount(userId) {
  console.log('⚠️  getUnreadTrustedGroupNotificationsCount called but TrustedGroups system has been removed');
  return 0;
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

// Legacy function - no longer used since TrustedGroupNotifications table was removed
async function markTrustedGroupNotificationAsRead(notificationId, userId) {
  console.log('⚠️  markTrustedGroupNotificationAsRead called but TrustedGroups system has been removed');
  return true;
}

module.exports = {
  createNotification,
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