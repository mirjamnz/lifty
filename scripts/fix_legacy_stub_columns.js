const db = require('../db');
(async()=>{
  const statements=[
    "ALTER TABLE EventGroupInvitations ADD COLUMN IF NOT EXISTS invitee_email VARCHAR(255)",
    "ALTER TABLE EventGroupInvitations ADD COLUMN IF NOT EXISTS inviter_id INT",
    "ALTER TABLE EventGroupInvitations ADD COLUMN IF NOT EXISTS invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    "ALTER TABLE EventAssignments ADD COLUMN IF NOT EXISTS event_date DATE",
    "ALTER TABLE EventAssignments ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN DEFAULT FALSE",
    // lowercase duplicates for case-sensitive filesystems
    "CREATE TABLE IF NOT EXISTS recurringevents LIKE RecurringEvents",
    "CREATE TABLE IF NOT EXISTS eventgroupinvitations LIKE EventGroupInvitations",
    "CREATE TABLE IF NOT EXISTS eventassignments LIKE EventAssignments",
    "CREATE TABLE IF NOT EXISTS trustedgroups LIKE TrustedGroups"
  ];
  for(const stmt of statements){
    try{await db.query(stmt);console.log('✅',stmt.split(' ')[0],'ok');}
    catch(e){console.error('❌',e.message);}
  }
  const additional = [
    "ALTER TABLE RecurringEvents ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
    "ALTER TABLE EventAssignments ADD COLUMN IF NOT EXISTS notes TEXT",
    "ALTER TABLE EventGroupMembers ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE"
  ];
  for(const stmt of additional){try{await db.query(stmt);console.log('✅',stmt.split(' ')[2],'ok');}catch(e){console.error('❌',e.message);} }
  const additional2=[
    "ALTER TABLE EventInstances ADD COLUMN IF NOT EXISTS event_date DATE",
    "ALTER TABLE EventInstances ADD COLUMN IF NOT EXISTS driver_id INT"
  ];
  for(const stmt of additional2){try{await db.query(stmt);console.log('✅',stmt.split(' ')[2],'ok');}catch(e){console.error('❌',e.message);} }
  process.exit(0);
})();
