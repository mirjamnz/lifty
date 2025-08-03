// routes/notifications.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const notifications = require('../utils/notifications');

// GET /notifications - Show all notifications for the user
router.get('/', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  
  try {
    const userId = req.session.userId;
    
    // Get general notifications
    const [generalNotifications] = await db.query(`
      SELECT * FROM Notifications 
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `, [userId]);
    
    // Get trusted group notifications
    const [trustedGroupNotifications] = await db.query(`
      SELECT 
        tgn.*,
        tg.name as group_name
      FROM TrustedGroupNotifications tgn
      JOIN TrustedGroups tg ON tgn.group_id = tg.id
      WHERE tgn.user_id = ?
      ORDER BY tgn.created_at DESC
      LIMIT 50
    `, [userId]);
    
    // Get unread counts
    const unreadGeneral = await notifications.getUnreadNotificationsCount(userId);
    const unreadTrustedGroup = await notifications.getUnreadTrustedGroupNotificationsCount(userId);
    
    res.render('notifications', {
      session: req.session,
      generalNotifications,
      trustedGroupNotifications,
      unreadGeneral,
      unreadTrustedGroup
    });
  } catch (err) {
    console.error('❌ Notifications error:', err);
    req.session.error = 'Could not load notifications.';
    res.redirect('/dashboard');
  }
});

// POST /notifications/:id/read - Mark a notification as read
router.post('/:id/read', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  
  try {
    const notificationId = req.params.id;
    const userId = req.session.userId;
    
    const success = await notifications.markNotificationAsRead(notificationId, userId);
    
    if (success) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Could not mark notification as read' });
    }
  } catch (err) {
    console.error('❌ Mark notification as read error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /notifications/trusted-group/:id/read - Mark a trusted group notification as read
router.post('/trusted-group/:id/read', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  
  try {
    const notificationId = req.params.id;
    const userId = req.session.userId;
    
    const success = await notifications.markTrustedGroupNotificationAsRead(notificationId, userId);
    
    if (success) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Could not mark notification as read' });
    }
  } catch (err) {
    console.error('❌ Mark trusted group notification as read error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /notifications/count - Get unread notification counts (for navbar)
router.get('/count', async (req, res) => {
  if (!req.session.userId) return res.json({ general: 0, trustedGroup: 0 });
  
  try {
    const userId = req.session.userId;
    const unreadGeneral = await notifications.getUnreadNotificationsCount(userId);
    const unreadTrustedGroup = await notifications.getUnreadTrustedGroupNotificationsCount(userId);
    
    res.json({
      general: unreadGeneral,
      trustedGroup: unreadTrustedGroup,
      total: unreadGeneral + unreadTrustedGroup
    });
  } catch (err) {
    console.error('❌ Get notification count error:', err);
    res.json({ general: 0, trustedGroup: 0, total: 0 });
  }
});

module.exports = router; 