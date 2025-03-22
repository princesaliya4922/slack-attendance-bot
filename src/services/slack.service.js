const { App } = require("@slack/bolt");
const Message = require("../models/message.model");
const env = require("../config/env");
const { chatWithGeminiCategory, chatWithGeminiQuery, chatWithgeminiResponse } = require("./gemini.service");
const {
  chatWithOpenAICategory,
  chatWithOpenAIQuery,
  chatWithOpenAIResponse,
} = require("./openai.service");
const { executeMongooseQueryEval } = require("./mongo.query");

// console.log(env.SLACK_APP_TOKEN)

const now = new Date();

const categoryEmoji = {
  'WFH': {
    emoji: '🏠',
    full: "Work From Home"
  },
  'FDL': {
    emoji: '🏖️',
    full: "Full Day Leave"
  },
  'OOO': {
    emoji: '🛣️',
    full: "Out of office"
  },
  'LTO': {
    emoji: '🏃‍♂️‍➡️',
    full: "Late to office"
  },
  'LE': {
    emoji: '🏃',
    full: "Leaving Early"
  },
  'HDL': {
    emoji: '🌴',
    full: "Half day leave"
  },
};

function localDate(date){
  return new Date(date).toLocaleString(
    "en-GB",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }
  );
}

function leaveResponse(obj, v){
  if(v=='v1' || v==undefined){
    return `*Leave Notification*\n👨‍💻 *Name:* ${
                obj.username
              }\n📅 *From:* ${localDate(obj.start_time)}\n📅 *To:* ${localDate(obj.end_time)}\n⏳ *duration:* ${
                obj.duration
              }\n${categoryEmoji[obj.category].emoji} *Type:* ${obj.category} (${categoryEmoji[obj.category].full})\n📝 *Reason:* ${
                obj.reason || "Not specified"
              }\n`
  }
  else if(v=='v2'){
    return `👨‍💻 *Name:* ${
      obj.username
    }\n📅 *From:* ${localDate(obj.start_time)}\n📅 *To:* ${localDate(obj.end_time)}\n⏳ *duration:* ${
      obj.duration
    }\n${categoryEmoji[obj.category].emoji} *Type:* ${obj.category} (${categoryEmoji[obj.category].full})`
  }
}



// Initialize Slack App
const app = new App({
  token: env.SLACK_BOT_TOKEN,
  signingSecret: env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: env.SLACK_APP_TOKEN,
  port: env.PORT,
});

// console.log(env.SLACK_APP_TOKEN)

async function getUserName(userId) {
  try {
    const response = await app.client.users.info({
      token: env.SLACK_BOT_TOKEN,
      user: userId,
    });

    return response.user
      ? response.user.real_name || response.user.name
      : "Unknown User";
  } catch (error) {
    console.error("❌ Error fetching user name:", error);
    return "Unknown User";
  }
}

async function getChannelName(channelId) {
  try {
    const response = await app.client.conversations.info({
      token: env.SLACK_BOT_TOKEN,
      channel: channelId,
    });

    if (response.channel) {
      // Check if it's a DM (im)
      if (response.channel.is_im) {
        return "Direct Message";
      }
      return response.channel.name;
    } else {
      return "Unknown Channel";
    }
  } catch (error) {
    console.error("❌ Error fetching channel name:", error);
    return "Unknown Channel";
  }
}

function formatResults(results) {
  return results
    .map(
      (r) =>
        `📌 **${r.username}** was on **${r.category}** leave from ${r.start_time} to ${r.end_time}`
    )
    .join("\n");
}

// PRIORITY LEAVE STARTS

// Define priority levels for different leave categories
const PRIORITY_LEVELS = {
  'FDL': 5, // Highest priority
  'HDL': 4,
  'LTO': 3,
  'LE': 3,  // Same priority as LTO
  'WFH': 2,
  'OOO': 1,
  'UNKNOWN': 0 // Lowest priority
};

/**
 * Checks if two date ranges overlap
 * @param {Date} start1 - Start time of first range
 * @param {Date} end1 - End time of first range
 * @param {Date} start2 - Start time of second range
 * @param {Date} end2 - End time of second range
 * @returns {boolean} - Whether the ranges overlap
 */
function datesOverlap(start1, end1, start2, end2) {
  return start1 <= end2 && start2 <= end1;
}

/**
 * Find all overlapping leave entries for a user
 * @param {Object} newLeave - The new leave entry to check
 * @returns {Promise<Array>} - Array of overlapping leave entries
 */
async function findOverlappingLeaves(newLeave) {
  const startOfDay = new Date(newLeave.start_time);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(newLeave.end_time);
  endOfDay.setHours(23, 59, 59, 999);

  // Find all leaves for this user on the same day(s)
  const potentialOverlaps = await Message.find({
    user: newLeave.user,
    $or: [
      // Leave starts or ends on the same day
      {
        start_time: { $gte: startOfDay, $lte: endOfDay }
      },
      {
        end_time: { $gte: startOfDay, $lte: endOfDay }
      },
      // Leave spans across the day
      {
        start_time: { $lte: startOfDay },
        end_time: { $gte: endOfDay }
      }
    ]
  });

  // Filter to only those that actually overlap in time
  return potentialOverlaps.filter(existingLeave => 
    datesOverlap(
      new Date(newLeave.start_time), 
      new Date(newLeave.end_time),
      new Date(existingLeave.start_time), 
      new Date(existingLeave.end_time)
    )
  );
}

