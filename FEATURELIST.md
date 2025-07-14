# 🚗 Lifty - Feature List

## Overview
Lifty is a comprehensive school transportation platform that connects parents, children, and drivers for safe and efficient ride sharing. The platform supports ride requests, offers, group messaging, real-time coordination, and recurring events management with integrated calendar functionality.

---

## 👥 User Roles & Authentication

### User Management
- **Multi-role system**: Parent, Child, Driver, Admin
- **Secure authentication**: Password hashing with bcrypt
- **Session management**: Persistent login sessions
- **User blocking**: Admin can block/unblock users
- **Profile management**: Update addresses, contact info

### Child Accounts
- **Child profiles**: Name, school, club information
- **Parent association**: Children linked to parent accounts
- **Child dashboard**: Simplified interface for children
- **Username/password**: Individual login credentials

---

## 🏠 Dashboard & Navigation

### Parent Dashboard
- **Home address management**: Set and update location with map integration
- **Child management**: Add, edit, delete children profiles
- **Organization management**: Add schools, clubs, events
- **Real-time updates**: Live status of ride requests and offers
- **Integrated calendar**: Full calendar view with all events and rides
- **Community map**: View other users with public addresses

### Child Dashboard
- **Ride status overview**: View assigned and pending rides
- **Color-coded status**: Green for assigned, yellow for pending
- **Chat access**: Direct access to group chats for assigned rides
- **Simplified interface**: Child-friendly navigation

### Admin Dashboard
- **User management**: View, edit, block/unblock users
- **Organization management**: Add/edit schools, clubs, events
- **System overview**: Monitor platform activity
- **Data management**: Manage children and parent relationships

---

## 🚗 Ride Management System

### Ride Requests
- **Create requests**: Parents can request rides for their children
- **Location specification**: Pickup and dropoff locations with autocomplete
- **Time scheduling**: Date and time selection with validation
- **Notes system**: Additional requirements and special instructions
- **Status tracking**: Pending, Assigned, Completed, Expired

### Ride Offers
- **Driver offers**: Parents can offer rides to other children
- **Seat management**: Specify available seats
- **School targeting**: Offer rides to specific schools
- **Time coordination**: Pickup time scheduling
- **Booking system**: Parents can book available seats

### Ride Assignment
- **Help system**: Parents can volunteer to help with ride requests
- **Automatic assignment**: Drivers can claim ride requests
- **Status updates**: Real-time status changes
- **Expiration handling**: Automatic cleanup of expired rides

---

## 📅 Calendar & Event Management

### Integrated Calendar System
- **FullCalendar integration**: Professional calendar interface
- **Multiple views**: Month, week, and list views
- **Color-coded events**: Different colors for different event types
- **Interactive events**: Click events for detailed information
- **Real-time updates**: Calendar refreshes with new data

### Event Types Displayed
- **🚗 Driving assignments**: Red - When you're driving others
- **🚌 Child rides**: Green - When your child has a ride
- **📅 Recurring events**: Yellow - Regular event assignments
- **🔵 Group events**: Blue - Events you're a group member of
- **⚫ Subscribed events**: Gray - Events your children are subscribed to

### Calendar Features
- **Event tooltips**: Hover for quick information
- **Detailed modals**: Click for comprehensive event details
- **Legend system**: Clear color coding explanation
- **Responsive design**: Works on all device sizes
- **Date navigation**: Easy month/week navigation

---

## 🎯 Recurring Events System

### Event Creation & Management
- **Recurring event setup**: Create weekly/monthly events
- **Day/time specification**: Set recurring schedule
- **Location management**: Event venue details
- **Privacy controls**: Public or private events
- **Active/inactive status**: Enable/disable events

### Group Management
- **Group invitations**: Invite users to join event groups
- **Member management**: Add/remove group participants
- **Invitation system**: Email-based invitations with status tracking
- **Group messaging**: Direct communication with group members
- **Member roles**: Different permission levels

### Event Subscriptions
- **Child subscriptions**: Subscribe children to events
- **Automatic assignments**: Generate recurring assignments
- **Subscription management**: Add/remove children from events
- **Calendar integration**: Subscribed events appear in calendar

