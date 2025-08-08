const db = require('../db');
const fs = require('fs');
const path = require('path');

async function createActivityGroupsSchema() {
  try {
    console.log('🏗️  Creating unified Activity Groups database schema...\n');
    
    // Read the SQL file
    const sqlFile = path.join(__dirname, '..', 'create_activity_groups_schema.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');
    
    // Remove comments and split SQL into individual statements
    const cleanedSql = sql
      .split('\n')
      .filter(line => !line.trim().startsWith('--') && line.trim().length > 0)
      .join('\n');
    
    const statements = cleanedSql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0);
    
    console.log(`📄 Found ${statements.length} SQL statements to execute\n`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.trim()) {
        try {
          // Extract table name for logging
          const match = statement.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
          const tableName = match ? match[1] : `Statement ${i + 1}`;
          
          console.log(`${i + 1}. Creating ${tableName}...`);
          await db.query(statement);
          console.log(`   ✅ ${tableName} created successfully`);
        } catch (err) {
          console.error(`   ❌ Error executing statement ${i + 1}:`, err.message);
          throw err;
        }
      }
    }
    
    console.log('\n🎉 Activity Groups schema created successfully!');
    console.log('\n📋 Tables created:');
    console.log('   - ActivityGroups (main groups table)');
    console.log('   - ActivityGroupMembers (membership)');
    console.log('   - ActivityScheduleOverrides (one-time changes)');
    console.log('   - ActivityGroupAssignments (driving assignments)');
    console.log('   - ActivityGroupInvitations (group invites)');
    console.log('   - ActivityGroupMessages (unified messaging)');
    console.log('\n✨ Ready to build the unified Groups interface!');
    
  } catch (err) {
    console.error('❌ Error creating Activity Groups schema:', err);
    console.error('Stack trace:', err.stack);
  } finally {
    process.exit(0);
  }
}

createActivityGroupsSchema();
