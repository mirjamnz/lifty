const db = require('../db');

async function testGroupMembersAPI() {
  try {
    console.log('🧪 Testing group members API logic...\n');
    
    const groupId = 4;
    const userId = 74; // Andy's user ID
    
    console.log(`🔍 Testing for Group ${groupId}, User ${userId}`);
    
    // Check if user is a member of this group
    console.log('1. Checking membership...');
    const [[membership]] = await db.query(`
      SELECT * FROM TrustedGroupMembers WHERE group_id = ? AND user_id = ?
    `, [groupId, userId]);
    
    console.log('👥 Membership check result:', membership);
    
    if (!membership) {
      console.log(`❌ User ${userId} is not a member of group ${groupId}`);
      return;
    }
    
    // Get group details
    console.log('2. Getting group details...');
    const [[group]] = await db.query(`
      SELECT * FROM TrustedGroups WHERE id = ?
    `, [groupId]);
    
    console.log('📁 Group details:', group);
    
    if (!group) {
      console.log('❌ Group not found');
      return;
    }
    
    // Get all members with their details
    console.log('3. Getting all members...');
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
    
    console.log(`✅ Found ${members.length} members:`);
    members.forEach(member => {
      console.log(`  - ${member.name} (${member.email}) - Role: ${member.role}`);
    });
    
    // Test the full response
    const response = {
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        creator_id: group.creator_id
      },
      members: members
    };
    
    console.log('\n📤 API Response would be:');
    console.log(JSON.stringify(response, null, 2));
    
  } catch (err) {
    console.error('❌ Error during test:', err);
  } finally {
    process.exit(0);
  }
}

testGroupMembersAPI();