/**
 * Handle overlapping leave entries based on priority rules
 * @param {Object} newLeave - The new leave entry
 * @param {Array} overlappingLeaves - Array of existing overlapping leave entries
 * @returns {Object} - Result with action to take and message
 */
async function handleOverlappingLeaves(newLeave, overlappingLeaves) {
  console.log('New leave: ', newLeave);
  console.log('Overlapping: ', overlappingLeaves);
  
  if (!overlappingLeaves.length) {
    return { action: 'INSERT', message: null, leavesToInsert: [newLeave] };
  }

  const newLeavePriority = PRIORITY_LEVELS[newLeave.category] || 0;
  
  // Clone the new leave for potential modifications
  const newLeaveStart = new Date(newLeave.start_time);
  const newLeaveEnd = new Date(newLeave.end_time);
  
  // Handle FDL priority differently - it always replaces other leaves completely
  if (newLeave.category === 'FDL') {
    // Delete all overlapping leaves
    for (const existingLeave of overlappingLeaves) {
      await Message.deleteOne({ _id: existingLeave._id });
    }
    
    return {
      action: 'INSERT',
      message: `Replaced ${overlappingLeaves.length} conflicting leave(s) with ${newLeave.category}`,
      leavesToInsert: [newLeave]
    };
  }
  
  // Sort overlapping leaves by priority (highest first)
  const sortedOverlappingLeaves = [...overlappingLeaves].sort((a, b) => 
    (PRIORITY_LEVELS[b.category] || 0) - (PRIORITY_LEVELS[a.category] || 0)
  );
  
  // Check if any existing leave has higher priority
  const higherPriorityLeaves = sortedOverlappingLeaves.filter(leave => 
    (PRIORITY_LEVELS[leave.category] || 0) > newLeavePriority
  );

  if (higherPriorityLeaves.length > 0) {
    // Generate potential time segments for the new leave by cutting out higher priority leaves
    const timeSegments = generateNonOverlappingSegments(
      newLeaveStart, 
      newLeaveEnd, 
      higherPriorityLeaves
    );
    
    if (timeSegments.length === 0) {
      // New leave is completely covered by higher priority leaves
      const highestPriorityLeave = higherPriorityLeaves[0];
      return {
        action: 'REJECT',
        message: `Cannot add ${newLeave.category} as it conflicts with an existing ${highestPriorityLeave.category} (${formatDate(highestPriorityLeave.start_time)} to ${formatDate(highestPriorityLeave.end_time)})`,
        leavesToInsert: []
      };
    } else {
      // Create leaves for each non-overlapping segment
      const segmentedLeaves = timeSegments.map(segment => ({
        ...newLeave,
        start_time: segment.start,
        end_time: segment.end,
        duration: calculateDuration(segment.start, segment.end)
      }));
      
      // Only insert if there are valid segments with substantial duration (e.g., > 30 min)
      const validSegments = segmentedLeaves.filter(leave => {
        const durationMinutes = (new Date(leave.end_time) - new Date(leave.start_time)) / (1000 * 60);
        return durationMinutes >= 30; // Minimum 30 minutes duration
      });
      
      if (validSegments.length === 0) {
        return {
          action: 'REJECT',
          message: `Cannot add ${newLeave.category} as the remaining time slots after accounting for higher priority leaves are too short (less than 30 minutes)`,
          leavesToInsert: []
        };
      }
      
      return {
        action: 'INSERT_SEGMENTED',
        message: `Added ${newLeave.category} in ${validSegments.length} time slot(s) around existing higher priority leaves`,
        leavesToInsert: validSegments
      };
    }
  }

  // If we reach here, the new leave has higher or equal priority to all overlapping leaves
  
  // Identify leaves that need to be modified or removed
  const lowerOrEqualPriorityLeaves = sortedOverlappingLeaves.filter(leave => 
    (PRIORITY_LEVELS[leave.category] || 0) <= newLeavePriority
  );

  // Create a list to track all leaves after processing
  const leavesToInsert = []; 
  const leavesToDelete = [];
  const modificationMessages = [];
  
  // First, handle equal priority leaves
  const equalPriorityLeaves = lowerOrEqualPriorityLeaves.filter(leave => 
    (PRIORITY_LEVELS[leave.category] || 0) === newLeavePriority
  );
  
  if (equalPriorityLeaves.length > 0) {
    // For equal priority, use the most recent leave for overlapping parts
    // We'll assume the new leave is the most recent (as it's being processed now)
    
    // Mark all equal priority leaves for deletion
    for (const leave of equalPriorityLeaves) {
      leavesToDelete.push(leave._id);
    }
    
    modificationMessages.push(`Replaced ${equalPriorityLeaves.length} equal-priority leave(s) with new ${newLeave.category}`);
  }
  
  // Handle lower priority leaves
  const lowerPriorityLeaves = lowerOrEqualPriorityLeaves.filter(leave => 
    (PRIORITY_LEVELS[leave.category] || 0) < newLeavePriority
  );
  
  if (lowerPriorityLeaves.length > 0) {
    // Group leaves by category for clear reporting
    const categoryCounts = {};
    
    for (const leave of lowerPriorityLeaves) {
      const leaveStart = new Date(leave.start_time);
      const leaveEnd = new Date(leave.end_time);
      
      // Check for complete overlap - if completely overlapped, delete existing leave
      if (newLeaveStart <= leaveStart && newLeaveEnd >= leaveEnd) {
        leavesToDelete.push(leave._id);
        categoryCounts[leave.category] = (categoryCounts[leave.category] || 0) + 1;
      } 
      // Check for partial overlap at the beginning
      else if (newLeaveStart <= leaveStart && newLeaveEnd > leaveStart && newLeaveEnd < leaveEnd) {
        // Create a modified leave for the non-overlapping part
        const modifiedLeave = {
          ...leave,
          _id: undefined, // Will get new ID when inserted
          start_time: new Date(newLeaveEnd),
          end_time: leaveEnd,
          duration: calculateDuration(new Date(newLeaveEnd), leaveEnd)
        };
        
        const durationMinutes = (leaveEnd - new Date(newLeaveEnd)) / (1000 * 60);
        if (durationMinutes >= 30) { // Only keep if remaining segment is at least 30 minutes
          leavesToInsert.push(modifiedLeave);
        }
        
        leavesToDelete.push(leave._id);
        categoryCounts[leave.category] = (categoryCounts[leave.category] || 0) + 1;
      } 
      // Check for partial overlap at the end
      else if (newLeaveStart > leaveStart && newLeaveStart < leaveEnd && newLeaveEnd >= leaveEnd) {
        // Create a modified leave for the non-overlapping part
        const modifiedLeave = {
          ...leave,
          _id: undefined, // Will get new ID when inserted
          start_time: leaveStart,
          end_time: new Date(newLeaveStart),
          duration: calculateDuration(leaveStart, new Date(newLeaveStart))
        };
        
        const durationMinutes = (new Date(newLeaveStart) - leaveStart) / (1000 * 60);
        if (durationMinutes >= 30) { // Only keep if remaining segment is at least 30 minutes
          leavesToInsert.push(modifiedLeave);
        }
        
        leavesToDelete.push(leave._id);
        categoryCounts[leave.category] = (categoryCounts[leave.category] || 0) + 1;
      }
      // Check for complete enclosure (new leave is inside existing leave)
      else if (newLeaveStart > leaveStart && newLeaveEnd < leaveEnd) {
        // Create two modified leaves for the non-overlapping parts
        const modifiedLeave1 = {
          ...leave,
          _id: undefined, // Will get new ID when inserted
          start_time: leaveStart,
          end_time: new Date(newLeaveStart),
          duration: calculateDuration(leaveStart, new Date(newLeaveStart))
        };
        
        const modifiedLeave2 = {
          ...leave,
          _id: undefined, // Will get new ID when inserted
          start_time: new Date(newLeaveEnd),
          end_time: leaveEnd,
          duration: calculateDuration(new Date(newLeaveEnd), leaveEnd)
        };
        
        const durationMinutes1 = (new Date(newLeaveStart) - leaveStart) / (1000 * 60);
        if (durationMinutes1 >= 30) { // Only keep if remaining segment is at least 30 minutes
          leavesToInsert.push(modifiedLeave1);
        }
        
        const durationMinutes2 = (leaveEnd - new Date(newLeaveEnd)) / (1000 * 60);
        if (durationMinutes2 >= 30) { // Only keep if remaining segment is at least 30 minutes
          leavesToInsert.push(modifiedLeave2);
        }
        
        leavesToDelete.push(leave._id);
        categoryCounts[leave.category] = (categoryCounts[leave.category] || 0) + 1;
      }
    }
    
    // Create a message about modifications
    const categoryMessages = Object.entries(categoryCounts)
      .map(([category, count]) => `${count} ${category}${count > 1 ? 's' : ''}`)
      .join(', ');
    
    if (categoryMessages) {
      modificationMessages.push(`Modified or replaced: ${categoryMessages}`);
    }
  }
  
  // Finally, add the new leave
  leavesToInsert.push(newLeave);
  
  // Perform database operations
  // Delete all leaves marked for deletion
  for (const leaveId of leavesToDelete) {
    await Message.deleteOne({ _id: leaveId });
  }
  
  return {
    action: 'INSERT_MULTIPLE',
    message: modificationMessages.length > 0 ? modificationMessages.join('. ') : null,
    leavesToInsert
  };
}

