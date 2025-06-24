// routes/child.js
router.get('/child-dashboard', async (req, res) => {
  const userId = req.session.userId;

  try {
    const [[user]] = await db.query('SELECT * FROM Users WHERE id = ?', [userId]);

    if (user.role !== 'child') return res.status(403).send('Access denied.');

    const [[childProfile]] = await db.query(
      'SELECT * FROM Children WHERE id = ?',
      [user.child_profile_id]
    );

    const [rides] = await db.query(
      'SELECT * FROM RideRequests WHERE child_id = ? ORDER BY time DESC',
      [user.child_profile_id]
    );

    res.render('child-dashboard', { user, childProfile, rides });
  } catch (err) {
    console.error('Child dashboard error:', err);
    res.status(500).send('Failed to load dashboard.');
  }
});