### Assignment System
- **Parent assignments**: Assign parents to event responsibilities
- **Date-specific assignments**: Create assignments for specific dates
- **Status tracking**: Track assignment completion
- **Cancellation support**: Handle assignment cancellations

---

## 💬 Messaging System

### Direct Messaging
- **User-to-user**: Direct communication between parents
- **Ride-related**: Messages linked to specific ride requests/offers
- **Read status**: Track message read/unread status
- **Inbox management**: Organized message viewing

### Group Chat System
- **Ride-specific chats**: Group conversations for assigned rides
- **Event group chats**: Communication for recurring events
- **Multi-participant**: Child, parent(s), and driver can all participate
- **Real-time updates**: Live message display
- **Access control**: Only relevant users can access group chats
- **Message threading**: Grouped display in message inbox

### Message Notifications
- **Unread count**: Real-time badge showing unread messages
- **Toast notifications**: Pop-up alerts for new messages
- **Combined view**: Direct and group messages in unified interface
- **Auto-mark read**: Messages marked as read when viewing

---

## 🏫 Organization Management

### Schools & Clubs
- **Autocomplete search**: Quick organization lookup
- **Type categorization**: Schools, clubs, events, other
- **Location data**: Address and coordinates
- **Admin management**: Add/edit organizations

### Recurring Events
- **Event creation**: Set up regular events (weekly sports, etc.)
- **Assignment system**: Assign parents to event responsibilities
- **Participant management**: Track who's involved
- **Communication**: Direct messaging to event participants
- **Calendar integration**: Events appear in user calendars
- **Group invitations**: Invite users to join event groups

---

## 🗺️ Location & Mapping

### Address Management
- **Home address**: Set primary location for ride coordination
- **Geocoding**: Automatic coordinate lookup
- **Map integration**: Visual address selection
- **Location validation**: Ensure valid addresses
- **Privacy controls**: Option to hide address from other users

### Location Services
- **Autocomplete**: Smart location suggestions
- **Distance calculation**: Route planning assistance
- **Pickup/dropoff**: Precise location specification
- **Community map**: View other users with public addresses

---

## 🔔 Notification System

### Real-time Alerts
- **Unread message count**: Navbar badge showing new messages
- **Toast notifications**: Bottom-right popup for new messages
- **Status updates**: Real-time ride status changes
- **Booking confirmations**: Instant feedback on ride bookings
- **Event invitations**: Notifications for group event invitations

### Message Types
- **Direct messages**: Individual user communications
- **Group messages**: Ride-specific and event group chats
- **System notifications**: Platform updates and alerts
- **Invitation notifications**: Group event invitations

---

## 📱 User Interface Features

### Responsive Design
- **Mobile-friendly**: Works on all device sizes
- **Bootstrap 5**: Modern, clean interface
- **Card-based layout**: Organized information display
- **Color coding**: Status-based visual indicators

### Navigation
- **Role-based menus**: Different navigation for different user types
- **Breadcrumb navigation**: Clear page hierarchy
- **Quick actions**: Fast access to common tasks
- **Search functionality**: Find rides and organizations quickly

### Data Display
- **Table views**: Organized data presentation
- **Card views**: Alternative display option
- **Filtering**: Hide expired, show only seeking drivers
- **Sorting**: Order by time, status, location
- **Calendar views**: Visual event and ride scheduling

---

## 🔒 Security & Privacy

### Data Protection
- **Password hashing**: Secure credential storage
- **Session security**: Protected user sessions
- **Input validation**: Sanitized user inputs
- **SQL injection protection**: Parameterized queries

### Access Control
- **Role-based permissions**: Different access levels
- **Group chat security**: Only relevant users can access
- **Admin controls**: User management and blocking
- **Child protection**: Restricted access for children
- **Address privacy**: Option to hide home addresses

---

## 🛠️ Technical Features

### Database Management
- **MySQL integration**: Reliable data storage
- **Relationship management**: Complex user-child-parent relationships
- **Message threading**: Efficient group message storage
- **Status tracking**: Comprehensive ride lifecycle management
- **Event management**: Recurring events and assignments

### Performance
- **Efficient queries**: Optimized database operations
- **Caching**: Session-based data caching
- **Lazy loading**: On-demand data retrieval
- **Pagination**: Large dataset handling

