const db = require('../db');
const bcrypt = require('bcrypt');

async function resetAdminPassword() {
  try {
    console.log('🔧 Resetting admin password...');
    
    const email = 'admin@itnetworld.co.nz';
    const newPassword = 'admin123';
    
    // Hash the new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    
    // Update the admin user's password
    const [result] = await db.query(
      'UPDATE Users SET password_hash = ? WHERE email = ? AND is_admin = 1',
      [hashedPassword, email]
    );
    
    if (result.affectedRows > 0) {
      console.log('✅ Admin password reset successfully!');
      console.log(`📧 Email: ${email}`);
      console.log(`🔐 New password: ${newPassword}`);
      console.log('\n🔗 You can now login at: http://localhost:3033/login');
    } else {
      console.log('❌ No admin user found to update');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error resetting admin password:', error);
    process.exit(1);
  }
}

resetAdminPassword(); 