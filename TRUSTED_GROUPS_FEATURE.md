# Trusted Groups & Short-Notice Ride Requests Feature

## Overview

This feature allows parents to create trusted groups with other parents and send quick short-notice ride requests to coordinate last-minute transportation needs.

## Features Implemented

### 1. Trusted Groups Management
- **Create Groups**: Parents can create trusted groups with specific names and descriptions
- **Add Members**: Group creators can add other parents to their groups
- **Leave Groups**: Members can leave groups they no longer want to be part of
- **Delete Groups**: Group creators can delete their groups (removes all members and requests)
- **View Groups**: See groups you created and groups you're a member of

### 2. Short-Notice Ride Requests
- **Send Requests**: Send quick ride requests to specific trusted groups
- **Respond to Requests**: Group members can respond with "OK", "OK + Message", or "Decline"
- **View Request Details**: See all responses and request details
- **Auto-suggestions**: System suggests parents from existing activities (recurring events, ride requests, organizations)

### 3. Smart Parent Suggestions
- **Automatic Discovery**: Parents from existing group activities automatically appear as suggestions
- **Multiple Sources**: Suggestions come from:
  - Recurring events where both parents are involved
  - Ride requests where parents have interacted
  - Organizations where both parents are affiliated
- **Easy Group Creation**: Quick setup of trusted groups with suggested parents

## Database Schema

### TrustedGroups Table
```sql
CREATE TABLE TrustedGroups (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    creator_id INT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES Users(id) ON DELETE CASCADE
);
```

### TrustedGroupMembers Table
```sql
CREATE TABLE TrustedGroupMembers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    group_id INT NOT NULL,
    user_id INT NOT NULL,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES TrustedGroups(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_group_member (group_id, user_id)
);
```

### ShortNoticeRequests Table
```sql
CREATE TABLE ShortNoticeRequests (
    id INT PRIMARY KEY AUTO_INCREMENT,
    requester_id INT NOT NULL,
    group_id INT NOT NULL,
    pickup_time DATETIME NOT NULL,
    dropoff_time DATETIME NOT NULL,
    pickup_location VARCHAR(500) NOT NULL,
    dropoff_location VARCHAR(500) NOT NULL,
    message TEXT,
    status ENUM('pending', 'accepted', 'declined', 'cancelled') DEFAULT 'pending',
    accepted_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (requester_id) REFERENCES Users(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES TrustedGroups(id) ON DELETE CASCADE,
    FOREIGN KEY (accepted_by) REFERENCES Users(id) ON DELETE SET NULL
);
```

### ShortNoticeResponses Table
```sql
CREATE TABLE ShortNoticeResponses (
    id INT PRIMARY KEY AUTO_INCREMENT,
    request_id INT NOT NULL,
    responder_id INT NOT NULL,
    response_type ENUM('ok', 'ok_with_message', 'decline') NOT NULL,
    message TEXT,
    responded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id) REFERENCES ShortNoticeRequests(id) ON DELETE CASCADE,
    FOREIGN KEY (responder_id) REFERENCES Users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_response (request_id, responder_id)
);
```

## Routes Created

### Trusted Groups Routes (`/trusted-groups`)
- `GET /trusted-groups` - View all trusted groups
- `POST /trusted-groups` - Create a new group
- `POST /trusted-groups/:id/add-member` - Add member to group
- `POST /trusted-groups/:id/remove-member` - Remove member from group
- `POST /trusted-groups/:id/leave` - Leave a group
- `DELETE /trusted-groups/:id` - Delete a group

### Short-Notice Routes (`/short-notice`)
- `GET /short-notice` - View all short-notice requests
- `POST /short-notice` - Create a new request
- `GET /short-notice/:id` - View request details
- `POST /short-notice/:id/respond` - Respond to a request
- `GET /short-notice/api/suggested-parents` - Get suggested parents for groups

## User Interface

