const express = require('express');
const router = express.Router();

// GET /recurring-events - DEPRECATED: Redirect to new unified Groups system
router.get('/', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  
  // Redirect to new unified Groups page with a notice
  req.session.info = 'Recurring Events have moved! Create and manage groups with optional schedules in the new Groups section.';
  res.redirect('/groups');
});

// Specific deprecated routes - redirect to groups
router.get('/:eventId', (req, res) => {
  req.session.info = 'This feature has moved to the Groups section.';
  res.redirect('/groups');
});

module.exports = router;
