// Script to add privacy field to Users table
const db = require('./db');

async function addPrivacyField() {
  try {
    console.log('Checking if is_address_private column exists...');
    
    // Check if column exists
    const [columns] = await db.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = 'lifty' 
      AND TABLE_NAME = 'Users' 
      AND COLUMN_NAME = 'is_address_private'
    `);
    
    if (columns.length === 0) {
      console.log('Adding is_address_private column...');
      await db.query(`
        ALTER TABLE Users 
        ADD COLUMN is_address_private BOOLEAN DEFAULT FALSE
      `);
      console.log('✅ Column added successfully');
      
      // Update existing users to have public addresses by default
      await db.query(`
        UPDATE Users 
        SET is_address_private = FALSE 
        WHERE is_address_private IS NULL
      `);
      console.log('✅ Updated existing users to have public addresses by default');
    } else {
      console.log('✅ Column already exists');
    }
    
    console.log('Privacy field setup complete!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

addPrivacyField(); 