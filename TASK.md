# Task Tracking

## Completed Tasks

### ✅ Added Messages Menu to Child Dashboard (2025-07-24)

**Problem:** Children only had "My Dashboard" and "Logout" menu items. When they clicked on unread message toasts from group chats, they were taken to pages showing the full adult navbar instead of the child navbar.

**Solution:**
1. **Updated Child Navbar** - Added "Messages" menu item to `views/partials/navbar-child.ejs`
2. **Created Child Messages Route** - Added `/messages/child/inbox` route in `routes/messages.js`
3. **Created Child Messages Template** - New `views/messages-child-inbox.ejs` template that:
   - Shows all ride-related conversations in a card layout
   - Displays unread message counts with badges
   - Shows ride details (pickup/dropoff locations, status, driver)
   - Provides easy access to group chats
   - Uses child navbar consistently

**Impact:** 
- Children now have easy access to their messages from the main navigation
- Child users stay within the child interface when accessing messages
- Better organization of ride-related conversations for children
- Consistent UI experience for child users

### ✅ Fixed Notification Duplication Issue (2025-07-24)

**Problem:** Users were seeing duplicate notifications - the same notification appeared in both "General Notifications" and "Trusted Group Notifications" sections.

**Root Cause:** The notification functions in `utils/notifications.js` were creating both general notifications AND trusted group notifications for the same events.

**Solution:**
1. **Modified `notifyUserAddedToGroup` function** - Now only creates trusted group notifications
2. **Modified `notifyUserRemovedFromGroup` function** - Now only creates trusted group notifications  
3. **Modified `notifyRideRequestResponse` function** - Now only creates trusted group notifications
4. **Created cleanup script** - `scripts/cleanup_duplicate_notifications.js` to remove existing duplicates
5. **Fixed notifications page formatting** - Added proper HTML5 DOCTYPE and structure to `views/notifications.ejs`

**Files Changed:**
- `utils/notifications.js` - Updated notification logic
- `scripts/cleanup_duplicate_notifications.js` - Database cleanup
- `views/notifications.ejs` - Fixed HTML structure and null checks
- `views/messages-group.ejs` - Added checks for undefined variables

**Impact:** 
- No more duplicate notifications for users
- Cleaner, more organized notification system
- Proper categorization of notification types
- Removed 3 existing duplicate notifications from database

### ✅ Consolidated Messaging System for Short-Notice Requests (2025-01-08)

**Problem:** Short-notice requests had a separate OK/Decline button system that was different from the main messaging system used by recurring events and ride requests, causing user confusion.

**Solution:**
1. **Removed Response Buttons** - Eliminated OK/Decline buttons from `views/short-notice-detail.ejs`
2. **Added Group Message Routes** - Created `/messages/group/short-notice/:requestId` routes in `routes/messages.js`
3. **Updated Short-Notice Routes** - Removed the old response handling system from `routes/shortNotice.js`
4. **Enhanced Messaging Template** - Updated `views/messages-group.ejs` to handle short-notice discussions
5. **Updated Notifications** - Modified `utils/notifications.js` to notify about discussions instead of responses
6. **Unified Communication Flow** - All communication now happens through the Messages section

**Files Changed:**
- `views/short-notice-detail.ejs` - Replaced buttons with "Join Discussion" link
- `routes/messages.js` - Added short-notice group message routes
- `routes/shortNotice.js` - Removed old response handling
- `views/messages-group.ejs` - Added support for short-notice requests
- `utils/notifications.js` - Updated notification system

**Impact:** 
- Unified communication system across all features
- Eliminated confusion between two different response mechanisms
- Consistent user experience for all group coordination
- Better message threading and conversation history

### 🔧 Fixed Group Members Display Issue (2025-01-08)

**Problem:** Andy couldn't see the member list for "Balmore U9 Football Team" trusted group even though he was a member.

**Investigation:**
1. **Database Check** - Verified Andy (User ID 74) is properly recorded as a member of group 4
2. **API Logic Test** - Confirmed the SQL queries work correctly and return expected results
3. **Enhanced Error Handling** - Added detailed logging and better error messages

**Solution:**
1. **Added Debug Logging** - Enhanced API endpoint with detailed session and membership logging
2. **Improved Error Messages** - Frontend now shows specific error details and user information
3. **Fixed SQL Query** - Corrected `joined_at` to `added_at` field name in members query
4. **Added Debug Endpoint** - Created `/trusted-groups/debug-session` for troubleshooting
5. **Enhanced Permission Check** - Now checks both membership and creator status

**Files Changed:**
- `routes/trustedGroups.js` - Enhanced logging and error handling
- `views/trusted-groups.ejs` - Improved error display and debugging info
- `scripts/check_group_membership.js` - Created membership verification script
- `scripts/test_group_members_api.js` - Created API logic testing script

**Resolution:**
- ✅ Issue identified as syntax error with optional chaining (`?.`) 
- ✅ Fixed by replacing optional chaining with traditional conditional checks
- ✅ Andy can now successfully view group members
- ✅ Debug logging removed from production code

### 🔄 Unified Activity Groups System - Phase 1 (2025-01-08)

**Problem:** Having two separate group types (Trusted Groups and Recurring Event Groups) was confusing users and created redundant functionality.

**Solution - Phase 1: Clean Slate & New Schema**
1. **Deleted All Trusted Groups** - Removed all existing trusted groups, members, short-notice requests, responses, and related data
2. **Created Unified Schema** - Built new ActivityGroups system that supports both chat-only groups and groups with optional recurring schedules
3. **Flexible Design** - Single group type that can optionally have scheduling, assignments, and one-time changes

**New Database Schema:**
- `ActivityGroups` - Main groups table with optional scheduling
- `ActivityGroupMembers` - Unified membership system 
- `ActivityScheduleOverrides` - For one-time schedule changes
- `ActivityGroupAssignments` - Driving assignments for scheduled groups
- `ActivityGroupInvitations` - Group invitation system
- `ActivityGroupMessages` - Unified messaging for all groups

**Key Features Planned:**
- ✅ Chat-only groups (like old Trusted Groups)
- ✅ Groups with recurring schedules (like old Event Groups)  
- ✅ One-time schedule changes ("move next Tuesday to 5pm")
- ✅ Unified messaging system
- ✅ Flexible member management

**Files Created:**
- `create_activity_groups_schema.sql` - Database schema
- `scripts/create_activity_groups_schema.js` - Schema creation script
- `scripts/delete_trusted_groups.js` - Data cleanup script

**Next Phase:**
- Build unified Groups interface
- Create routes for ActivityGroups
- Implement messaging integration
- Build schedule management features

## Pending Tasks

**Note:** Continue testing all functionality to ensure stability and user experience. 