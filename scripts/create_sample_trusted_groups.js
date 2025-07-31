const db = require('../db');

async function createSampleTrustedGroups() {
  try {
    console.log('🚀 Creating sample trusted groups...');
    
    // Get some existing users
    const [users] = await db.query('SELECT id, name FROM Users WHERE role = "parent" LIMIT 5');
    
    if (users.length < 2) {
      console.log('❌ Need at least 2 parent users to create sample groups');
      return;
    }
    
    // Create "School Friends" group
    const [schoolGroup] = await db.query(`
      INSERT INTO TrustedGroups (name, description, creator_id)
      VALUES (?, ?, ?)
    `, ['School Friends', 'Parents from the same school for quick ride coordination', users[0].id]);
    
    console.log('✅ Created "School Friends" group');
    
    // Add members to school group
    for (let i = 1; i < Math.min(users.length, 4); i++) {
      await db.query(`
        INSERT INTO TrustedGroupMembers (group_id, user_id)
        VALUES (?, ?)
      `, [schoolGroup.insertId, users[i].id]);
    }
    console.log(`✅ Added ${Math.min(users.length - 1, 3)} members to School Friends group`);
    
    // Create "Sports Team" group
    const [sportsGroup] = await db.query(`
      INSERT INTO TrustedGroups (name, description, creator_id)
      VALUES (?, ?, ?)
    `, ['Sports Team', 'Parents from the same sports team for weekend games', users[1].id]);
    
    console.log('✅ Created "Sports Team" group');
    
    // Add members to sports group
    for (let i = 0; i < Math.min(users.length, 3); i++) {
      if (i !== 1) { // Skip the creator
        await db.query(`
          INSERT INTO TrustedGroupMembers (group_id, user_id)
          VALUES (?, ?)
        `, [sportsGroup.insertId, users[i].id]);
      }
    }
    console.log(`✅ Added ${Math.min(users.length - 1, 2)} members to Sports Team group`);
    
    // Create a sample short-notice request
    const [sampleRequest] = await db.query(`
      INSERT INTO ShortNoticeRequests (
        requester_id, group_id, pickup_time, dropoff_time, 
        pickup_location, dropoff_location, message
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      users[0].id, 
      schoolGroup.insertId,
      new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
      new Date(Date.now() + 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000), // Tomorrow + 2 hours
      '123 Main Street, Auckland',
      'School Sports Complex',
      'Early morning sports practice - need pickup at 6:15 AM'
    ]);
    
    console.log('✅ Created sample short-notice request');
    
    console.log('🎉 Sample data created successfully!');
    console.log('📝 You can now test:');
    console.log('   - Visit /trusted-groups to see the groups');
    console.log('   - Visit /short-notice to see the request');
    console.log('   - Login as different users to test group membership');
    
  } catch (error) {
    console.error('❌ Error creating sample data:', error);
  }
  
  process.exit(0);
}

createSampleTrustedGroups(); 