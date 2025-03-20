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

// Listen for messages and save them to MongoDB
app.event("message", async ({ event, say }) => {
  try {
    if (!event.subtype) {
      console.log(`📩 Message from ${event.user}: ${event.text}`);

      const userInput = event.text.trim();

      const res = await chatWithGeminiCategory(userInput);
      const username = await getUserName(event.user);
      const channelname = await getChannelName(event.channel);

      // console.log(res);

      res.forEach((obj) => {
        obj.user = event.user;
        obj.channel = event.channel;
        obj.username = username;
        obj.channelname = channelname;
      });

      // Store valid responses in MongoDB

      for (const obj of res) {
        const startDateString = new Date(obj.start_time).toLocaleString(
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
        const endDateString = new Date(obj.end_time).toLocaleString("en-GB", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        });

        if (obj["is_valid"] && obj.category !== 'UNKNOWN') {
          // Check for existing record with the same category and time
          const existingRecord = await Message.findOne({
            category: obj.category,
            start_time: obj.start_time,
            end_time: obj.end_time,
          });

          if (existingRecord) {
            // Update the existing record
            await Message.updateOne({ _id: existingRecord._id }, { $set: obj });
            say(`Updated existing leave record for ${obj.username}.`);
          } else {
            // Insert new record
            const leave = await Message.insertOne(obj);
            say(
              `*Leave Notification*\n👨‍💻 *Name:* ${
                obj.username
              }\n📅 *From:* ${startDateString}\n📅 *To:* ${endDateString}\n⏳ *duration:* ${
                obj.duration
              }\n${categoryEmoji[obj.category].emoji} *Type:* ${obj.category} (${categoryEmoji[obj.category].full})\n📝 *Reason:* ${
                obj.reason || "Not specified"
              }\n🪪 *LeaveId:* ${leave._id}`
            );
          }
        } else if (obj.errMessage.length) {
          say(obj.errMessage);
        }
      }

      // console.log(res);
    }
  } catch (error) {
    console.error("❌ Error handling message:", error);
  }
});

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
