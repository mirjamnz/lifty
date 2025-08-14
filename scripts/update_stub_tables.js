const db=require('../db');

(async()=>{
  const stmts=[
    // RecurringEvents
    "CREATE TABLE IF NOT EXISTS RecurringEvents (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(255), day_of_week CHAR(3), start_time TIME, end_time TIME, location VARCHAR(255))",
    "ALTER TABLE RecurringEvents ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
    "ALTER TABLE RecurringEvents ADD COLUMN IF NOT EXISTS is_group_event BOOLEAN DEFAULT TRUE",
    // lowercase variant
    "CREATE TABLE IF NOT EXISTS recurringevents LIKE RecurringEvents",

    // EventGroupMembers
    "CREATE TABLE IF NOT EXISTS EventGroupMembers (id INT PRIMARY KEY AUTO_INCREMENT, event_id INT, user_id INT, role VARCHAR(20))",
    "ALTER TABLE EventGroupMembers ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
    "CREATE TABLE IF NOT EXISTS eventgroupmembers LIKE EventGroupMembers",

    // EventInstances
    "CREATE TABLE IF NOT EXISTS EventInstances (id INT PRIMARY KEY AUTO_INCREMENT, event_id INT)",
    "ALTER TABLE EventInstances ADD COLUMN IF NOT EXISTS event_date DATE",
    "ALTER TABLE EventInstances ADD COLUMN IF NOT EXISTS driver_id INT",
    "CREATE TABLE IF NOT EXISTS eventinstances LIKE EventInstances",

    // EventAssignments
    "CREATE TABLE IF NOT EXISTS EventAssignments (id INT PRIMARY KEY AUTO_INCREMENT, event_id INT, child_id INT, user_id INT, assignment_type ENUM('dropoff','pickup'))",
    "ALTER TABLE EventAssignments ADD COLUMN IF NOT EXISTS event_date DATE",
    "ALTER TABLE EventAssignments ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN DEFAULT FALSE",
    "ALTER TABLE EventAssignments ADD COLUMN IF NOT EXISTS notes TEXT",
    "CREATE TABLE IF NOT EXISTS eventassignments LIKE EventAssignments",

    // EventGroupInvitations
    "CREATE TABLE IF NOT EXISTS EventGroupInvitations (id INT PRIMARY KEY AUTO_INCREMENT, event_id INT, status VARCHAR(20))",
    "ALTER TABLE EventGroupInvitations ADD COLUMN IF NOT EXISTS invitee_email VARCHAR(255)",
    "ALTER TABLE EventGroupInvitations ADD COLUMN IF NOT EXISTS inviter_id INT",
    "ALTER TABLE EventGroupInvitations ADD COLUMN IF NOT EXISTS invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    "CREATE TABLE IF NOT EXISTS eventgroupinvitations LIKE EventGroupInvitations"
  ];
  for(const sql of stmts){
    try{await db.query(sql); console.log('✓',sql.split(' ')[0],sql.split(' ')[2]);}
    catch(e){console.log('⚠',e.code,e.sqlMessage);}
  }
  process.exit(0);
})();
