-- Migration: Drop legacy event-related tables (RecurringEvents system)
-- Created on 2025-08-14
-- ------------------------------------------------------------------
-- UP: Executes in production/staging when RUN_DROP_UNUSED is enabled
-- ------------------------------------------------------------------
DROP TABLE IF EXISTS
  RecurringEvents,
  EventAssignments,
  EventGroupInvitations,
  EventGroupMembers,
  EventGroupMessages,
  EventInstanceAttendance,
  EventInstances,
  EventMessages,
  EventSubscriptions;

-- ------------------------------------------------------------------
-- DOWN (manual rollback):
--   1. Restore from db_backup/YYYYMMDD_HHMM_lifty.sql.gz   OR
--   2. Re-create each table structure from backup dump.
-- ------------------------------------------------------------------
