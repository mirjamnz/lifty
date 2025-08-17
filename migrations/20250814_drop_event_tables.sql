-- Migration: Drop legacy event-related tables (RecurringEvents system)
-- Created on 2025-08-14
-- ------------------------------------------------------------------
-- UP: Executes in production/staging when RUN_DROP_UNUSED is enabled
-- ------------------------------------------------------------------
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS
  EventInstanceAttendance,
  EventMessages,
  EventGroupMessages,
  EventGroupMembers,
  EventGroupInvitations,
  EventAssignments,
  EventSubscriptions,
  EventInstances,
  RecurringEvents;

SET FOREIGN_KEY_CHECKS = 1;

-- ------------------------------------------------------------------
-- DOWN (manual rollback):
--   1. Restore from db_backup/YYYYMMDD_HHMM_lifty.sql.gz   OR
--   2. Re-create each table structure from backup dump.
-- ------------------------------------------------------------------
