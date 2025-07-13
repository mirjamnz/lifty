-- Add privacy field to Users table
ALTER TABLE Users ADD COLUMN is_address_private BOOLEAN DEFAULT FALSE;

-- Update existing users to have public addresses by default
UPDATE Users SET is_address_private = FALSE WHERE is_address_private IS NULL; 