/**
 * Generate non-overlapping time segments by cutting out higher priority leaves
 * @param {Date} startTime - Original start time
 * @param {Date} endTime - Original end time
 * @param {Array} priorityLeaves - Leaves with higher priority to cut out
 * @returns {Array} - Array of valid time segments
 */
function generateNonOverlappingSegments(startTime, endTime, priorityLeaves) {
  // Initialize with the original time segment
  let segments = [{ start: startTime, end: endTime }];
  
  // For each higher priority leave, split existing segments if they overlap
  for (const leave of priorityLeaves) {
    const leaveStart = new Date(leave.start_time);
    const leaveEnd = new Date(leave.end_time);
    
    const newSegments = [];
    
    for (const segment of segments) {
      // Check if this segment overlaps with the leave
      if (leaveStart <= segment.end && leaveEnd >= segment.start) {
        // There's an overlap - split the segment
        
        // Add segment before the leave if it exists
        if (segment.start < leaveStart) {
          newSegments.push({
            start: segment.start,
            end: leaveStart
          });
        }
        
        // Add segment after the leave if it exists
        if (segment.end > leaveEnd) {
          newSegments.push({
            start: leaveEnd,
            end: segment.end
          });
        }
      } else {
        // No overlap, keep this segment as is
        newSegments.push(segment);
      }
    }
    
    segments = newSegments;
  }
  
  return segments;
}

