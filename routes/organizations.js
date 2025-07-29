// routes/organizations.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /organizations — main page
router.get('/', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  
  try {
    // Get all organizations with affiliation counts
    const [organizations] = await db.query(`
      SELECT 
        o.*,
        COALESCE(parent_count.count, 0) as parent_count,
        COALESCE(child_count.count, 0) as child_count
      FROM Organizations o
      LEFT JOIN (
        SELECT 
          organization_id, 
          COUNT(DISTINCT user_id) as count
        FROM UserAffiliations 
        WHERE role = 'parent'
        GROUP BY organization_id
      ) parent_count ON o.id = parent_count.organization_id
      LEFT JOIN (
        SELECT 
          organization_id, 
          COUNT(DISTINCT child_id) as count
        FROM UserAffiliations 
        WHERE role = 'child' AND child_id IS NOT NULL
        GROUP BY organization_id
      ) child_count ON o.id = child_count.organization_id
      ORDER BY o.name
    `);
    
    // Get quick stats
    const [stats] = await db.query(`
      SELECT 
        COUNT(CASE WHEN type = 'school' THEN 1 END) as schools,
        COUNT(CASE WHEN type = 'club' THEN 1 END) as clubs,
        COUNT(CASE WHEN type = 'event' THEN 1 END) as events,
        COUNT(CASE WHEN type = 'other' THEN 1 END) as others
      FROM Organizations
    `);
    
    res.render('organizations', { 
      session: req.session, 
      organizations,
      stats: stats[0]
    });
  } catch (err) {
    console.error('❌ Organizations page error:', err);
    res.status(500).send('Could not load organizations.');
  }
});

// GET /organizations/add — form
router.get('/add', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  res.render('add-organizations', { session: req.session });
});

// GET /organizations/autocomplete
// routes/organizations.js
router.get('/autocomplete', async (req, res) => {
  const { term = '', type } = req.query;

  let query = `SELECT id, name, address, lat, lng, type FROM Organizations WHERE name LIKE ?`;
  const params = [`%${term}%`];

  if (type === 'organization') {
    query += ` AND type IN ('school', 'club', 'event')`;
  } else if (type) {
    query += ` AND type = ?`;
    params.push(type);
  } else {
    query += ` AND type IN ('school', 'club', 'event')`;
  }

  query += ` ORDER BY name LIMIT 10`;

  try {
    const [orgs] = await db.query(query, params);
    const results = orgs.map(org => ({
      label: `${org.name} (${org.type})`,
      value: org.name,
      address: org.address,
      lat: org.lat,
      lng: org.lng,
      type: org.type
    }));

    // ✅ FIX: explicitly tell browser it's JSON
    res.setHeader('Content-Type', 'application/json');
    res.json(results);
  } catch (err) {
    console.error('❌ Autocomplete error:', err);
    res.status(500).json({ error: 'Autocomplete failed' });
  }
});


// POST /organizations/add — create
router.post('/add', async (req, res) => {
  const { name, type, address, lat, lng } = req.body;
  const userId = req.session.userId;

  // Validate core fields
  if (!name || !type || !address || !userId) {
    return res.status(400).send('Missing required fields.');
  }

  // Parse lat/lng safely
  const safeLat = lat && !isNaN(parseFloat(lat)) ? parseFloat(lat) : null;
  const safeLng = lng && !isNaN(parseFloat(lng)) ? parseFloat(lng) : null;

  try {
    await db.query(
      'INSERT INTO Organizations (name, type, address, lat, lng, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [name.trim(), type.trim(), address.trim(), safeLat, safeLng, userId]
    );

    // Set session flash message BEFORE redirect
    req.session.success = '✅ Organization added!';
    res.redirect('/organizations');
  } catch (err) {
    console.error('❌ Add Organization Error:', err.message, '\n', err.stack);
    res.status(500).send('Could not add organization.');
  }
});

// POST /organizations/edit — update
router.post('/edit/:id', async (req, res) => {
  const { id } = req.params;
  const { name, type, address } = req.body;
  const userId = req.session.userId;

  if (!name || !type || !address || !userId) {
    return res.status(400).send('Missing required fields.');
  }

  try {
    await db.query(
      'UPDATE Organizations SET name = ?, type = ?, address = ? WHERE id = ?',
      [name.trim(), type.trim(), address.trim(), id]
    );

    req.session.success = '✅ Organization updated!';
    res.redirect('/organizations');
  } catch (err) {
    console.error('❌ Edit Organization Error:', err);
    res.status(500).send('Could not update organization.');
  }
});

// POST /organizations/delete — delete
router.post('/delete/:id', async (req, res) => {
  const { id } = req.params;
  const userId = req.session.userId;

  if (!userId) {
    return res.status(401).send('Unauthorized.');
  }

  try {
    await db.query('DELETE FROM Organizations WHERE id = ?', [id]);
    req.session.success = '✅ Organization deleted!';
    res.redirect('/organizations');
  } catch (err) {
    console.error('❌ Delete Organization Error:', err);
    res.status(500).send('Could not delete organization.');
  }
});

module.exports = router;
