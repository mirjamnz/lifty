const db = require('../db');
const bcrypt = require('bcrypt');

async function testAdminLogin() {
  try {
    console.log('🔍 Testing admin login...');
    
    // Test with admin user
    const email = 'admin@itnetworld.co.nz';
    const password = 'admin123'; // This is a guess, you'll need to provide the actual password
    
    console.log(`📧 Testing login with email: ${email}`);
    
    // Find the admin user
    const [users] = await db.query('SELECT * FROM Users WHERE email = ? AND is_admin = 1', [email]);
    
    if (users.length === 0) {
      console.log('❌ Admin user not found');
      return;
    }
    
    const user = users[0];
    console.log('✅ Admin user found:', {
      id: user.id,
      name: user.name,
      email: user.email,
      is_admin: user.is_admin,
      is_blocked: user.is_blocked
    });
    
    // Test password (you'll need to provide the actual password)
    console.log('\n🔐 To test login, you can:');
    console.log('1. Go to http://localhost:3033/login');
    console.log('2. Login with email: admin@itnetworld.co.nz');
    console.log('3. Use the password for this admin account');
    console.log('4. You should be redirected to /admin/dashboard');
    
    // Show all admin users for reference
    const [allAdmins] = await db.query('SELECT id, name, email, is_admin FROM Users WHERE is_admin = 1');
    console.log('\n📋 All admin users:');
    console.table(allAdmins);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error testing admin login:', error);
    process.exit(1);
  }
}

testAdminLogin(); 