/**
 * Checks if a leave spans a full workday
 * @param {Date} start - Start time
 * @param {Date} end - End time
 * @returns {boolean} - Whether this is a full workday leave
 */
function isFullWorkDay(start, end) {
  const startHour = start.getHours();
  const endHour = end.getHours();
  const endMinutes = end.getMinutes();
  
  // Check if the leave covers standard work hours (e.g., 9 AM to 6 PM)
  // Adjust as needed for your company's work hours
  return startHour <= 9 && (endHour > 17 || (endHour === 17 && endMinutes > 0));
}

/**
 * Get a summary of all leaves for a user on a specific date
 * @param {string} userId - User ID
 * @param {Date} date - Date to check
 * @returns {Promise<Array>} - Array of leave entries
 */
async function getLeavesForDate(userId, date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  
  return await Message.find({
    user: userId,
    $or: [
      {
        start_time: { $gte: startOfDay, $lte: endOfDay }
      },
      {
        end_time: { $gte: startOfDay, $lte: endOfDay }
      },
      {
        start_time: { $lte: startOfDay },
        end_time: { $gte: endOfDay }
      }
    ]
  }).sort({ start_time: 1 });
}

/**
 * Check if two leave types are mutually exclusive
 * For example, you can't have both HDL and FDL on the same day
 * @param {string} category1 - First leave category
 * @param {string} category2 - Second leave category
 * @returns {boolean} - Whether the leave types are mutually exclusive
 */
function areMutuallyExclusive(category1, category2) {
  // Define pairs of leave types that can't coexist
  const exclusivePairs = [
    ['FDL', 'HDL'],
    ['FDL', 'LTO'],
    ['FDL', 'LE'],
    ['FDL', 'WFH'],
    ['FDL', 'OOO'],
    ['HDL', 'WFH'],
    ['HDL', 'OOO'], // Added: Half day leave is incompatible with OOO
    ['HDL', 'HDL']  // Added: Can't have two half-day leaves
    // Add more pairs as needed
  ];
  
  return exclusivePairs.some(pair => 
    (pair[0] === category1 && pair[1] === category2) || 
    (pair[0] === category2 && pair[1] === category1)
  );
}

/**
 * Validate a leave entry against business rules
 * @param {Object} leave - Leave entry to validate
 * @returns {Object} - Validation result with isValid and message
 */
