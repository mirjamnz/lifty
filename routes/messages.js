const express = require('express');
const router = express.Router();
const db = require('../db');

// POST /messages/send - Send a message
router.post('/send', async (req, res) => {
  const senderId = req.session.userId;
  const { target_type, target_id, message } = req.body;

  if (!senderId || !target_type || !target_id || !message) {
    return res.status(400).send('Missing required fields.');
  }

  // Determine recipient based on target_type and target_id
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

  const [messages] = await db.query(
    `SELECT m.*, u.name AS sender_name
     FROM Messages m
     JOIN Users u ON m.sender_id = u.id
     WHERE m.recipient_id = ?
     ORDER BY m.sent_at DESC
     LIMIT 100`,
    [userId]
  );

  res.render('messages-inbox', { session: req.session, messages });
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

module.exports = router; 