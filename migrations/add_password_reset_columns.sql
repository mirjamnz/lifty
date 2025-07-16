-- Add password reset columns to Users table
ALTER TABLE Users 
ADD COLUMN reset_token VARCHAR(255) NULL,
ADD COLUMN reset_token_expiry DATETIME NULL;

-- Add index for better performance on token lookups
CREATE INDEX idx_users_reset_token ON Users(reset_token);
CREATE INDEX idx_users_reset_token_expiry ON Users(reset_token_expiry); 