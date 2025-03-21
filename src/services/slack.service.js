const { App } = require("@slack/bolt");
const Message = require("../models/message.model");
const env = require("../config/env");
const { chatWithGeminiCategory, chatWithGeminiQuery, chatWithgeminiResponse, callGeminiAPI } = require("./gemini.service");
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
  if (!overlappingLeaves.length) {
    return { action: 'INSERT', message: null };
  }

  const newLeavePriority = PRIORITY_LEVELS[newLeave.category] || 0;
  
  // Check if any existing leave has higher priority
  const higherPriorityLeaves = overlappingLeaves.filter(leave => 
    (PRIORITY_LEVELS[leave.category] || 0) > newLeavePriority
  );

  if (higherPriorityLeaves.length > 0) {
    // Sort by priority to get the highest priority existing leave
    higherPriorityLeaves.sort((a, b) => 
      (PRIORITY_LEVELS[b.category] || 0) - (PRIORITY_LEVELS[a.category] || 0)
    );
    
    const highestPriorityLeave = higherPriorityLeaves[0];
    return {
      action: 'REJECT',
      message: `Cannot add ${newLeave.category} as it conflicts with an existing ${highestPriorityLeave.category} (${formatDate(highestPriorityLeave.start_time)} to ${formatDate(highestPriorityLeave.end_time)})`
    };
  }

  // If new leave has higher or equal priority
  // Get existing leaves that need to be removed or updated
  const lowerOrEqualPriorityLeaves = overlappingLeaves.filter(leave => 
    (PRIORITY_LEVELS[leave.category] || 0) <= newLeavePriority
  );

  if (lowerOrEqualPriorityLeaves.length > 0) {
    // For each overlapping leave, decide what to do
    for (const existingLeave of lowerOrEqualPriorityLeaves) {
      // If same category and exact same time, just update
      if (existingLeave.category === newLeave.category && 
          existingLeave.start_time.getTime() === new Date(newLeave.start_time).getTime() && 
          existingLeave.end_time.getTime() === new Date(newLeave.end_time).getTime()) {
        await Message.updateOne({ _id: existingLeave._id }, { $set: newLeave });
      } else {
        // If completely overlapping, remove the existing leave
        await Message.deleteOne({ _id: existingLeave._id });
      }
    }
    
    return {
      action: 'INSERT',
      message: `Replaced ${lowerOrEqualPriorityLeaves.length} conflicting leave(s) with ${newLeave.category}`
    };
  }

  // This shouldn't happen based on our logic, but just in case
  return { action: 'INSERT', message: null };
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
  // Check if there's a FDL already on this day
  const existingLeaves = await getLeavesForDate(leave.user, new Date(leave.start_time));
  
  // Check if there's already a FDL
  const existingFDL = existingLeaves.find(l => l.category === 'FDL');
  if (existingFDL && leave.category !== 'FDL') {
    return {
      isValid: false,
      message: `Cannot add ${leave.category} as you already have a Full Day Leave on ${formatDate(existingFDL.start_time)}`
    };
  }
  
  // Check if adding FDL when specific types already exist
  if (leave.category === 'FDL') {
    // FDL overrides everything, so this is always valid
    return { isValid: true, message: null };
  }
  
  // Check if adding HDL when not allowed
  if (leave.category === 'HDL') {
    const conflictingLeaves = existingLeaves.filter(l => 
      areMutuallyExclusive('HDL', l.category) && 
      l._id.toString() !== (leave._id ? leave._id.toString() : '')
    );
    
    if (conflictingLeaves.length > 0) {
      return {
        isValid: false,
        message: `Cannot add Half Day Leave as you already have ${conflictingLeaves[0].category} on this day`
      };
    }
  }
  
  // Additional validation rules can be added here
  
  return { isValid: true, message: null };
}

/**
 * Handles precise overlap between leave entries, splitting them if needed
 * @param {Object} newLeave - The new leave entry
 * @param {Array} overlappingLeaves - Array of existing overlapping leave entries
 * @returns {Object} - Result with actions to take and messages
 */
