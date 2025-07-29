const db = require('../db');

async function createEventInstances() {
  try {
    console.log('🔧 Creating EventInstances for all future dates...');
    
    // Get all active recurring events
    const [recurringEvents] = await db.query(`
      SELECT id, name, day_of_week, start_time, end_time, location 
      FROM RecurringEvents 
      WHERE is_active = TRUE
    `);
    
    console.log(`Found ${recurringEvents.length} active recurring events`);
    
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const today = new Date();
    
    for (const event of recurringEvents) {
      console.log(`Processing event: ${event.name} (ID: ${event.id})`);
      
      const eventDayIndex = dayNames.indexOf(event.day_of_week);
      
      // Generate next 12 weeks of occurrences
      for (let week = 0; week < 12; week++) {
        const eventDate = new Date(today);
        eventDate.setDate(today.getDate() + (week * 7));
        
        // Find the next occurrence of this day of the week
        while (eventDate.getDay() !== eventDayIndex) {
          eventDate.setDate(eventDate.getDate() + 1);
        }
        
        // Only process if it's in the future
        if (eventDate >= today) {
          const event_date_str = eventDate.toISOString().split('T')[0];
          
          // Check if EventInstance already exists
          const [[existingInstance]] = await db.query(
            'SELECT id FROM EventInstances WHERE event_id = ? AND event_date = ?',
            [event.id, event_date_str]
          );
          
          if (!existingInstance) {
            // Create EventInstance
            await db.query(`
              INSERT INTO EventInstances (event_id, event_date) 
              VALUES (?, ?)
            `, [event.id, event_date_str]);
            
            console.log(`  Created EventInstance for ${event_date_str}`);
          } else {
            console.log(`  EventInstance already exists for ${event_date_str}`);
          }
        }
      }
    }
    
    console.log('✅ EventInstances creation completed!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error creating EventInstances:', err);
    process.exit(1);
  }
}

createEventInstances(); 