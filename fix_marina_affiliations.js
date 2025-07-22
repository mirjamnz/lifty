require('dotenv').config();
const db = require('./db');

async function fixMarinaAffiliations() {
  try {
    console.log('Fixing Marina\'s missing UserAffiliations...');
    
    // Find Marina's data
    const [[marinaUser]] = await db.query('SELECT * FROM Users WHERE name LIKE "%Marina%" ORDER BY id DESC LIMIT 1');
    const [[marinaChild]] = await db.query('SELECT * FROM Children WHERE name LIKE "%Marina%" ORDER BY id DESC LIMIT 1');
    
    if (!marinaUser || !marinaChild) {
      console.log('❌ Marina not found in database');
      return;
    }
    
    console.log('Marina user:', marinaUser);
    console.log('Marina child:', marinaChild);
    
    // Marina's data
    const marinaUserId = marinaUser.id;
    const marinaChildId = marinaChild.id;
    const parentId = marinaUser.parent_id;
    const orgId = 18; // BIS Birkdale Intermediate School (need to find the correct ID)
    
    // Find the correct organization ID for BIS Birkdale Intermediate School
    const [[org]] = await db.query('SELECT * FROM Organizations WHERE name LIKE "%Birkdale%" OR name LIKE "%BIS%"');
    const actualOrgId = org ? org.id : orgId;
    
    console.log('Creating affiliations with:', {
      marinaUserId,
      marinaChildId,
      parentId,
      actualOrgId,
      orgName: org ? org.name : 'Unknown'
    });
    
    // Create parent affiliation
    const [parentResult] = await db.query(
      'INSERT INTO UserAffiliations (user_id, child_id, organization_id, role, created_at) VALUES (?, ?, ?, ?, NOW())',
      [parentId, marinaChildId, actualOrgId, 'parent']
    );
    console.log('✅ Created parent affiliation, ID:', parentResult.insertId);
    
    // Create child affiliation
    const [childResult] = await db.query(
      'INSERT INTO UserAffiliations (user_id, child_id, organization_id, role, created_at) VALUES (?, ?, ?, ?, NOW())',
      [marinaUserId, marinaChildId, actualOrgId, 'child']
    );
    console.log('✅ Created child affiliation, ID:', childResult.insertId);
    
    console.log('✅ Marina\'s affiliations fixed!');
    
  } catch (err) {
    console.error('❌ Error fixing Marina\'s affiliations:', err);
    console.error('Error message:', err.message);
    console.error('Error code:', err.code);
  } finally {
    process.exit(0);
  }
}

fixMarinaAffiliations(); 