async function handlePreciseOverlap(newLeave, overlappingLeaves) {
  if (!overlappingLeaves.length) {
    return { 
      action: 'INSERT', 
      leavesToInsert: [newLeave],
      leavesToDelete: [],
      leavesToUpdate: [],
      message: null 
    };
  }

  const newLeavePriority = PRIORITY_LEVELS[newLeave.category] || 0;
  const newLeaveStart = new Date(newLeave.start_time);
  const newLeaveEnd = new Date(newLeave.end_time);
  
  // Results to collect
  const leavesToInsert = [];
  const leavesToDelete = [];
  const leavesToUpdate = [];
  let resultMessage = '';
  
  // Check for any higher priority leaves that completely block the new leave
  const higherPriorityFullyBlockingLeaves = overlappingLeaves.filter(leave => {
    const leavePriority = PRIORITY_LEVELS[leave.category] || 0;
    const leaveStart = new Date(leave.start_time);
    const leaveEnd = new Date(leave.end_time);
    
    return leavePriority > newLeavePriority && 
           leaveStart <= newLeaveStart && 
           leaveEnd >= newLeaveEnd;
  });
  
  if (higherPriorityFullyBlockingLeaves.length > 0) {
    // The new leave is completely blocked
    const blockingLeave = higherPriorityFullyBlockingLeaves[0];
    return {
      action: 'REJECT',
      leavesToInsert: [],
      leavesToDelete: [],
      leavesToUpdate: [],
      message: `Cannot add ${newLeave.category} as it conflicts with an existing higher priority ${blockingLeave.category} (${formatDate(blockingLeave.start_time)} to ${formatDate(blockingLeave.end_time)})`
    };
  }
  
  // First, check if this is a complete replacement (FDL replacing everything else on the day)
  if (newLeave.category === 'FDL' && isFullDayLeave(newLeave)) {
    // The new FDL will replace all existing leaves on this day
    return {
      action: 'INSERT',
      leavesToInsert: [newLeave],
      leavesToDelete: overlappingLeaves.map(leave => leave._id),
      leavesToUpdate: [],
      message: `Full Day Leave replaces ${overlappingLeaves.length} existing leave(s)`
    };
  }
  
  // Process each overlapping leave
  let canInsertNewLeave = true;
  
  // 1. Collect all time ranges that are blocked by higher priority leaves
  const blockedRanges = [];
  
  overlappingLeaves.forEach(existingLeave => {
    const existingPriority = PRIORITY_LEVELS[existingLeave.category] || 0;
    const existingStart = new Date(existingLeave.start_time);
    const existingEnd = new Date(existingLeave.end_time);
    
    if (existingPriority > newLeavePriority) {
      // This existing leave has higher priority, so it blocks that time range
      blockedRanges.push({
        start: existingStart,
        end: existingEnd
      });
    }
  });
  
  // 2. Determine what parts of the new leave can be inserted
  let availableRanges = [{
    start: new Date(newLeaveStart),
    end: new Date(newLeaveEnd)
  }];
  
  // Remove blocked ranges from available ranges
  blockedRanges.forEach(blockedRange => {
    const newAvailableRanges = [];
    
    availableRanges.forEach(availableRange => {
      // Four cases for each available range
      
      // Case 1: No overlap - blocked range is entirely before or after available range
      if (blockedRange.end <= availableRange.start || blockedRange.start >= availableRange.end) {
        newAvailableRanges.push(availableRange);
        return;
      }
      
      // Case 2: Blocked range completely covers available range
      if (blockedRange.start <= availableRange.start && blockedRange.end >= availableRange.end) {
        // This available range is completely blocked, skip it
        return;
      }
      
      // Case 3: Blocked range splits available range into two parts
      if (blockedRange.start > availableRange.start && blockedRange.end < availableRange.end) {
        newAvailableRanges.push({
          start: new Date(availableRange.start),
          end: new Date(blockedRange.start)
        });
        
        newAvailableRanges.push({
          start: new Date(blockedRange.end),
          end: new Date(availableRange.end)
        });
        return;
      }
      
      // Case 4: Blocked range covers part of available range
      if (blockedRange.start <= availableRange.start && blockedRange.end > availableRange.start) {
        // Blocked from the start
        newAvailableRanges.push({
          start: new Date(blockedRange.end),
          end: new Date(availableRange.end)
        });
      } else if (blockedRange.start < availableRange.end && blockedRange.end >= availableRange.end) {
        // Blocked at the end
        newAvailableRanges.push({
          start: new Date(availableRange.start),
          end: new Date(blockedRange.start)
        });
      }
    });
    
    availableRanges = newAvailableRanges;
  });
  
  // 3. Create new leave entries for each available range
  const MINIMUM_DURATION_MS = 15 * 60 * 1000; // 15 minutes in milliseconds
  
  availableRanges.forEach(range => {
    // Only create leaves for segments that are at least 15 minutes long
    if (range.end - range.start >= MINIMUM_DURATION_MS) {
      const segmentLeave = {
        ...newLeave,
        start_time: range.start,
        end_time: range.end,
        duration: formatDuration(range.start, range.end)
      };
      
      leavesToInsert.push(segmentLeave);
    }
  });
  
  // 4. Handle lower or equal priority leaves that need to be split or removed
  overlappingLeaves.forEach(existingLeave => {
    const existingPriority = PRIORITY_LEVELS[existingLeave.category] || 0;
    const existingStart = new Date(existingLeave.start_time);
    const existingEnd = new Date(existingLeave.end_time);
    
    if (existingPriority <= newLeavePriority) {
      // This leave may need to be adjusted
      
      // Case 1: The new leave completely covers this leave - delete it
      if (newLeaveStart <= existingStart && newLeaveEnd >= existingEnd) {
        leavesToDelete.push(existingLeave._id);
      } 
      // Case 2: The new leave overlaps at the beginning
      else if (newLeaveStart <= existingStart && newLeaveEnd > existingStart && newLeaveEnd < existingEnd) {
        const updatedExistingLeave = {
          ...existingLeave,
          start_time: new Date(newLeaveEnd),
          duration: formatDuration(newLeaveEnd, existingEnd)
        };
        
        // Only update if the remaining segment is at least 15 minutes
        if (existingEnd - newLeaveEnd >= MINIMUM_DURATION_MS) {
          leavesToUpdate.push({
            id: existingLeave._id,
            data: updatedExistingLeave
          });
        } else {
          leavesToDelete.push(existingLeave._id);
        }
      } 
      // Case 3: The new leave overlaps at the end
      else if (newLeaveStart > existingStart && newLeaveStart < existingEnd && newLeaveEnd >= existingEnd) {
        const updatedExistingLeave = {
          ...existingLeave,
          end_time: new Date(newLeaveStart),
          duration: formatDuration(existingStart, newLeaveStart)
        };
        
        // Only update if the remaining segment is at least 15 minutes
        if (newLeaveStart - existingStart >= MINIMUM_DURATION_MS) {
          leavesToUpdate.push({
            id: existingLeave._id,
            data: updatedExistingLeave
          });
        } else {
          leavesToDelete.push(existingLeave._id);
        }
      } 
      // Case 4: The new leave is in the middle of this leave - split it
      else if (newLeaveStart > existingStart && newLeaveEnd < existingEnd) {
        // Create two new leaves: before and after
        const beforeLeave = {
          ...existingLeave,
          end_time: new Date(newLeaveStart),
          duration: formatDuration(existingStart, newLeaveStart)
        };
        
        const afterLeave = {
          ...existingLeave,
          start_time: new Date(newLeaveEnd),
          duration: formatDuration(newLeaveEnd, existingEnd)
        };
        
        // Delete the original leave
        leavesToDelete.push(existingLeave._id);
        
        // Only insert segments that are at least 15 minutes
        if (newLeaveStart - existingStart >= MINIMUM_DURATION_MS) {
          leavesToInsert.push(beforeLeave);
        }
        
        if (existingEnd - newLeaveEnd >= MINIMUM_DURATION_MS) {
          leavesToInsert.push(afterLeave);
        }
      }
    }
  });
  
  // Build result message
  if (leavesToInsert.length === 0) {
    return {
      action: 'REJECT',
      leavesToInsert: [],
      leavesToDelete: [],
      leavesToUpdate: [],
      message: 'Cannot add leave as it is completely blocked by higher priority leaves'
    };
  }
  
  if (leavesToInsert.length > 1) {
    resultMessage = `Leave has been split into ${leavesToInsert.length} segments due to conflicts`;
  } else if (leavesToDelete.length > 0 || leavesToUpdate.length > 0) {
    resultMessage = `Adjusted ${leavesToDelete.length + leavesToUpdate.length} existing leave(s) to accommodate this entry`;
  }
  
  return {
    action: 'COMPLEX',
    leavesToInsert,
    leavesToDelete,
    leavesToUpdate,
    message: resultMessage
  };
}

