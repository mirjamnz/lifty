const db = require('../db');

async function deleteTrustedGroups() {
  try {
    console.log('🗑️  Starting deletion of all trusted groups and related data...\n');
    
    // Get count of existing data before deletion
    const [[shortNoticeCount]] = await db.query('SELECT COUNT(*) as count FROM ShortNoticeRequests');
    const [[responseCount]] = await db.query('SELECT COUNT(*) as count FROM ShortNoticeResponses');
    const [[memberCount]] = await db.query('SELECT COUNT(*) as count FROM TrustedGroupMembers');
    const [[groupCount]] = await db.query('SELECT COUNT(*) as count FROM TrustedGroups');
    
    console.log('📊 Current data counts:');
    console.log(`  - Trusted Groups: ${groupCount.count}`);
    console.log(`  - Group Members: ${memberCount.count}`);
    console.log(`  - Short Notice Requests: ${shortNoticeCount.count}`);
    console.log(`  - Short Notice Responses: ${responseCount.count}\n`);
    
    if (groupCount.count === 0) {
      console.log('✅ No trusted groups found. Nothing to delete.');
      return;
    }
    
    // Delete in correct order to respect foreign key constraints
    
    console.log('1. Deleting short notice responses...');
    await db.query('DELETE FROM ShortNoticeResponses');
    console.log('   ✅ Short notice responses deleted');
    
    console.log('2. Deleting short notice requests...');
    await db.query('DELETE FROM ShortNoticeRequests');
    console.log('   ✅ Short notice requests deleted');
    
    console.log('3. Deleting trusted group members...');
    await db.query('DELETE FROM TrustedGroupMembers');
    console.log('   ✅ Trusted group members deleted');
    
    console.log('4. Deleting trusted groups...');
    await db.query('DELETE FROM TrustedGroups');
    console.log('   ✅ Trusted groups deleted');
    
    // Clean up related notifications
    console.log('5. Cleaning up related notifications...');
    await db.query(`
      DELETE FROM TrustedGroupNotifications 
      WHERE notification_type IN ('member_added', 'member_removed', 'ride_request', 'ride_response', 'short_notice_request', 'message_reply')
    `);
    console.log('   ✅ Related notifications cleaned up');
    
    // Clean up messages related to short-notice requests
    console.log('6. Cleaning up short-notice messages...');
    await db.query(`DELETE FROM Messages WHERE related_type = 'short-notice'`);
    console.log('   ✅ Short-notice messages cleaned up');
    
    console.log('\n🎉 All trusted groups and related data successfully deleted!');
    console.log('\n📝 Summary:');
    console.log('   - All trusted groups removed');
    console.log('   - All group memberships removed');
    console.log('   - All short-notice requests and responses removed');
    console.log('   - Related notifications cleaned up');
    console.log('   - Related messages cleaned up');
    console.log('\n✨ Ready to implement unified Activity Groups system!');
    
  } catch (err) {
    console.error('❌ Error deleting trusted groups:', err);
    console.error('Stack trace:', err.stack);
  } finally {
    process.exit(0);
  }
}

deleteTrustedGroups();
