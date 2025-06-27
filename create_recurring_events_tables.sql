-- Create RecurringEvents table for managing recurring activities
CREATE TABLE IF NOT EXISTS RecurringEvents (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  day_of_week ENUM('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun') NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  location VARCHAR(255) NOT NULL,
  activity_type ENUM('School', 'Club', 'Sport', 'Other') NOT NULL,
  created_by INT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (created_by) REFERENCES Users(id) ON DELETE CASCADE,
  INDEX idx_day_time (day_of_week, start_time),
  INDEX idx_activity_type (activity_type),
  INDEX idx_is_active (is_active)
);

-- Create EventSubscriptions table for tracking which parents are subscribed to events
CREATE TABLE IF NOT EXISTS EventSubscriptions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  event_id INT NOT NULL,
  user_id INT NOT NULL,
  child_id INT NOT NULL,
  subscribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (event_id) REFERENCES RecurringEvents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
  FOREIGN KEY (child_id) REFERENCES Children(id) ON DELETE CASCADE,
  
  UNIQUE KEY unique_subscription (event_id, user_id, child_id),
  INDEX idx_event_id (event_id),
  INDEX idx_user_id (user_id)
);

-- Create EventAssignments table for tracking drop-off/pickup assignments
CREATE TABLE IF NOT EXISTS EventAssignments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  event_id INT NOT NULL,
  event_date DATE NOT NULL,
  user_id INT NOT NULL,
  child_id INT NOT NULL,
  assignment_type ENUM('dropoff', 'pickup') NOT NULL,
  status ENUM('pending', 'confirmed', 'completed', 'cancelled') DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (event_id) REFERENCES RecurringEvents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
  FOREIGN KEY (child_id) REFERENCES Children(id) ON DELETE CASCADE,
  
  UNIQUE KEY unique_assignment (event_id, event_date, child_id, assignment_type),
  INDEX idx_event_date (event_date),
  INDEX idx_user_id (user_id),
  INDEX idx_status (status)
);

-- Create EventMessages table for messages specific to recurring events
CREATE TABLE IF NOT EXISTS EventMessages (
  id INT PRIMARY KEY AUTO_INCREMENT,
  event_id INT NOT NULL,
  sender_id INT NOT NULL,
  recipient_id INT NOT NULL,
  message TEXT NOT NULL,
  message_type ENUM('general', 'assignment', 'reminder') DEFAULT 'general',
  related_assignment_id INT NULL,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMP NULL,
  
  FOREIGN KEY (event_id) REFERENCES RecurringEvents(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES Users(id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_id) REFERENCES Users(id) ON DELETE CASCADE,
  FOREIGN KEY (related_assignment_id) REFERENCES EventAssignments(id) ON DELETE SET NULL,
  
  INDEX idx_event_id (event_id),
  INDEX idx_sender_id (sender_id),
  INDEX idx_recipient_id (recipient_id),
  INDEX idx_sent_at (sent_at)
);

-- Add some sample data for testing
INSERT INTO RecurringEvents (name, description, day_of_week, start_time, end_time, location, activity_type, created_by) VALUES
('Scouts', 'Weekly Scouts meeting for 8-12 year olds', 'Thu', '19:00:00', '21:00:00', 'Scout Hall, 123 Main Street', 'Club', 1),
('Soccer Practice', 'Under 10s soccer training', 'Tue', '16:00:00', '17:30:00', 'Community Sports Field', 'Sport', 1),
('Piano Lessons', 'Individual piano lessons', 'Wed', '15:00:00', '16:00:00', 'Music Academy, 456 Oak Avenue', 'Other', 1); 