### Navigation
- Added "Trusted Groups" and "Short-Notice" links to navbar
- Added quick action buttons to dashboard

### Pages Created
1. **Trusted Groups Page** (`/trusted-groups`)
   - Shows groups you created and groups you're in
   - Create new groups with member selection
   - Manage group members

2. **Short-Notice Page** (`/short-notice`)
   - Shows pending requests and your own requests
   - Create new requests with group selection
   - Quick response buttons

3. **Request Detail Page** (`/short-notice/:id`)
   - View full request details
   - Respond with OK/OK+Message/Decline
   - See all responses from group members

## Example Use Case

**Scenario**: Kids come home and say they need to be at school at 6:30 AM tomorrow for Sports Camp training.

**Steps**:
1. Parent goes to `/short-notice`
2. Clicks "New Request"
3. Selects "School Friends" trusted group
4. Sets pickup time to 6:15 AM, dropoff to 6:30 AM
5. Adds message: "Early morning sports practice - need pickup at 6:15 AM"
6. Sends request

**Response Flow**:
1. All members of "School Friends" group get notified
2. They can respond with:
   - **OK**: Simple acceptance
   - **OK + Message**: Acceptance with additional details
   - **Decline**: Cannot help this time
3. First person to accept becomes the driver
4. All responses are visible to the requester

## Smart Features

### Automatic Parent Discovery
The system automatically suggests parents for trusted groups based on:
- **Recurring Events**: Parents who participate in the same recurring events
- **Ride Requests**: Parents who have given/received rides from each other
- **Organizations**: Parents affiliated with the same schools/clubs

### Quick Setup
- Parents can quickly create groups with suggested members
- No need to manually search for and add each parent
- System learns from existing interactions

## Testing

### Sample Data
Run the sample data script to test the feature:
```bash
node scripts/create_sample_trusted_groups.js
```

This creates:
- "School Friends" group with 4 members
- "Sports Team" group with 3 members
- Sample short-notice request

### Test Scenarios
1. **Login as different users** to see group membership
2. **Create new groups** with different members
3. **Send short-notice requests** to different groups
4. **Respond to requests** with different response types
5. **Test the smart suggestions** by creating groups with suggested parents

## Future Enhancements

### Potential Improvements
1. **Real-time Notifications**: WebSocket notifications for new requests
2. **Mobile App**: Native mobile app for quick responses
3. **Calendar Integration**: Auto-add accepted rides to calendar
4. **Location Services**: Auto-fill pickup/dropoff locations
5. **Child-specific Requests**: Target requests to parents of specific children
6. **Recurring Short-notice**: Set up recurring short-notice requests
7. **Emergency Requests**: High-priority emergency ride requests
8. **Group Chat**: Built-in messaging for each trusted group

### Advanced Features
1. **Trust Scores**: System learns which parents are most reliable
2. **Auto-accept Rules**: Parents can set rules for auto-accepting requests
3. **Ride History**: Track successful short-notice rides
4. **Feedback System**: Rate and review ride experiences
5. **Integration with Regular Rides**: Convert short-notice to regular recurring rides

## Security & Privacy

### Data Protection
- Only group members can see and respond to requests
- Group creators can manage their groups
- Users can leave groups at any time
- All data is properly sanitized and validated

### Access Control
- Authentication required for all features
- Users can only access groups they're members of
- Group creators have additional management privileges

## Performance Considerations

### Database Optimization
- Indexes on frequently queried columns
- Efficient joins for group membership queries
- Caching for suggested parents

### Scalability
- Modular design allows for easy scaling
- API endpoints support future mobile apps
- Database schema supports high-volume usage

## Conclusion

This feature provides a comprehensive solution for quick ride coordination among trusted parent groups. The smart suggestion system makes it easy to set up groups, while the simple request/response flow ensures quick coordination for last-minute transportation needs.

The system is designed to be intuitive, secure, and scalable, with room for future enhancements based on user feedback and usage patterns. 