async function validateLeaveAgainstRules(leave) {
  // Ensure minimum duration of 30 minutes
  const durationMinutes = (new Date(leave.end_time) - new Date(leave.start_time)) / (1000 * 60);
  if (durationMinutes < 30) {
    return {
      isValid: false,
      message: `Leaves must be at least 30 minutes long. Your leave is ${durationMinutes} minutes.`
    };
  }
  
  // Validate start time is before end time
  if (new Date(leave.start_time) >= new Date(leave.end_time)) {
    return {
      isValid: false,
      message: `Start time must be before end time.`
    };
  }
  
  // FDL should be a full workday (9 AM to 6 PM)
  if (leave.category === 'FDL') {
    const startTime = new Date(leave.start_time);
    const endTime = new Date(leave.end_time);
    
    // Check if the times approximate a full work day
    // Allow a bit of flexibility (within 30 minutes of standard times)
    const startHour = startTime.getHours();
    const startMinutes = startTime.getMinutes();
    const endHour = endTime.getHours();
    const endMinutes = endTime.getMinutes();
    
    const standardStartTime = 9; // 9 AM
    const standardEndTime = 18; // 6 PM
    
    const startTimeInMinutes = startHour * 60 + startMinutes;
    const endTimeInMinutes = endHour * 60 + endMinutes;
    const standardStartInMinutes = standardStartTime * 60;
    const standardEndInMinutes = standardEndTime * 60;
    
    if (Math.abs(startTimeInMinutes - standardStartInMinutes) > 30 || 
        Math.abs(endTimeInMinutes - standardEndInMinutes) > 30) {
      return {
        isValid: false,
        message: `Full Day Leave (FDL) should approximately cover standard working hours (9 AM to 6 PM).`
      };
    }
  }
  
  // HDL should be approximately half a workday (~4 hours)
  if (leave.category === 'HDL') {
    const durationHours = durationMinutes / 60;
    if (durationHours < 3.5 || durationHours > 5) {
      return {
        isValid: false,
        message: `Half Day Leave (HDL) should be approximately 4 hours (between 3.5 and 5 hours).`
      };
    }
  }
  
  // LTO (Late to Office) should start at or after 9 AM
  if (leave.category === 'LTO') {
    const startTime = new Date(leave.start_time);
    const startHour = startTime.getHours();
    const startMinutes = startTime.getMinutes();
    
    if (startHour < 9 || (startHour === 9 && startMinutes < 0)) {
      return {
        isValid: false,
        message: `Late to Office (LTO) should start at or after 9 AM.`
      };
    }
  }
  
  // LE (Leaving Early) should end at or before 6 PM
  if (leave.category === 'LE') {
    const endTime = new Date(leave.end_time);
    const endHour = endTime.getHours();
    const endMinutes = endTime.getMinutes();
    
    if (endHour > 18 || (endHour === 18 && endMinutes > 0)) {
      return {
        isValid: false,
        message: `Leaving Early (LE) should end at or before 6 PM.`
      };
    }
  }
  
  // Check day-based rules with existing leaves
  const leaveDate = new Date(leave.start_time);
  const existingLeaves = await getLeavesForDate(leave.user, leaveDate);
  
  // Check if there's already a FDL on this day
  const existingFDL = existingLeaves.find(l => l.category === 'FDL');
  if (existingFDL && leave.category !== 'FDL') {
    return {
      isValid: false,
      message: `Cannot add ${leave.category} as you already have a Full Day Leave on ${formatDate(existingFDL.start_time)}`
    };
  }
  
  // Check for mutually exclusive leave types
  if (leave.category !== 'FDL') { // FDL overrides everything
    const conflictingLeaves = existingLeaves.filter(l => 
      areMutuallyExclusive(leave.category, l.category) && 
      l._id.toString() !== (leave._id ? leave._id.toString() : '')
    );
    
    if (conflictingLeaves.length > 0) {
      return {
        isValid: false,
        message: `Cannot add ${leave.category} as you already have ${conflictingLeaves[0].category} on this day which is mutually exclusive`
      };
    }
  }
  
  return { isValid: true, message: null };
}

// PRIORITY LEAVES ENDS

