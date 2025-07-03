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
  
  FOREIGN KEY (event_id) REFERENCES RecurringEvents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
  FOREIGN KEY (child_id) REFERENCES Children(id) ON DELETE CASCADE,
  
  -- Ensure unique parent-child combinations per event
  UNIQUE KEY unique_member (event_id, user_id, child_id),
  INDEX idx_event_id (event_id),
  INDEX idx_user_id (user_id),
  INDEX idx_child_id (child_id),
  INDEX idx_is_active (is_active)
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
-- 3. EVENT GROUP INVITATIONS TABLE
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
-- 4. MODIFY EXISTING EventAssignments TABLE
-- =====================================================
-- Add fields to support weekly opt-out and better tracking

-- Add new columns to EventAssignments (if they don't exist)
ALTER TABLE EventAssignments 
ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN DEFAULT FALSE COMMENT 'Child opted out for this week',
ADD COLUMN IF NOT EXISTS cancelled_by INT NULL COMMENT 'User who cancelled this assignment',
ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP NULL COMMENT 'When this assignment was cancelled',
ADD COLUMN IF NOT EXISTS cancellation_reason TEXT NULL COMMENT 'Reason for cancellation (e.g., child sick)',
ADD COLUMN IF NOT EXISTS group_assignment BOOLEAN DEFAULT FALSE COMMENT 'Whether this is part of a group event';

-- Add foreign key for cancelled_by
ALTER TABLE EventAssignments 
ADD CONSTRAINT fk_assignment_cancelled_by 
FOREIGN KEY (cancelled_by) REFERENCES Users(id) ON DELETE SET NULL;

-- Add indexes for better performance
ALTER TABLE EventAssignments 
ADD INDEX IF NOT EXISTS idx_is_cancelled (is_cancelled),
ADD INDEX IF NOT EXISTS idx_group_assignment (group_assignment),
ADD INDEX IF NOT EXISTS idx_event_date_status (event_date, status, is_cancelled);

-- =====================================================
-- 5. MODIFY EXISTING RecurringEvents TABLE
-- =====================================================
-- Add fields to support group management

-- Add new columns to RecurringEvents (if they don't exist)
ALTER TABLE RecurringEvents 
ADD COLUMN IF NOT EXISTS is_group_event BOOLEAN DEFAULT FALSE COMMENT 'Whether this is a group event with multiple families',
ADD COLUMN IF NOT EXISTS max_participants INT NULL COMMENT 'Maximum number of participants allowed',
ADD COLUMN IF NOT EXISTS auto_assign BOOLEAN DEFAULT FALSE COMMENT 'Whether to auto-assign drivers in rotation',
ADD COLUMN IF NOT EXISTS group_description TEXT NULL COMMENT 'Description for group members';

-- Add indexes
ALTER TABLE RecurringEvents 
ADD INDEX IF NOT EXISTS idx_is_group_event (is_group_event);

-- =====================================================
-- 6. SAMPLE DATA FOR TESTING
-- =====================================================

-- Insert a sample group event (Scouts)
INSERT INTO RecurringEvents (name, description, day_of_week, start_time, end_time, location, activity_type, created_by, is_group_event, group_description) VALUES
('Scouts Weekly Meeting', 'Weekly Scouts meeting for 8-10 year olds', 'Wed', '18:00:00', '19:30:00', 'Community Center', 'Club', 1, TRUE, 'Weekly Scouts meeting. Parents take turns driving children to and from the meeting.');

-- Note: Replace '1' with an actual user_id from your Users table

-- =====================================================
-- 7. MIGRATION HELPER QUERIES
-- =====================================================

-- Update existing EventAssignments to mark them as group assignments if they exist
-- (Run this after creating the tables above)
UPDATE EventAssignments 
SET group_assignment = TRUE 
WHERE event_id IN (SELECT id FROM RecurringEvents WHERE is_group_event = TRUE);

-- =====================================================
-- 8. USEFUL QUERIES FOR THE APPLICATION
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
-- 9. CLEANUP QUERIES (if needed)
-- =====================================================

-- To remove all group-related data (use with caution):
-- DELETE FROM EventGroupMessages WHERE event_id IN (SELECT id FROM RecurringEvents WHERE is_group_event = TRUE);
-- DELETE FROM EventGroupMembers WHERE event_id IN (SELECT id FROM RecurringEvents WHERE is_group_event = TRUE);
-- DELETE FROM EventGroupInvitations WHERE event_id IN (SELECT id FROM RecurringEvents WHERE is_group_event = TRUE);
-- UPDATE EventAssignments SET group_assignment = FALSE WHERE group_assignment = TRUE;
-- UPDATE RecurringEvents SET is_group_event = FALSE WHERE is_group_event = TRUE; 