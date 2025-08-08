const db = require('../db');

async function checkAndySession() {
  try {
    console.log('🔍 Checking Andy\'s user account details...\n');
    
    // Find all users with Andy in the name
    const [andyUsers] = await db.query(`
      SELECT * FROM Users 
      WHERE name LIKE '%andy%' OR name LIKE '%Andy%' OR email LIKE '%andy%'
    `);
    
    console.log('👤 Users matching "Andy":');
    andyUsers.forEach(user => {
      console.log(`  - ID: ${user.id}, Name: "${user.name}", Email: "${user.email}", Role: ${user.role}`);
    });
    
    // Check if there are multiple Andy accounts
    if (andyUsers.length > 1) {
      console.log('\n⚠️  Multiple Andy accounts found! This could cause confusion.');
    }
    
    // Check group memberships for each Andy
    for (const user of andyUsers) {
      console.log(`\n🔍 Group memberships for ${user.name} (ID: ${user.id}):`);
      
      const [memberships] = await db.query(`
        SELECT tgm.*, tg.name as group_name
        FROM TrustedGroupMembers tgm
        JOIN TrustedGroups tg ON tgm.group_id = tg.id
        WHERE tgm.user_id = ?
      `, [user.id]);
      
      if (memberships.length === 0) {
        console.log('  - No group memberships');
      } else {
        memberships.forEach(membership => {
          console.log(`  - Group: "${membership.group_name}" (ID: ${membership.group_id})`);
        });
      }
    }
    
  } catch (err) {
    console.error('❌ Error checking Andy session:', err);
  } finally {
    process.exit(0);
  }
}

checkAndySession();
