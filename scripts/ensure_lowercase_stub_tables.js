const db = require('../db');

const pairs = [
  { upper: 'RecurringEvents', lower: 'recurringevents', extraCols: [
    "is_group_event BOOLEAN DEFAULT TRUE",
    "is_active BOOLEAN DEFAULT TRUE"
  ]},
  { upper: 'EventInstances', lower: 'eventinstances', extraCols: [
    "event_date DATE",
    "driver_id INT"
  ]},
  { upper: 'EventAssignments', lower: 'eventassignments', extraCols: [
    "event_date DATE",
    "is_cancelled BOOLEAN DEFAULT FALSE",
    "notes TEXT"
  ]},
  { upper: 'EventGroupInvitations', lower: 'eventgroupinvitations', extraCols: [
    "invitee_email VARCHAR(255)",
    "inviter_id INT",
    "invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
  ]},
  { upper: 'EventGroupMembers', lower: 'eventgroupmembers', extraCols: [
    "is_active BOOLEAN DEFAULT TRUE"
  ]},
  { upper: 'TrustedGroups', lower: 'trustedgroups', extraCols: []}
];

(async()=>{
  for(const {upper, lower, extraCols} of pairs){
    try{
      await db.query(`CREATE TABLE IF NOT EXISTS ${upper} (id INT AUTO_INCREMENT PRIMARY KEY)`);
    }catch(e){/* ignore */}
    try{
      await db.query(`CREATE TABLE IF NOT EXISTS ${lower} LIKE ${upper}`);
    }catch(e){/* ignore */}
    for(const col of extraCols){
      for(const tbl of [upper, lower]){
        const colName = col.split(' ')[0];
        try{
          await db.query(`ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS ${col}`);
        }catch(e){/* ignore */}
      }
    }
  }
  console.log('Lowercase stub tables ensured.');
  process.exit(0);
})();
