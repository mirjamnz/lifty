-- Enhanced Recurring Event Group System
-- This file contains the database schema updates for supporting multiple families
-- in recurring events with group management, assignments, and chat functionality.

-- =====================================================
-- 1. EVENT GROUP MEMBERSHIP TABLE
-- =====================================================
-- Tracks which parents and children are part of a recurring event group
CREATE TABLE IF NOT EXISTS EventGroupMembers (
  id INT PRIMARY KEY AUTO_INCREMENT,
  event_id INT NOT NULL,
  user_id INT NOT NULL,
  child_id INT NULL, -- NULL for parent-only members, child_id for child members
  role ENUM('admin', 'parent', 'child') DEFAULT 'parent',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  
  -- New fields for attendance tracking
  default_attendance BOOLEAN DEFAULT TRUE COMMENT 'Whether child attends by default',
  attendance_confirmed BOOLEAN DEFAULT FALSE COMMENT 'Whether parent has confirmed attendance',
  attendance_confirmed_at TIMESTAMP NULL COMMENT 'When attendance was confirmed',
  attendance_confirmed_by INT NULL COMMENT 'Who confirmed the attendance',
  can_drive BOOLEAN DEFAULT TRUE COMMENT 'Whether this parent can be assigned as driver',
  preferred_driving_frequency INT DEFAULT 1 COMMENT 'How often they prefer to drive (1=weekly, 2=bi-weekly, etc.)',
  
  FOREIGN KEY (event_id) REFERENCES RecurringEvents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
  FOREIGN KEY (child_id) REFERENCES Children(id) ON DELETE CASCADE,
  FOREIGN KEY (attendance_confirmed_by) REFERENCES Users(id) ON DELETE SET NULL,
  
  -- Ensure unique parent-child combinations per event
  UNIQUE KEY unique_member (event_id, user_id, child_id),
  INDEX idx_event_id (event_id),
  INDEX idx_user_id (user_id),
  INDEX idx_child_id (child_id),
  INDEX idx_is_active (is_active),
  INDEX idx_attendance_confirmed (attendance_confirmed),
  INDEX idx_can_drive (can_drive)
);

