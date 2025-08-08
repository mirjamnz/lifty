-- Unified Activity Groups System
-- Replaces both TrustedGroups and RecurringEventGroups with a single flexible system
-- Groups can optionally have recurring schedules

-- =====================================================
-- 1. MAIN ACTIVITY GROUPS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS ActivityGroups (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  creator_id INT NOT NULL,
  
  -- Privacy and access control
  privacy ENUM('public', 'private') DEFAULT 'public',
  invite_only BOOLEAN DEFAULT FALSE,
  
  -- Optional recurring schedule
  has_schedule BOOLEAN DEFAULT FALSE,
  day_of_week ENUM('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun') NULL,
  start_time TIME NULL,
  end_time TIME NULL,
  location VARCHAR(255) NULL,
  activity_type ENUM('School', 'Club', 'Sport', 'Social', 'Other') DEFAULT 'Social',
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (creator_id) REFERENCES Users(id) ON DELETE CASCADE,
  INDEX idx_creator_id (creator_id),
  INDEX idx_privacy (privacy),
  INDEX idx_has_schedule (has_schedule),
  INDEX idx_day_time (day_of_week, start_time),
  INDEX idx_activity_type (activity_type),
  INDEX idx_is_active (is_active)
);

-- =====================================================
-- 2. ACTIVITY GROUP MEMBERS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS ActivityGroupMembers (
  id INT PRIMARY KEY AUTO_INCREMENT,
  group_id INT NOT NULL,
  user_id INT NOT NULL,
  child_id INT NULL, -- NULL for parent-only members, filled for child participants
  role ENUM('admin', 'member') DEFAULT 'member',
  
  -- Driving preferences (only relevant for scheduled groups)
  can_drive BOOLEAN DEFAULT TRUE,
  preferred_driving_frequency INT DEFAULT 1 COMMENT 'How often they prefer to drive (1=weekly, 2=bi-weekly, etc.)',
  
  -- Attendance settings (only for scheduled groups)
  default_attendance BOOLEAN DEFAULT TRUE COMMENT 'Whether child attends by default',
  
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  
  FOREIGN KEY (group_id) REFERENCES ActivityGroups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
  FOREIGN KEY (child_id) REFERENCES Children(id) ON DELETE CASCADE,
  
  UNIQUE KEY unique_member (group_id, user_id, child_id),
  INDEX idx_group_id (group_id),
  INDEX idx_user_id (user_id),
  INDEX idx_child_id (child_id),
  INDEX idx_role (role),
  INDEX idx_is_active (is_active),
  INDEX idx_can_drive (can_drive)
);

-- =====================================================
-- 3. SCHEDULE OVERRIDES TABLE
-- =====================================================
-- For one-time changes to scheduled groups (e.g., "next Tuesday moved to 5pm")
CREATE TABLE IF NOT EXISTS ActivityScheduleOverrides (
  id INT PRIMARY KEY AUTO_INCREMENT,
  group_id INT NOT NULL,
  override_date DATE NOT NULL,
  new_start_time TIME NULL, -- NULL means cancelled for this date
  new_end_time TIME NULL,
  new_location VARCHAR(255) NULL,
  reason TEXT,
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (group_id) REFERENCES ActivityGroups(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES Users(id) ON DELETE CASCADE,
  
  UNIQUE KEY unique_override (group_id, override_date),
  INDEX idx_group_id (group_id),
  INDEX idx_override_date (override_date),
  INDEX idx_created_by (created_by)
);

-- =====================================================
-- 4. GROUP ASSIGNMENTS TABLE
-- =====================================================
-- For scheduled groups: tracks who's driving on which dates
CREATE TABLE IF NOT EXISTS ActivityGroupAssignments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  group_id INT NOT NULL,
  assignment_date DATE NOT NULL,
  user_id INT NOT NULL,
  child_id INT NOT NULL,
  assignment_type ENUM('dropoff', 'pickup') NOT NULL,
  status ENUM('pending', 'confirmed', 'completed', 'cancelled') DEFAULT 'pending',
  notes TEXT,
  is_cancelled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (group_id) REFERENCES ActivityGroups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
  FOREIGN KEY (child_id) REFERENCES Children(id) ON DELETE CASCADE,
  
  UNIQUE KEY unique_assignment (group_id, assignment_date, child_id, assignment_type),
  INDEX idx_group_id (group_id),
  INDEX idx_assignment_date (assignment_date),
  INDEX idx_user_id (user_id),
  INDEX idx_child_id (child_id),
  INDEX idx_status (status),
  INDEX idx_is_cancelled (is_cancelled)
);

-- =====================================================
-- 5. GROUP INVITATIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS ActivityGroupInvitations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  group_id INT NOT NULL,
  inviter_id INT NOT NULL,
  invitee_email VARCHAR(255) NOT NULL,
  child_ids JSON NULL COMMENT 'Array of child IDs being invited',
  status ENUM('pending', 'accepted', 'declined') DEFAULT 'pending',
  invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMP NULL,
  
  FOREIGN KEY (group_id) REFERENCES ActivityGroups(id) ON DELETE CASCADE,
  FOREIGN KEY (inviter_id) REFERENCES Users(id) ON DELETE CASCADE,
  
  UNIQUE KEY unique_invitation (group_id, invitee_email),
  INDEX idx_group_id (group_id),
  INDEX idx_inviter_id (inviter_id),
  INDEX idx_invitee_email (invitee_email),
  INDEX idx_status (status)
);

-- =====================================================
-- 6. GROUP MESSAGES TABLE
-- =====================================================
-- Unified messaging for all groups (replaces both short-notice responses and event messages)
CREATE TABLE IF NOT EXISTS ActivityGroupMessages (
  id INT PRIMARY KEY AUTO_INCREMENT,
  group_id INT NOT NULL,
  sender_id INT NOT NULL,
  message TEXT NOT NULL,
  message_type ENUM('chat', 'announcement', 'schedule_change', 'assignment') DEFAULT 'chat',
  related_assignment_id INT NULL,
  related_override_id INT NULL,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (group_id) REFERENCES ActivityGroups(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES Users(id) ON DELETE CASCADE,
  FOREIGN KEY (related_assignment_id) REFERENCES ActivityGroupAssignments(id) ON DELETE SET NULL,
  FOREIGN KEY (related_override_id) REFERENCES ActivityScheduleOverrides(id) ON DELETE SET NULL,
  
  INDEX idx_group_id (group_id),
  INDEX idx_sender_id (sender_id),
  INDEX idx_sent_at (sent_at),
  INDEX idx_message_type (message_type)
);

-- =====================================================
-- 7. INDEXES FOR PERFORMANCE
-- =====================================================
-- Additional composite indexes for common queries
CREATE INDEX idx_activity_groups_active_schedule ON ActivityGroups(is_active, has_schedule);
CREATE INDEX idx_activity_group_members_active ON ActivityGroupMembers(group_id, is_active);
CREATE INDEX idx_assignments_date_group ON ActivityGroupAssignments(assignment_date, group_id);
CREATE INDEX idx_messages_group_recent ON ActivityGroupMessages(group_id, sent_at DESC);
