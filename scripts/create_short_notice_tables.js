const db = require('../db');

async function createShortNoticeTables() {
  try {
    console.log('🚀 Creating short-notice ride request tables...');
    
    // Create TrustedGroups table
    await db.query(`
      CREATE TABLE IF NOT EXISTS TrustedGroups (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        creator_id INT NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (creator_id) REFERENCES Users(id) ON DELETE CASCADE
      )
    `);
    console.log('✅ TrustedGroups table created');

    // Create TrustedGroupMembers table
    await db.query(`
      CREATE TABLE IF NOT EXISTS TrustedGroupMembers (
        id INT PRIMARY KEY AUTO_INCREMENT,
        group_id INT NOT NULL,
        user_id INT NOT NULL,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES TrustedGroups(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_group_member (group_id, user_id)
      )
    `);
    console.log('✅ TrustedGroupMembers table created');

    // Create ShortNoticeRequests table
    await db.query(`
      CREATE TABLE IF NOT EXISTS ShortNoticeRequests (
        id INT PRIMARY KEY AUTO_INCREMENT,
        requester_id INT NOT NULL,
        group_id INT NOT NULL,
        pickup_time DATETIME NOT NULL,
        dropoff_time DATETIME NOT NULL,
        pickup_location VARCHAR(500) NOT NULL,
        dropoff_location VARCHAR(500) NOT NULL,
        message TEXT,
        status ENUM('pending', 'accepted', 'declined', 'cancelled') DEFAULT 'pending',
        accepted_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (requester_id) REFERENCES Users(id) ON DELETE CASCADE,
        FOREIGN KEY (group_id) REFERENCES TrustedGroups(id) ON DELETE CASCADE,
        FOREIGN KEY (accepted_by) REFERENCES Users(id) ON DELETE SET NULL
      )
    `);
    console.log('✅ ShortNoticeRequests table created');

    // Create ShortNoticeResponses table
    await db.query(`
      CREATE TABLE IF NOT EXISTS ShortNoticeResponses (
        id INT PRIMARY KEY AUTO_INCREMENT,
        request_id INT NOT NULL,
        responder_id INT NOT NULL,
        response_type ENUM('ok', 'ok_with_message', 'decline') NOT NULL,
        message TEXT,
        responded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (request_id) REFERENCES ShortNoticeRequests(id) ON DELETE CASCADE,
        FOREIGN KEY (responder_id) REFERENCES Users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_response (request_id, responder_id)
      )
    `);
    console.log('✅ ShortNoticeResponses table created');

    // Create indexes
    await db.query('CREATE INDEX IF NOT EXISTS idx_trusted_groups_creator ON TrustedGroups(creator_id)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_trusted_group_members_group ON TrustedGroupMembers(group_id)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_trusted_group_members_user ON TrustedGroupMembers(user_id)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_short_notice_requests_requester ON ShortNoticeRequests(requester_id)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_short_notice_requests_group ON ShortNoticeRequests(group_id)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_short_notice_requests_status ON ShortNoticeRequests(status)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_short_notice_responses_request ON ShortNoticeResponses(request_id)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_short_notice_responses_responder ON ShortNoticeResponses(responder_id)');
    console.log('✅ Indexes created');

    console.log('🎉 All short-notice ride request tables created successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating tables:', error);
    process.exit(1);
  }
}

createShortNoticeTables(); 