-- =====================================================
-- 2. EVENT GROUP MESSAGES TABLE
-- =====================================================
-- Group chat messages for recurring events
CREATE TABLE IF NOT EXISTS EventGroupMessages (
  id INT PRIMARY KEY AUTO_INCREMENT,
  event_id INT NOT NULL,
  sender_id INT NOT NULL,
  message TEXT NOT NULL,
  message_type ENUM('general', 'assignment', 'reminder', 'cancellation') DEFAULT 'general',
  related_assignment_id INT NULL, -- Link to specific assignment if relevant
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (event_id) REFERENCES RecurringEvents(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES Users(id) ON DELETE CASCADE,
  FOREIGN KEY (related_assignment_id) REFERENCES EventAssignments(id) ON DELETE SET NULL,
  
  INDEX idx_event_id (event_id),
  INDEX idx_sender_id (sender_id),
  INDEX idx_sent_at (sent_at),
  INDEX idx_message_type (message_type)
);

-- =====================================================
-- 3. EVENT INSTANCES TABLE (NEW)
-- =====================================================
-- Tracks individual occurrences of recurring events
CREATE TABLE IF NOT EXISTS EventInstances (
  id INT PRIMARY KEY AUTO_INCREMENT,
  event_id INT NOT NULL,
  event_date DATE NOT NULL,
  driver_id INT NULL COMMENT 'Assigned driver for this instance',
  driver_assigned_at TIMESTAMP NULL,
  driver_assigned_by INT NULL,
  status ENUM('pending', 'confirmed', 'completed', 'cancelled') DEFAULT 'pending',
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (event_id) REFERENCES RecurringEvents(id) ON DELETE CASCADE,
  FOREIGN KEY (driver_id) REFERENCES Users(id) ON DELETE SET NULL,
  FOREIGN KEY (driver_assigned_by) REFERENCES Users(id) ON DELETE SET NULL,
  
  UNIQUE KEY unique_event_date (event_id, event_date),
  INDEX idx_event_date (event_date),
  INDEX idx_driver_id (driver_id),
  INDEX idx_status (status)
);

-- =====================================================
-- 4. EVENT INSTANCE ATTENDANCE TABLE (NEW)
-- =====================================================
-- Tracks attendance for individual event instances
CREATE TABLE IF NOT EXISTS EventInstanceAttendance (
  id INT PRIMARY KEY AUTO_INCREMENT,
  instance_id INT NOT NULL,
  child_id INT NOT NULL,
  parent_id INT NOT NULL,
  will_attend BOOLEAN DEFAULT TRUE,
  confirmed_at TIMESTAMP NULL,
  confirmed_by INT NULL,
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (instance_id) REFERENCES EventInstances(id) ON DELETE CASCADE,
  FOREIGN KEY (child_id) REFERENCES Children(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES Users(id) ON DELETE CASCADE,
  FOREIGN KEY (confirmed_by) REFERENCES Users(id) ON DELETE SET NULL,
  
  UNIQUE KEY unique_instance_child (instance_id, child_id),
  INDEX idx_instance_id (instance_id),
  INDEX idx_child_id (child_id),
  INDEX idx_will_attend (will_attend)
);

-- =====================================================
-- 5. EVENT GROUP INVITATIONS TABLE
-- =====================================================
-- Track invitations to join event groups
CREATE TABLE IF NOT EXISTS EventGroupInvitations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  event_id INT NOT NULL,
  inviter_id INT NOT NULL, -- Who sent the invitation
  invitee_email VARCHAR(255) NOT NULL,
  invitee_name VARCHAR(255) NULL, -- Optional name for non-registered users
  status ENUM('pending', 'accepted', 'declined', 'expired') DEFAULT 'pending',
  invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMP NULL,
  expires_at TIMESTAMP NULL, -- Optional expiration
  
  FOREIGN KEY (event_id) REFERENCES RecurringEvents(id) ON DELETE CASCADE,
  FOREIGN KEY (inviter_id) REFERENCES Users(id) ON DELETE CASCADE,
  
  UNIQUE KEY unique_invitation (event_id, invitee_email),
  INDEX idx_event_id (event_id),
  INDEX idx_invitee_email (invitee_email),
  INDEX idx_status (status),
  INDEX idx_expires_at (expires_at)
);

-- =====================================================
-- 6. MODIFY EXISTING EventAssignments TABLE
-- =====================================================
-- Add fields to support weekly opt-out and better tracking

-- Add new columns to EventAssignments (MariaDB compatible)
SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA = DATABASE() 
   AND TABLE_NAME = 'EventAssignments' 
   AND COLUMN_NAME = 'is_cancelled') = 0,
  'ALTER TABLE EventAssignments ADD COLUMN is_cancelled BOOLEAN DEFAULT FALSE COMMENT "Child opted out for this week"',
  'SELECT "Column is_cancelled already exists"'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA = DATABASE() 
   AND TABLE_NAME = 'EventAssignments' 
   AND COLUMN_NAME = 'cancelled_by') = 0,
  'ALTER TABLE EventAssignments ADD COLUMN cancelled_by INT NULL COMMENT "User who cancelled this assignment"',
  'SELECT "Column cancelled_by already exists"'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA = DATABASE() 
   AND TABLE_NAME = 'EventAssignments' 
   AND COLUMN_NAME = 'cancelled_at') = 0,
  'ALTER TABLE EventAssignments ADD COLUMN cancelled_at TIMESTAMP NULL COMMENT "When this assignment was cancelled"',
  'SELECT "Column cancelled_at already exists"'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA = DATABASE() 
   AND TABLE_NAME = 'EventAssignments' 
   AND COLUMN_NAME = 'cancellation_reason') = 0,
  'ALTER TABLE EventAssignments ADD COLUMN cancellation_reason TEXT NULL COMMENT "Reason for cancellation (e.g., child sick)"',
  'SELECT "Column cancellation_reason already exists"'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA = DATABASE() 
   AND TABLE_NAME = 'EventAssignments' 
   AND COLUMN_NAME = 'group_assignment') = 0,
  'ALTER TABLE EventAssignments ADD COLUMN group_assignment BOOLEAN DEFAULT FALSE COMMENT "Whether this is part of a group event"',
  'SELECT "Column group_assignment already exists"'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add foreign key for cancelled_by (if it doesn't exist)
SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
   WHERE TABLE_SCHEMA = DATABASE() 
   AND TABLE_NAME = 'EventAssignments' 
   AND CONSTRAINT_NAME = 'fk_assignment_cancelled_by') = 0,
  'ALTER TABLE EventAssignments ADD CONSTRAINT fk_assignment_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES Users(id) ON DELETE SET NULL',
  'SELECT "Foreign key fk_assignment_cancelled_by already exists"'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add indexes for better performance
SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
   WHERE TABLE_SCHEMA = DATABASE() 
   AND TABLE_NAME = 'EventAssignments' 
   AND INDEX_NAME = 'idx_is_cancelled') = 0,
  'ALTER TABLE EventAssignments ADD INDEX idx_is_cancelled (is_cancelled)',
  'SELECT "Index idx_is_cancelled already exists"'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
   WHERE TABLE_SCHEMA = DATABASE() 
   AND TABLE_NAME = 'EventAssignments' 
   AND INDEX_NAME = 'idx_group_assignment') = 0,
  'ALTER TABLE EventAssignments ADD INDEX idx_group_assignment (group_assignment)',
  'SELECT "Index idx_group_assignment already exists"'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
   WHERE TABLE_SCHEMA = DATABASE() 
   AND TABLE_NAME = 'EventAssignments' 
   AND INDEX_NAME = 'idx_event_date_status') = 0,
  'ALTER TABLE EventAssignments ADD INDEX idx_event_date_status (event_date, status, is_cancelled)',
  'SELECT "Index idx_event_date_status already exists"'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- =====================================================
-- 7. MODIFY EXISTING RecurringEvents TABLE
-- =====================================================
-- Add fields to support group management

-- Add new columns to RecurringEvents (MariaDB compatible)
SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA = DATABASE() 
   AND TABLE_NAME = 'RecurringEvents' 
   AND COLUMN_NAME = 'is_group_event') = 0,
  'ALTER TABLE RecurringEvents ADD COLUMN is_group_event BOOLEAN DEFAULT FALSE COMMENT "Whether this is a group event with multiple families"',
  'SELECT "Column is_group_event already exists"'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA = DATABASE() 
   AND TABLE_NAME = 'RecurringEvents' 
   AND COLUMN_NAME = 'is_private') = 0,
  'ALTER TABLE RecurringEvents ADD COLUMN is_private BOOLEAN DEFAULT FALSE COMMENT "Whether this event is private (only visible to invited users)"',
  'SELECT "Column is_private already exists"'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA = DATABASE() 
   AND TABLE_NAME = 'RecurringEvents' 
   AND COLUMN_NAME = 'max_participants') = 0,
  'ALTER TABLE RecurringEvents ADD COLUMN max_participants INT NULL COMMENT "Maximum number of participants allowed"',
  'SELECT "Column max_participants already exists"'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA = DATABASE() 
   AND TABLE_NAME = 'RecurringEvents' 
   AND COLUMN_NAME = 'auto_assign') = 0,
  'ALTER TABLE RecurringEvents ADD COLUMN auto_assign BOOLEAN DEFAULT FALSE COMMENT "Whether to auto-assign drivers in rotation"',
  'SELECT "Column auto_assign already exists"'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA = DATABASE() 
   AND TABLE_NAME = 'RecurringEvents' 
   AND COLUMN_NAME = 'group_description') = 0,
  'ALTER TABLE RecurringEvents ADD COLUMN group_description TEXT NULL COMMENT "Description for group members"',
  'SELECT "Column group_description already exists"'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add indexes
SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
   WHERE TABLE_SCHEMA = DATABASE() 
   AND TABLE_NAME = 'RecurringEvents' 
   AND INDEX_NAME = 'idx_is_group_event') = 0,
  'ALTER TABLE RecurringEvents ADD INDEX idx_is_group_event (is_group_event)',
  'SELECT "Index idx_is_group_event already exists"'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- =====================================================
-- 8. SAMPLE DATA FOR TESTING
-- =====================================================

-- Insert a sample group event (Scouts) - only if it doesn't exist
INSERT IGNORE INTO RecurringEvents (name, description, day_of_week, start_time, end_time, location, activity_type, created_by, is_group_event, group_description) VALUES
('Scouts Weekly Meeting', 'Weekly Scouts meeting for 8-10 year olds', 'Wed', '18:00:00', '19:30:00', 'Community Center', 'Club', 1, TRUE, 'Weekly Scouts meeting. Parents take turns driving children to and from the meeting.');

-- Note: Replace '1' with an actual user_id from your Users table

-- =====================================================
-- 9. MIGRATION HELPER QUERIES
-- =====================================================

-- Update existing EventAssignments to mark them as group assignments if they exist
-- (Run this after creating the tables above)
UPDATE EventAssignments 
SET group_assignment = TRUE 
WHERE event_id IN (SELECT id FROM RecurringEvents WHERE is_group_event = TRUE);

-- =====================================================
-- 10. USEFUL QUERIES FOR THE APPLICATION
-- =====================================================

-- Get all members of a group event
-- SELECT egm.*, u.name AS user_name, c.name AS child_name, re.name AS event_name
-- FROM EventGroupMembers egm
-- JOIN Users u ON egm.user_id = u.id
-- LEFT JOIN Children c ON egm.child_id = c.id
-- JOIN RecurringEvents re ON egm.event_id = re.id
-- WHERE egm.event_id = ? AND egm.is_active = TRUE;

-- Get upcoming assignments for a group event (excluding cancelled)
-- SELECT ea.*, re.name AS event_name, re.location, c.name AS child_name, u.name AS assigned_parent_name
-- FROM EventAssignments ea
-- JOIN RecurringEvents re ON ea.event_id = re.id
-- JOIN Children c ON ea.child_id = c.id
-- JOIN Users u ON ea.user_id = u.id
-- WHERE ea.event_id = ? AND ea.event_date >= CURDATE() AND ea.is_cancelled = FALSE
-- ORDER BY ea.event_date, ea.assignment_type;

-- Get group chat messages
-- SELECT egm.*, u.name AS sender_name
-- FROM EventGroupMessages egm
-- JOIN Users u ON egm.sender_id = u.id
-- WHERE egm.event_id = ?
-- ORDER BY egm.sent_at ASC;

-- =====================================================
-- 11. CLEANUP QUERIES (if needed)
-- =====================================================

-- To remove all group-related data (use with caution):
-- DELETE FROM EventGroupMessages WHERE event_id IN (SELECT id FROM RecurringEvents WHERE is_group_event = TRUE);
-- DELETE FROM EventGroupMembers WHERE event_id IN (SELECT id FROM RecurringEvents WHERE is_group_event = TRUE);
-- DELETE FROM EventGroupInvitations WHERE event_id IN (SELECT id FROM RecurringEvents WHERE is_group_event = TRUE);
-- UPDATE EventAssignments SET group_assignment = FALSE WHERE group_assignment = TRUE;
-- UPDATE RecurringEvents SET is_group_event = FALSE WHERE is_group_event = TRUE; 