// Listen for messages and save them to MongoDB
app.event("message", async ({ event, say }) => {
  try {
    if (!event.subtype) {
      // Regular new message flow - unchanged
      console.log(`📩 Message from ${event.user}: ${event.text}`);
      const userInput = event.text.trim();
      
      const res = await chatWithGeminiCategory(userInput);
      const username = await getUserName(event.user);
      const channelname = await getChannelName(event.channel);

      // Add user and channel info to each response object
      res.forEach((obj) => {
        obj.user = event.user;
        obj.channel = event.channel;
        obj.username = username;
        obj.channelname = channelname;
        obj.original = userInput;
        obj.time = new Date();
      });

      // Process valid responses
      for (const obj of res) {
        if (obj["is_valid"] && obj.category !== 'UNKNOWN') {
          // First run business rule validation
          const validationResult = await validateLeaveAgainstRules(obj);
          if (!validationResult.isValid) {
            say(`*Unable to register leave*\n${validationResult.message}`);
            continue;
          }
          
          const startDateString = formatDate(obj.start_time);
          const endDateString = formatDate(obj.end_time);
          
          // Find any overlapping leaves
          const overlappingLeaves = await findOverlappingLeaves(obj);
          
          // Handle overlap based on enhanced priority rules
          const overlapResult = await handleOverlappingLeaves(obj, overlappingLeaves);
          
          // Take action based on the result
          if (overlapResult.action === 'INSERT' || overlapResult.action === 'INSERT_MULTIPLE' || overlapResult.action === 'INSERT_SEGMENTED') {
            let notificationMessage = '';
            const insertedLeaveIds = [];
            
            // Insert all leaves from the result
            for (const leaveToInsert of overlapResult.leavesToInsert) {
              const leave = await Message.insertOne(leaveToInsert);
              insertedLeaveIds.push(leave._id);
              
              // If this is the first/main leave or there's only one leave, create the main notification
              if (insertedLeaveIds.length === 1 || overlapResult.leavesToInsert.length === 1) {
                const leaveStartString = formatDate(leaveToInsert.start_time);
                const leaveEndString = formatDate(leaveToInsert.end_time);
                
                notificationMessage = `*Leave Notification*\n👨‍💻 *Name:* ${leaveToInsert.username}\n📅 *From:* ${leaveStartString}\n📅 *To:* ${leaveEndString}\n⏳ *duration:* ${leaveToInsert.duration}\n${categoryEmoji[leaveToInsert.category].emoji} *Type:* ${leaveToInsert.category} (${categoryEmoji[leaveToInsert.category].full})\n📝 *Reason:* ${leaveToInsert.reason || "Not specified"}\n🪪 *LeaveId:* ${leave._id}`;
              }
            }
            
            // If there are multiple leaves inserted (due to segmentation), add that info
            if (overlapResult.leavesToInsert.length > 1) {
              const additionalLeaves = overlapResult.leavesToInsert.slice(1); // Skip the first one we already reported
              
              notificationMessage += "\n\n*Additional time segments created:*";
              for (let i = 0; i < additionalLeaves.length; i++) {
                const addLeave = additionalLeaves[i];
                notificationMessage += `\n${i+1}. ${formatDate(addLeave.start_time)} to ${formatDate(addLeave.end_time)} (${addLeave.duration}) - ${addLeave.category}`;
              }
            }
            
            // Add information about replacements or modifications if applicable
            if (overlapResult.message) {
              notificationMessage += `\n\n*Note:* ${overlapResult.message}`;
            }
            
            say(notificationMessage);
          } else if (overlapResult.action === 'REJECT') {
            // Notify about rejection due to higher priority existing leave
            say(`*Unable to register leave*\n${overlapResult.message}`);
          }
        } else if (obj.errMessage && obj.errMessage.length) {
          say(obj.errMessage);
        }
      }
    }
    else if (event.subtype === "message_changed") {
      const oldMessage = event.previous_message.text.trim();
      const newMessage = event.message.text.trim();
      const userId = event.message.user;
      const channelId = event.channel;
      const now = new Date();
      
      // Process the edited message
      const newLeaveRequests = await chatWithGeminiCategory(newMessage);
      const username = await getUserName(userId);
      const channelname = await getChannelName(channelId);
      
      // Add user and channel info to each new leave request
      newLeaveRequests.forEach((obj) => {
        obj.user = userId;
        obj.channel = channelId;
        obj.username = username;
        obj.channelname = channelname;
        // obj.original = newMessage;
        // obj.time = now;
      });
      
      // Find leaves associated with the original message
      const existingLeaves = await Message.find({ 
        user: userId, 
        original: oldMessage 
      });
      
      // Split existing leaves into past and current/future leaves
      const pastLeaves = existingLeaves.filter(leave => leave.end_time < now);
      const currentOrFutureLeaves = existingLeaves.filter(leave => leave.end_time >= now);
      
      // Handle cancellation requests - but NEVER delete past leaves
      if (newMessage.toLowerCase().includes("cancel") || newMessage.trim() === "") {
        if (pastLeaves.length > 0) {
          say(`Cannot cancel ${pastLeaves.length} past leave record(s) as they have already ended.`);
        }
        
        for (const leave of currentOrFutureLeaves) {
          await Message.deleteOne({ _id: leave._id });
        }
        
        if (currentOrFutureLeaves.length > 0) {
          say(`${currentOrFutureLeaves.length} current/future leave record(s) cancelled for ${username}.`);
        }
        return;
      }
      
      // Check for valid leave requests in the edited message
      const validNewRequests = newLeaveRequests.filter(req => 
        req.is_valid && req.category !== 'UNKNOWN'
      );
      
      // If no valid new leave requests, and there were existing current/future leaves, assume cancellation
      if (validNewRequests.length === 0 && currentOrFutureLeaves.length > 0) {
        for (const leave of currentOrFutureLeaves) {
          await Message.deleteOne({ _id: leave._id });
        }
        say(`Previous current/future leave record(s) have been removed as the new message doesn't contain valid leave information.`);
        
        if (pastLeaves.length > 0) {
          say(`Note: ${pastLeaves.length} past leave record(s) have been preserved in the system.`);
        }
        return;
      }
      
      // Notify about past leaves that can't be modified
      if (pastLeaves.length > 0) {
        const pastLeaveInfo = pastLeaves.map(leave => 
          `• ${leave.category} (${formatDate(leave.start_time)} to ${formatDate(leave.end_time)})`
        ).join('\n');
        
        say(`The following past leave record(s) cannot be modified as they have already ended:\n${pastLeaveInfo}`);
      }
      
      // Process each current/future leave
      for (const existingLeave of currentOrFutureLeaves) {
        // Try to find a matching leave in the new requests (same category)
        const matchingNewRequest = validNewRequests.find(req => 
          req.category === existingLeave.category
        );
        
        if (matchingNewRequest) {
          // Apply category-specific update logic
          let updatedLeave = handleCategorySpecificUpdate(existingLeave, matchingNewRequest, new Date());
          
          // Update the existing leave with new details
          await Message.updateOne(
            { _id: existingLeave._id }, 
            { $set: updatedLeave }
          );
          
          const startDateString = formatDate(updatedLeave.start_time);
          const endDateString = formatDate(updatedLeave.end_time);
          console.log('category:', updatedLeave.category);
          say(
            `*Leave Updated*\n👨‍💻 *Name:* ${username}\n📅 *From:* ${startDateString}\n📅 *To:* ${endDateString}\n⏳ *duration:* ${updatedLeave.duration}\n${categoryEmoji[updatedLeave.category].emoji} *Type:* ${updatedLeave.category} (${categoryEmoji[updatedLeave.category].full})\n📝 *Reason:* ${updatedLeave.reason || "Not specified"}\n🪪 *LeaveId:* ${existingLeave._id}`
          );
          
          // Remove the processed request from validNewRequests
          const index = validNewRequests.indexOf(matchingNewRequest);
          if (index > -1) {
            validNewRequests.splice(index, 1);
          }
        } else {
          // No matching category found in new requests, delete this leave (since it's not past)
          await Message.deleteOne({ _id: existingLeave._id });
          say(`Previous ${existingLeave.category} leave has been removed.`);
        }
      }
      
      // Process any remaining new leave requests that didn't match existing ones
      for (const newRequest of validNewRequests) {
        const startDateString = formatDate(newRequest.start_time);
        const endDateString = formatDate(newRequest.end_time);
        
        // Insert as a new leave
        const leave = await Message.insertOne(newRequest);
        say(
          `*New Leave Added*\n👨‍💻 *Name:* ${username}\n📅 *From:* ${startDateString}\n📅 *To:* ${endDateString}\n⏳ *duration:* ${newRequest.duration}\n${categoryEmoji[newRequest.category].emoji} *Type:* ${newRequest.category} (${categoryEmoji[newRequest.category].full})\n📝 *Reason:* ${newRequest.reason || "Not specified"}\n🪪 *LeaveId:* ${leave._id}`
        );
      }
    }
  } catch (error) {
    console.error("❌ Error handling message:", error);
  }
});

