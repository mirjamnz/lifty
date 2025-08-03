// scripts/create_notifications_table.js
require('dotenv').config();
const mysql = require('mysql2/promise');

async function createNotificationsTable() {
  let connection;
  
  try {
    // Connect to database using same config as main app
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'lifty'
    });

    console.log('🔗 Connected to database');

    // Create Notifications table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS Notifications (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        type ENUM('group_invitation', 'group_removal', 'ride_request', 'ride_response', 'general') NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        related_type VARCHAR(50) NULL,
        related_id INT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
        INDEX idx_user_id (user_id),
        INDEX idx_is_read (is_read),
        INDEX idx_created_at (created_at),
        INDEX idx_type (type)
      )
    `);

    console.log('✅ Notifications table created successfully');

    // Create TrustedGroupNotifications table for group-specific notifications
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS TrustedGroupNotifications (
        id INT PRIMARY KEY AUTO_INCREMENT,
        group_id INT NOT NULL,
        user_id INT NOT NULL,
        notification_type ENUM('member_added', 'member_removed', 'ride_request', 'ride_response') NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        related_request_id INT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY (group_id) REFERENCES TrustedGroups(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
        FOREIGN KEY (related_request_id) REFERENCES ShortNoticeRequests(id) ON DELETE SET NULL,
        INDEX idx_group_id (group_id),
        INDEX idx_user_id (user_id),
        INDEX idx_is_read (is_read),
        INDEX idx_created_at (created_at)
      )
    `);

    console.log('✅ TrustedGroupNotifications table created successfully');

  } catch (err) {
    console.error('❌ Error creating notifications tables:', err);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed');
    }
  }
}

createNotificationsTable(); 