### Development Features
- **Debug logging**: Comprehensive error tracking
- **Environment configuration**: Flexible deployment options
- **Modular architecture**: Organized code structure
- **API endpoints**: RESTful service design

---

## 📊 Analytics & Monitoring

### User Activity
- **Message tracking**: Monitor communication patterns
- **Ride statistics**: Track request/offer patterns
- **User engagement**: Monitor platform usage
- **System health**: Performance monitoring
- **Event participation**: Track recurring event engagement

### Admin Insights
- **User management**: Monitor user behavior
- **Content moderation**: Manage inappropriate content
- **System maintenance**: Platform upkeep tools
- **Data export**: Backup and reporting capabilities

---

## 🚀 Future Enhancement Opportunities

### Planned Features
- **Real-time notifications**: Push notifications for mobile
- **Payment integration**: Ride cost sharing
- **Rating system**: Driver and passenger reviews
- **Advanced scheduling**: More flexible recurring ride arrangements
- **Mobile app**: Native iOS/Android applications
- **GPS tracking**: Real-time ride location
- **Emergency contacts**: Safety feature integration
- **Insurance integration**: Ride coverage options
- **Calendar sync**: Integration with external calendars (Google, Outlook)
- **Event templates**: Pre-defined event types for common activities

---

## 📋 System Requirements

### Server Requirements
- **Node.js**: Runtime environment
- **MySQL**: Database system
- **Express.js**: Web framework
- **EJS**: Template engine

### Client Requirements
- **Modern browser**: Chrome, Firefox, Safari, Edge
- **JavaScript enabled**: Required for interactive features
- **Internet connection**: Real-time updates require connectivity

---

*Last updated: January 2025*
*Version: 1.1* 

### Review of the "My Rides" Query Logic

#### **What the Code Does**
- The `/rides` page builds the "My Rides" section from three main queries:
  1. **userAssignments**: Consolidated assignments where the user is the assigned parent/driver (grouped by event/date/type).
  2. **childAssignments**: Assignments for the user's children where the user is NOT the driver.
  3. **driverAssignments**: Assignments where the user is the assigned driver (for any child).

- The code then consolidates these into a `recurringAssignments` array, which is rendered in the UI.

#### **Potential Issues**
- The main query for `userAssignments`:
  ```sql
  SELECT ... FROM EventAssignments ea
  ...
  WHERE ea.user_id = ? AND ea.event_date >= CURDATE() AND ea.status != 'cancelled' AND ea.is_cancelled = FALSE
  GROUP BY ...
  ```
  - This should include group assignments, as the new logic sets `user_id` to the driver for group assignments.
  - However, if the driver is not the parent of any child in the group, the `MIN(c.user_id) as child_parent_id` may not match the driver, but this is only used for display.

- The code **should** show group assignments for the driver, as long as:
  - The `user_id` in `EventAssignments` is set to the driver's user ID (which the new logic does).
  - The assignment is not canceled and not marked as status "cancelled".

#### **Why Might Shar Not See Her Ride?**
- If the assignments are being created with the correct `user_id` (Shar's ID), they should show up.
- **Possible issues:**
  - The assignments are not being created for the correct date or with the correct user ID.
  - The assignment status is "cancelled" or `is_cancelled = TRUE`.
  - There is a mismatch in the event date or assignment type.

---

## **Next Steps**

1. **Verify in the Database:**
   - Are there `EventAssignments` for the relevant event/date with `user_id` = Shar's ID, `is_cancelled = FALSE`, and `status != 'cancelled'`?
   - Are the assignment types correct (`dropoff` and `pickup`)?

2. **Add Debug Logging (Optional):**
   - Add a debug log to print out the assignments fetched for the current user in the `/rides` route.

3. **(If Needed) Adjust the Query:**
   - If the assignments exist but are not shown, adjust the query to ensure group assignments are included.

---

## **Proposed Immediate Action**

**Add a debug log after fetching `userAssignments` to print the assignments for the current user.**  
This will help confirm if the assignments are being fetched but not displayed, or not being fetched at all.

Would you like me to add this debug logging, or do you want to check the database for the relevant assignments first?  
If you want, I can also add a filter to explicitly include `group_assignment = TRUE` in the query for clarity. 