/**
 * Handles category-specific update logic for different types of leaves
 * 
 * @param {Object} existingLeave - The existing leave record in the database
 * @param {Object} newRequest - The new leave request from the edited message
 * @param {Date} now - The current date/time
 * @returns {Object} The updated leave object to be saved
 */
function handleCategorySpecificUpdate(existingLeave, newRequest, now) {
  // Create a copy of the existing leave to modify
  
  const updatedLeave = { ...existingLeave._doc };
  console.log('updated Leave1', updatedLeave);

  // updatedLeave.reason = existingLeave.reason;

  
  // Update common fields regardless of category
  updatedLeave.reason = newRequest.reason;
  updatedLeave.original = newRequest.original;
  updatedLeave.time = now;
  
  switch (existingLeave.category) {
    case "OOO": // Out of Office - short duration absence
    case "LTO": // Late to Office
    case "LE":  // Leaving Early
    case "AFK": // Away From Keyboard
      // For short-duration leaves, if already started, preserve start time and only modify end time
      if (existingLeave.start_time < now) {
        updatedLeave.end_time = newRequest.end_time;
        // Recalculate duration based on preserved start time and new end time
        updatedLeave.duration = calculateDuration(existingLeave.start_time, newRequest.end_time);
      } else {
        // If not started yet, can update both start and end times
        updatedLeave.start_time = newRequest.start_time;
        updatedLeave.end_time = newRequest.end_time;
        updatedLeave.duration = newRequest.duration;
      }
      break;
      
    case "FDL": // Full Day Leave
    case "HDL": // Half Day Leave
    case "WFH": // Work From Home
      // For day-based leaves, allow full replacement of dates
      // These typically represent full calendar days and should be updated as a unit
      updatedLeave.start_time = newRequest.start_time;
      updatedLeave.end_time = newRequest.end_time;
      updatedLeave.duration = newRequest.duration;
      
      // Exception: If a day-based leave has already started and continues to future
      if (existingLeave.start_time < now && existingLeave.end_time > now) {
        // Special case: If user is modifying a multi-day leave that's in progress
        const existingStartDay = new Date(existingLeave.start_time).setHours(0, 0, 0, 0);
        const newStartDay = new Date(newRequest.start_time).setHours(0, 0, 0, 0);
        
        // If the user is trying to change the start date of an in-progress leave
        if (existingStartDay !== newStartDay) {
          // Keep the original start date since it's already in progress
          updatedLeave.start_time = existingLeave.start_time;
          // But allow the end date to be modified
          updatedLeave.end_time = newRequest.end_time;
          // Recalculate duration
          updatedLeave.duration = calculateDuration(existingLeave.start_time, newRequest.end_time);
        }
      }
      break;
      
    default:
      // For any other category, allow full replacement
      updatedLeave.start_time = newRequest.start_time;
      updatedLeave.end_time = newRequest.end_time;
      updatedLeave.duration = newRequest.duration;
  }
  
  console.log('updated Leave2', updatedLeave);
  return updatedLeave;
}

/**
 * Calculates a human-readable duration between two dates
 * 
 * @param {Date} startTime - The start time
 * @param {Date} endTime - The end time
 * @returns {String} Human-readable duration
 */
