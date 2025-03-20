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

async function checkForOverlappingLeaves(userId, startTime, endTime, newCategory) {
  // First, normalize dates by setting hours correctly based on leave type
  const normalizedDates = normalizeLeaveTimings(startTime, endTime, newCategory);
  startTime = normalizedDates.startTime;
  endTime = normalizedDates.endTime;

  // Find any leave that might overlap with the requested period
  const overlappingLeaves = await Message.find({
    user: userId,
    $or: [
      // Case 1: New leave starts during an existing leave
      { start_time: { $lte: startTime }, end_time: { $gte: startTime } },
      // Case 2: New leave ends during an existing leave
      { start_time: { $lte: endTime }, end_time: { $gte: endTime } },
      // Case 3: New leave completely contains an existing leave
      { start_time: { $gte: startTime }, end_time: { $lte: endTime } }
    ]
  });
  
  if (overlappingLeaves.length === 0) {
    return { isOverlapping: false };
  }
  
  // Check if the exact same leave exists (for updating)
  const exactDuplicate = overlappingLeaves.find(leave => 
    leave.category === newCategory && 
    leave.start_time.getTime() === startTime.getTime() && 
    leave.end_time.getTime() === endTime.getTime()
  );
  
  if (exactDuplicate) {
    return { 
      isOverlapping: true, 
      existingLeave: exactDuplicate,
      isExactDuplicate: true
    };
  }
  
  // Now handle specific conflict cases
  for (const leave of overlappingLeaves) {
    // If there's already a FDL on any day that overlaps with this request
    if (leave.category === 'FDL') {
      const fdlDate = new Date(leave.start_time);
      return { 
        isOverlapping: true, 
        message: `Cannot approve this request. You already have a Full Day Leave on ${formatDate(fdlDate)}.` 
      };
    }
    
    // If requesting FDL but already have other types of leave on that day
    if (newCategory === 'FDL') {
      return { 
        isOverlapping: true, 
        message: `Cannot approve Full Day Leave. You already have ${leave.category} scheduled from ${formatDate(leave.start_time)} to ${formatDate(leave.end_time)}.` 
      };
    }
    
    // Handle half-day leave conflicts
    if ((newCategory === 'HDL' || leave.category === 'HDL') && 
        isSameDay(new Date(startTime), new Date(leave.start_time))) {
      // Check if they're AM/PM compatible (would need additional logic to determine AM/PM)
      // For now, we'll assume any HDL on same day conflicts
      return { 
        isOverlapping: true, 
        message: `Cannot approve this Half Day Leave. You already have ${leave.category} scheduled on ${formatDate(leave.start_time)}.` 
      };
    }
    
    // Handle LTO (Late To Office) and LE (Leaving Early) conflicts
    if ((newCategory === 'LTO' || newCategory === 'LE') && 
        (leave.category === 'LTO' || leave.category === 'LE') &&
        isSameDay(new Date(startTime), new Date(leave.start_time))) {
      return { 
        isOverlapping: true, 
        message: `Cannot approve this request. You already have ${leave.category} scheduled on ${formatDate(leave.start_time)}.` 
      };
    }
    
    // WFH and OOO conflicts - they can't overlap with any other leave type
    if (newCategory === 'WFH' || newCategory === 'OOO' || 
        leave.category === 'WFH' || leave.category === 'OOO') {
      return { 
        isOverlapping: true, 
        message: `Cannot approve this request. It conflicts with your existing ${leave.category} from ${formatDate(leave.start_time)} to ${formatDate(leave.end_time)}.` 
      };
    }
  }
  
  // Generic overlap response if none of the specific cases matched
  return { 
    isOverlapping: true, 
    message: `Cannot approve this request. It overlaps with one or more of your existing leaves.` 
  };
}

// Helper function to normalize leave timings based on category
function normalizeLeaveTimings(startTime, endTime, category) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  
  switch(category) {
    case 'FDL':
      // Full day leave: 9 AM to 6 PM
      start.setHours(9, 0, 0, 0);
      end.setHours(18, 0, 0, 0);
      break;
    case 'HDL':
      // Half day leave: Either 9 AM to 1 PM or 1 PM to 6 PM
      // For simplicity, assume 9 AM to 1 PM if not specified
      start.setHours(9, 0, 0, 0);
      end.setHours(13, 0, 0, 0);
      break;
    case 'LTO':
      // Late to office: Assume arriving by 11 AM
      start.setHours(9, 0, 0, 0);
      end.setHours(11, 0, 0, 0);
      break;
    case 'LE':
      // Leaving early: Assume leaving at 4 PM
      start.setHours(16, 0, 0, 0);
      end.setHours(18, 0, 0, 0);
      break;
    case 'WFH':
    case 'OOO':
      // Full day: 9 AM to 6 PM
      start.setHours(9, 0, 0, 0);
      end.setHours(18, 0, 0, 0);
      break;
  }
  
  return { startTime: start, endTime: end };
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
        // obj.original = userInput;
        // obj.time = new Date();
      });

      // Process valid responses
      for (const obj of res) {
        if (obj["is_valid"] && obj.category !== 'UNKNOWN') {
          const startDateString = formatDate(obj.start_time);
          const endDateString = formatDate(obj.end_time);
          
          try {
            // Check for any overlapping leaves
            const overlapCheck = await checkForOverlappingLeaves(
              event.user, 
              new Date(obj.start_time), 
              new Date(obj.end_time),
              obj.category
            );
            
            if (overlapCheck.isOverlapping) {
              // Handle exact duplicate for update
              if (overlapCheck.isExactDuplicate) {
                await Message.updateOne({ _id: overlapCheck.existingLeave._id }, { $set: obj });
                say(`Updated existing ${obj.category} record for ${obj.username} from ${startDateString} to ${endDateString}.`);
              } else {
                // Handle conflict case
                say(overlapCheck.message);
              }
            } else {
              // No conflicts, create new leave
              const leave = await Message.create(obj);
              say(
                `*Leave Notification*\n👨‍💻 *Name:* ${obj.username}\n📅 *From:* ${startDateString}\n📅 *To:* ${endDateString}\n⏳ *duration:* ${obj.duration}\n${categoryEmoji[obj.category].emoji} *Type:* ${obj.category} (${categoryEmoji[obj.category].full})\n📝 *Reason:* ${obj.reason || "Not specified"}\n🪪 *LeaveId:* ${leave._id}`
              );
            }
          } catch (error) {
            console.error("Error checking for overlapping leaves:", error);
            say("Sorry, there was an error processing your leave request. Please try again.");
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
    say("Sorry, there was an error processing your leave request. Please try again.");
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

app.command("/latequery", queryHandler);
app.command("/query", queryHandler);
app.command('/cancelleave', handleCancel)

module.exports = app;
