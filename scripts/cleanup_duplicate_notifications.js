// scripts/cleanup_duplicate_notifications.js
require('dotenv').config();
const mysql = require('mysql2/promise');

async function cleanupDuplicateNotifications() {
  let connection;

  try {
    // Create database connection
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'lifty'
    });

    console.log('🔍 Cleaning up duplicate notifications...');

    // Remove general notifications that are related to trusted groups
    // These should only appear in TrustedGroupNotifications table
    const [result] = await connection.execute(`
      DELETE FROM Notifications 
      WHERE related_type = 'trusted_group' 
      AND (type = 'group_invitation' OR type = 'group_removal' OR type = 'ride_response')
    `);

    console.log(`✅ Removed ${result.affectedRows} duplicate notifications`);

    // Show remaining notifications for verification
    const [generalNotifications] = await connection.execute(`
      SELECT COUNT(*) as count FROM Notifications
    `);

    const [trustedGroupNotifications] = await connection.execute(`
      SELECT COUNT(*) as count FROM TrustedGroupNotifications
    `);

    console.log(`📊 Remaining notifications:`);
    console.log(`   - General notifications: ${generalNotifications[0].count}`);
    console.log(`   - Trusted group notifications: ${trustedGroupNotifications[0].count}`);

  } catch (err) {
    console.error('❌ Error cleaning up notifications:', err);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed');
    }
  }
}

cleanupDuplicateNotifications(); 