function calculateDuration(startTime, endTime) {
  const durationMs = endTime - startTime;
  const durationMinutes = Math.round(durationMs / (1000 * 60));
  
  if (durationMinutes < 60) {
    return `${durationMinutes} minute${durationMinutes !== 1 ? 's' : ''}`;
  }
  
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  
  // Calculate days for longer durations
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  
  if (days > 0) {
    if (remainingHours === 0 && minutes === 0) {
      return `${days} day${days !== 1 ? 's' : ''}`;
    } else if (minutes === 0) {
      return `${days} day${days !== 1 ? 's' : ''} ${remainingHours} hour${remainingHours !== 1 ? 's' : ''}`;
    } else {
      return `${days} day${days !== 1 ? 's' : ''} ${remainingHours} hour${remainingHours !== 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
  }
  
  if (minutes === 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  
  return `${hours} hour${hours !== 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`;
}

// Helper function for date formatting
function formatDate(date) {
  return new Date(date).toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}


async function queryHandler({ command, ack, respond }) {
  try {
    await ack(); // Acknowledge the command request

    const queryText = command.text.trim();
    if (!queryText) {
      await respond(
        "Please provide a query. Example: `/query show all leaves for John`"
      );
      return;
    }

    // Generate a MongoDB Query using OpenAI
    await respond(queryText);

    const mongoQuery = await chatWithGeminiQuery(queryText);
    console.log("MongoDB Query:", mongoQuery);
    const mongoResponse = await executeMongooseQueryEval(mongoQuery);
    console.log("MongoDB Response:", mongoResponse);
    const finalResponse = await chatWithgeminiResponse(
      `MongoDB Query: ${mongoQuery}\n\nMongoDB Response: ${JSON.stringify(
        mongoResponse
      )}`
    );
    console.log("Final Response:", finalResponse);
    // const results = await executeQuery(structuredQuery);

    if (finalResponse?.length === 0) {
      await respond("No records found.");
    } else {
      await respond(finalResponse);
    }
  } catch (error) {
    console.error("❌ Error handling /query command:", error);
    await respond("An error occurred while processing your query.");
  }
}

async function handleCancel({ command, ack, respond, client }) {
  try {
    await ack(); // Acknowledge the command request

    const queryText = command.text.trim();
    if (!queryText) {
      await respond(
        "Please provide a leaveId. Example: `/cancelleave leaveId`"
      );
      return;
    }

    // Generate a MongoDB Query using OpenAI
    const userId = command.user_id; // Slack User ID
    const username = command.user_name;
    const name = await getUserName(userId);

    const res = await Message.findById('67daa74080e6b8e91288a5e8');
    console.log(res)

    console.log(`id:${queryText.trim()}`);
    const leave = await Message.findById(queryText);
    console.log(leave);
    if(!leave){
      await respond(`Please provide valid leave id`);
      return;
    }
    if(leave.user !== userId){
      await respond(`You don't have permission to cancel this leave.`);
      return;
    }

    if(leave.start_time.getTime() < now.getTime()){
      await respond(`You can't cancel past leaves`);
      return;
    }
    
    await Message.deleteOne({ _id: queryText });

    await client.chat.postMessage({
      channel: "#bot-testing", // Replace with the desired channel
      text: `⛔️ <@${userId}> *cancelled following leave.*⛔️\n\n${leaveResponse(leave,'v2')}\n\nThe leave has been cancelled ✅`,
    });  
    
  } catch (error) {
    console.error("❌ Error handling /cancelleave command:", error);
    await respond("An error occurred while processing your query.");
  }
}

// Add this to your Slack app setup
app.command('/leaves', async ({ command, ack, respond }) => {
  await ack();
  
  // Parse the date from the command text or use today
  let targetDate;
  try {
    targetDate = command.text ? new Date(command.text) : new Date();
    // Check if date is valid
    if (isNaN(targetDate.getTime())) {
      targetDate = new Date(); // Default to today if invalid
    }
  } catch (e) {
    targetDate = new Date();
  }
  
  const userId = command.user_id;
  const username = await getUserName(userId);
  
  // Get all leaves for this user on the date
  const leaves = await getLeavesForDate(userId, targetDate);
  
  if (leaves.length === 0) {
    respond(`No leaves found for ${username} on ${formatDate(targetDate)}`);
    return;
  }
  
  // Sort leaves by priority and time
  leaves.sort((a, b) => {
    // First by priority (high to low)
    const priorityDiff = (PRIORITY_LEVELS[b.category] || 0) - (PRIORITY_LEVELS[a.category] || 0);
    if (priorityDiff !== 0) return priorityDiff;
    
    // Then by start time
    return new Date(a.start_time) - new Date(b.start_time);
  });
  
  // Build the response message
  let responseText = `*Leaves for ${username} on ${formatDate(targetDate)}*\n\n`;
  
  leaves.forEach((leave, index) => {
    const startTime = formatTime(new Date(leave.start_time));
    const endTime = formatTime(new Date(leave.end_time));
    
    responseText += `${index + 1}. ${categoryEmoji[leave.category].emoji} *${leave.category}* (${startTime} - ${endTime})\n`;
    if (leave.reason) {
      responseText += `   Reason: ${leave.reason}\n`;
    }
    responseText += `   ID: ${leave._id}\n\n`;
  });
  
  respond(responseText);
});

// Helper function to format time
function formatTime(date) {
  return date.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: true 
  });
}

app.command("/latequery", queryHandler);
app.command("/query", queryHandler);
app.command('/cancelleave', handleCancel)

module.exports = app;
