const db = require('../db');

async function checkAdminUsers() {
  try {
    console.log('🔍 Checking for admin users...');
    
    const [users] = await db.query('SELECT id, name, email, role, is_admin FROM Users WHERE is_admin = 1');
    
    if (users.length === 0) {
      console.log('❌ No admin users found in the database.');
      console.log('💡 You need to create an admin user. Here are the current users:');
      
      const [allUsers] = await db.query('SELECT id, name, email, role, is_admin FROM Users LIMIT 10');
      console.table(allUsers);
      
      console.log('\n🔧 To create an admin user, you can:');
      console.log('1. Update an existing user: UPDATE Users SET is_admin = 1 WHERE id = <user_id>');
      console.log('2. Or create a new admin user directly in the database');
    } else {
      console.log('✅ Admin users found:');
      console.table(users);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error checking admin users:', error);
    process.exit(1);
  }
}

checkAdminUsers(); 