/**
 * Check if a leave covers a full working day
 * @param {Object} leave - Leave entry
 * @returns {boolean} - Whether it's a full day leave
 */
function isFullDayLeave(leave) {
  if (leave.category !== 'FDL') return false;
  
  const start = new Date(leave.start_time);
  const end = new Date(leave.end_time);
  
  // Simple check - starts before 10 AM and ends after 5 PM
  return start.getHours() < 10 && (end.getHours() > 17 || (end.getHours() === 17 && end.getMinutes() > 0));
}

/**
 * Format duration between two dates
 * @param {Date} start - Start time
 * @param {Date} end - End time
 * @returns {string} - Formatted duration
 */
function formatDuration(start, end) {
  const durationMs = end - start;
  const hours = Math.floor(durationMs / (1000 * 60 * 60));
  const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours === 0) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  } else if (minutes === 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  } else {
    return `${hours} hour${hours !== 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }
}

/**
 * Function to consult Gemini for advice on complex leave overlap scenarios
 * @param {Object} newLeave - The new leave entry
 * @param {Array} overlappingLeaves - Existing overlapping leaves
 * @returns {Promise<Object>} - Recommended resolution
 */
async function consultGeminiForOverlapResolution(newLeave, overlappingLeaves) {
  // Only consult Gemini for complex cases
  if (overlappingLeaves.length <= 1) return null;
  
  try {
    // Format the leave information for Gemini
    const newLeaveInfo = {
      category: newLeave.category,
      start_time: formatDateTime(new Date(newLeave.start_time)),
      end_time: formatDateTime(new Date(newLeave.end_time)),
      priority: PRIORITY_LEVELS[newLeave.category] || 0
    };
    
    const existingLeavesInfo = overlappingLeaves.map(leave => ({
      id: leave._id.toString(),
      category: leave.category,
      start_time: formatDateTime(new Date(leave.start_time)),
      end_time: formatDateTime(new Date(leave.end_time)),
      priority: PRIORITY_LEVELS[leave.category] || 0
    }));
    
    // Create the prompt for Gemini
    const prompt = `
      I need help resolving a complex leave schedule overlap.
      
      PRIORITY LEVELS (higher number = higher priority):
      ${Object.entries(PRIORITY_LEVELS).map(([cat, level]) => `${cat}: ${level}`).join('\n')}
      
      NEW LEAVE REQUEST:
      ${JSON.stringify(newLeaveInfo, null, 2)}
      
      EXISTING OVERLAPPING LEAVES:
      ${JSON.stringify(existingLeavesInfo, null, 2)}
      
      Rules for resolution:
      1. Higher priority leaves take precedence over lower priority
      2. Try to preserve as much information as possible by splitting leaves
      3. Leave segments less than 15 minutes should be removed
      4. FDL (Full Day Leave) always replaces all other leaves for the entire day
      
      Please provide a JSON response with the following structure:
      {
        "action": "INSERT" or "REJECT",
        "leavesToInsert": [...] (array of leave objects with start_time and end_time),
        "leavesToDelete": [...] (array of leave IDs to delete),
        "leavesToUpdate": [...] (array of objects with id and updated data),
        "explanation": "..." (brief explanation of the resolution)
      }
    `;
    
    // Call Gemini API
    const response = await callGeminiAPI(prompt);
    
    // Parse the JSON response
    const resolution = JSON.parse(response);
    
    // Convert string dates back to Date objects
    if (resolution.leavesToInsert) {
      resolution.leavesToInsert = resolution.leavesToInsert.map(leave => ({
        ...leave,
        start_time: new Date(leave.start_time),
        end_time: new Date(leave.end_time)
      }));
    }
    
    return {
      ...resolution,
      message: resolution.explanation
    };
  } catch (error) {
    console.error("Error consulting Gemini for overlap resolution:", error);
    return null; // Fall back to standard overlap handling
  }
}

/**
 * Format date and time for Gemini
 * @param {Date} date - The date to format
 * @returns {string} - Formatted date and time
 */
function formatDateTime(date) {
  return date.toISOString();
}

// Listen for messages and save them to MongoDB
app.event("message", async ({ event, say }) => {
  try {
    if (!event.subtype) {
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
          
          // Find any overlapping leaves
          const overlappingLeaves = await findOverlappingLeaves(obj);
          
          // Attempt to use Gemini for complex overlap cases
          let overlapResult = null;
          if (overlappingLeaves.length > 1) {
            // Try to consult Gemini for complex cases first
            overlapResult = await consultGeminiForOverlapResolution(obj, overlappingLeaves);
          }
          
          // If Gemini didn't provide a result, fall back to our built-in handler
          if (!overlapResult) {
            overlapResult = await handlePreciseOverlap(obj, overlappingLeaves);
          }
          
          // Take action based on the result
          if (overlapResult.action === 'REJECT') {
            say(`*Unable to register leave*\n${overlapResult.message}`);
          } else if (overlapResult.action === 'INSERT' || overlapResult.action === 'COMPLEX') {
            // Delete leaves marked for deletion
            for (const leaveId of overlapResult.leavesToDelete) {
              await Message.deleteOne({ _id: leaveId });
            }
            
            // Update leaves marked for update
            for (const updateInfo of overlapResult.leavesToUpdate) {
              await Message.updateOne(
                { _id: updateInfo.id }, 
                { $set: updateInfo.data }
              );
            }
            
            // Insert new leaves
            const insertedLeaves = [];
            for (const leaveToInsert of overlapResult.leavesToInsert) {
              const insertedLeave = await Message.insertOne(leaveToInsert);
              insertedLeaves.push(insertedLeave);
            }
            
            // Build notification message
            let notificationMessage = '';
            
            if (insertedLeaves.length === 1) {
              // Simple case - one leave inserted
              const leave = insertedLeaves[0];
              const startDateString = formatDate(leave.start_time);
              const endDateString = formatDate(leave.end_time);
              const timeString = sameDay(leave.start_time, leave.end_time) ? 
                `${formatTime(leave.start_time)} - ${formatTime(leave.end_time)}` : 
                `${startDateString} ${formatTime(leave.start_time)} - ${endDateString} ${formatTime(leave.end_time)}`;
              
              notificationMessage = `*Leave Notification*\n👨‍💻 *Name:* ${leave.username}\n📅 *Time:* ${timeString}\n⏳ *Duration:* ${leave.duration}\n${categoryEmoji[leave.category].emoji} *Type:* ${leave.category} (${categoryEmoji[leave.category].full})\n📝 *Reason:* ${leave.reason || "Not specified"}\n🪪 *LeaveId:* ${leave._id}`;
            } else {
              // Multiple leaves inserted (split case)
              notificationMessage = `*Leave Notification*\n👨‍💻 *Name:* ${username}\n${categoryEmoji[obj.category].emoji} *Type:* ${obj.category} (${categoryEmoji[obj.category].full})\n📝 *Reason:* ${obj.reason || "Not specified"}\n\n*Leave has been split into ${insertedLeaves.length} segments:*\n`;
              
              insertedLeaves.forEach((leave, index) => {
                const timeString = `${formatTime(leave.start_time)} - ${formatTime(leave.end_time)}`;
                notificationMessage += `${index + 1}. ${timeString} (${leave.duration})\n   🪪 *LeaveId:* ${leave._id}\n`;
              });
            }
            
            // Add information about what happened with existing leaves
            if (overlapResult.message) {
              notificationMessage += `\n*Note:* ${overlapResult.message}`;
            }
            
            const totalAffected = overlapResult.leavesToDelete.length + overlapResult.leavesToUpdate.length;
            if (totalAffected > 0) {
              notificationMessage += `\n*Impact:* Modified ${totalAffected} existing leave entries`;
            }
            
            say(notificationMessage);
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

/**
 * Check if two dates are on the same day
 * @param {Date|string} date1 - First date
 * @param {Date|string} date2 - Second date
 * @returns {boolean} - Whether dates are on the same day
 */
function sameDay(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}


app.command('/leave-calendar', async ({ command, ack, respond }) => {
  await ack();
  
  // Parse the date range from the command text or use current week
  const now = new Date();
  let startDate, endDate;
  
  try {
    if (command.text) {
      // Try to parse date range like "2023-03-01 to 2023-03-07"
      const parts = command.text.split('to').map(part => part.trim());
      
      if (parts.length === 2) {
        startDate = new Date(parts[0]);
        endDate = new Date(parts[1]);
      } else {
        // Try to parse single date and show a week from there
        startDate = new Date(command.text);
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 6); // Show a week
      }
    }
    
    // Default to current week if parsing failed
    if (!startDate || isNaN(startDate.getTime())) {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - startDate.getDay()); // Start of week (Sunday)
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6); // End of week (Saturday)
    }
  } catch (e) {
    // Default to current week if any error occurs
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - startDate.getDay());
    endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);
  }
  
  const userId = command.user_id;
  const username = await getUserName(userId);
  
  // Get all leaves for the date range
  const leaves = await Message.find({
    user: userId,
    $or: [
      // Leaves that start within the range
      {
        start_time: { $gte: startDate, $lte: endDate }
      },
      // Leaves that end within the range
      {
        end_time: { $gte: startDate, $lte: endDate }
      },
      // Leaves that span the entire range
      {
        start_time: { $lte: startDate },
        end_time: { $gte: endDate }
      }
    ]
  }).sort({ start_time: 1 });
  
  if (leaves.length === 0) {
    respond(`No leaves found for ${username} from ${formatDate(startDate)} to ${formatDate(endDate)}`);
    return;
  }
  
  // Group leaves by day
  const leavesByDay = {};
  
  // Initialize days in the range
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateKey = formatDate(d);
    leavesByDay[dateKey] = [];
  }
  
  // Add leaves to their respective days
  leaves.forEach(leave => {
    const leaveStart = new Date(leave.start_time);
    const leaveEnd = new Date(leave.end_time);
    
    // For each day in the leave range
    for (let d = new Date(Math.max(leaveStart, startDate)); 
         d <= Math.min(leaveEnd, endDate); 
         d.setDate(d.getDate() + 1)) {
      
      const dateKey = formatDate(d);
      
      // Calculate display time for this segment
      let displayTime;
      
      if (sameDay(leaveStart, leaveEnd)) {
        // Simple case - leave starts and ends on the same day
        displayTime = `${formatTime(leaveStart)} - ${formatTime(leaveEnd)}`;
      } else if (sameDay(d, leaveStart)) {
        // This is the first day of a multi-day leave
        displayTime = `${formatTime(leaveStart)} - EOD`;
      } else if (sameDay(d, leaveEnd)) {
        // This is the last day of a multi-day leave
        displayTime = `SOD - ${formatTime(leaveEnd)}`;
      } else {
        // This is a middle day of a multi-day leave
        displayTime = "All Day";
      }
      
      leavesByDay[dateKey].push({
        ...leave,
        displayTime
      });
    }
  });
  
  // Build the calendar view
  let calendarText = `*Leave Calendar for ${username}*\n*${formatDate(startDate)} to ${formatDate(endDate)}*\n\n`;
  
  // Format each day
  Object.keys(leavesByDay).sort().forEach(dateKey => {
    const dayLeaves = leavesByDay[dateKey];
    
    if (dayLeaves.length === 0) {
      return; // Skip days with no leaves
    }
    
    const dateObj = new Date(dateKey);
    const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
    
    calendarText += `*${dayOfWeek}, ${dateKey}*\n`;
    
    if (dayLeaves.length === 0) {
      calendarText += "No leaves\n\n";
    } else {
      // Sort leaves by priority and time
      dayLeaves.sort((a, b) => {
        // First by priority (high to low)
        const priorityDiff = (PRIORITY_LEVELS[b.category] || 0) - (PRIORITY_LEVELS[a.category] || 0);
        if (priorityDiff !== 0) return priorityDiff;
        
        // Then by start time
        return new Date(a.start_time) - new Date(b.start_time);
      });
      
      // Display each leave
      dayLeaves.forEach(leave => {
        calendarText += `• ${categoryEmoji[leave.category].emoji} *${leave.category}*: ${leave.displayTime}`;
        if (leave.reason) {
          calendarText += ` - ${leave.reason}`;
        }
        calendarText += `\n`;
      });
      calendarText += "\n";
    }
  });
  
  respond(calendarText);
});

// Helper constants
const SOD = "Start of Day";
const EOD = "End of Day";

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

app.command("/latequery", queryHandler);
app.command("/query", queryHandler);
app.command('/cancelleave', handleCancel)

module.exports = app;
