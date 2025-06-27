-- Create RideBookings table for tracking ride bookings
CREATE TABLE IF NOT EXISTS RideBookings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  offer_id INT NOT NULL,
  user_id INT NOT NULL,
  child_id INT NOT NULL,
  seats_requested INT NOT NULL DEFAULT 1,
  notes TEXT,
  status ENUM('pending', 'confirmed', 'accepted', 'rejected', 'cancelled') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (offer_id) REFERENCES RideOffers(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
  FOREIGN KEY (child_id) REFERENCES Children(id) ON DELETE CASCADE,
  
  INDEX idx_offer_id (offer_id),
  INDEX idx_user_id (user_id),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
); 