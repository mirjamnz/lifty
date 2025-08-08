const db = require('../db');

// Simulate the exact API logic with Andy's data
async function testAPIWithSession() {
  try {
    console.log('🧪 Testing API logic with Andy\'s session data...\n');
    
    // Simulate Andy's session
    const mockSession = {
      userId: 74,
      userEmail: 'andy@andy.com',
      userName: 'Andy Egli'
    };
    
    const groupId = 4;
    const userId = mockSession.userId;
    
    console.log(`🔍 Group members request: Group ${groupId}, User ${userId}`);
    console.log(`🔍 Session details:`, { 
      userId: mockSession.userId, 
      userEmail: mockSession.userEmail,
      userName: mockSession.userName
    });
    
    // Check if user exists
    console.log('1. Checking if user exists...');
    const [[user]] = await db.query('SELECT * FROM Users WHERE id = ?', [userId]);
    if (!user) {
      console.log(`❌ User ${userId} not found in database`);
      return;
    }
    
    console.log(`👤 User found: ${user.name} (${user.email})`);
    
    // Check if user is a member of this group OR is the creator
    console.log('2. Checking membership...');
    const [[membership]] = await db.query(`
      SELECT tgm.*, tg.name as group_name, tg.creator_id
      FROM TrustedGroupMembers tgm
      JOIN TrustedGroups tg ON tgm.group_id = tg.id
      WHERE tgm.group_id = ? AND tgm.user_id = ?
    `, [groupId, userId]);
    
    // Also check if user is the creator
    console.log('3. Checking creator status...');
    const [[creatorCheck]] = await db.query(`
      SELECT * FROM TrustedGroups WHERE id = ? AND creator_id = ?
    `, [groupId, userId]);
    
    console.log(`👥 Membership check result:`, membership);
    console.log(`👑 Creator check result:`, creatorCheck);
    
    if (!membership && !creatorCheck) {
      console.log(`❌ User ${userId} (${user.name}) is not a member or creator of group ${groupId}`);
      return;
    }
    
    // Get group details
    console.log('4. Getting group details...');
    const [[group]] = await db.query(`
      SELECT * FROM TrustedGroups WHERE id = ?
    `, [groupId]);
    
    if (!group) {
      console.log('❌ Group not found');
      return;
    }
    
    console.log(`📁 Group details: ${group.name}`);
    
    // Get all members with their details
    console.log('5. Getting all members...');
    const [members] = await db.query(`
      SELECT 
        u.id,
        u.name,
        u.email,
        tgm.added_at as joined_at,
        CASE WHEN tg.creator_id = u.id THEN 'Creator' ELSE 'Member' END as role
      FROM TrustedGroupMembers tgm
      JOIN Users u ON tgm.user_id = u.id
      JOIN TrustedGroups tg ON tgm.group_id = tg.id
      WHERE tgm.group_id = ?
      ORDER BY 
        CASE WHEN tg.creator_id = u.id THEN 0 ELSE 1 END,
        u.name
    `, [groupId]);
    
    console.log(`✅ Found ${members.length} members`);
    
    // Test the full response structure
    const response = {
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        creator_id: group.creator_id
      },
      members: members
    };
    
    console.log('\n✅ API would return success with response structure:');
    console.log(`  - Group: ${response.group.name}`);
    console.log(`  - Members: ${response.members.length} total`);
    console.log('  - Sample member:', response.members[0]);
    
  } catch (err) {
    console.error('❌ Error during test:', err);
    console.error('❌ Stack trace:', err.stack);
  } finally {
    process.exit(0);
  }
}

testAPIWithSession();
