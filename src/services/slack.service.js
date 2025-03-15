const { App } = require("@slack/bolt");
const Message = require("../models/message.model");
const env = require("../config/env");
const { chatWithGemini, queryGemini, responseGemini } = require("./gemini.service");
const {
  chatWithOpenAICategory,
  chatWithOpenAIQuery,
  chatWithOpenAIResponse,
} = require("./openai.service");
const { executeMongooseQueryEval } = require("./mongo.query");

// console.log(env.SLACK_APP_TOKEN)

const categoryEmoji = {
  'WFH': {
    emoji: '🏠',
    full: "Work From Home"
  },
  'FDL': {
    emoji: '🌴',
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

// async function parseQuery(queryText) {
//   try {
//     const response = await chatWithOpenAIQuery(queryText);
//     return JSON.parse(response);
//   } catch (error) {
//     console.error("❌ Error parsing query:", error);
//     return null;
//   }
// }

// async function executeQuery(query) {
//   try {
//     return await Message.find(query);
//   } catch (error) {
//     console.error("❌ Error executing MongoDB query:", error);
//     return [];
//   }
// }

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

      // Check if the message is a query
      // if (userInput.startsWith("$query")) {
      //   const queryText = userInput.replace("$query", "").trim();
      //   if (!queryText) {
      //     await say(
      //       "Please provide a query. Example: `$query show all leaves for John`"
      //     );
      //     return;
      //   }

      //   const mongoQuery = await chatWithOpenAIQuery(queryText);
      //   console.log("MongoDB Query:", mongoQuery);
      //   const mongoResponse = await executeMongooseQueryEval(mongoQuery);
      //   console.log("MongoDB Response:", mongoResponse);
      //   const finalResponse = await chatWithOpenAIResponse(
      //     `MongoDB Query: ${mongoQuery}\n\nMongoDB Response: ${JSON.stringify(
      //       mongoResponse
      //     )}`
      //   );
      //   console.log("Final Response:", finalResponse);
      //   // const results = await executeQuery(structuredQuery);

      //   if (finalResponse?.length === 0) {
      //     await say("No records found.");
      //   } else {
      //     await say(finalResponse);
      //   }

      //   return; // Stop further processing
      // }

      // Process normal messages with Gemini

      const res = await chatWithGemini(userInput);
      const username = await getUserName(event.user);
      const channelname = await getChannelName(event.channel);

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

        if (obj["is_valid"]) {
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
            await Message.insertOne(obj);
            say(
              `*Leave Notification*\n👨‍💻 *Name:* ${
                obj.username
              }\n📅 *From:* ${startDateString}\n📅 *To:* ${endDateString}\n⏳ *duration:* ${
                obj.duration
              }\n${categoryEmoji[obj.category].emoji} *Type:* ${obj.category} (${categoryEmoji[obj.category].full})\n📝 *Reason:* ${
                obj.reason || "Not specified"
              }\n`
            );
          }
        } else if (obj.errMessage.length) {
          say(obj.errMessage);
        }
      }

      console.log(res);
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

    const mongoQuery = await queryGemini(queryText);
    console.log("MongoDB Query:", mongoQuery);
    const mongoResponse = await executeMongooseQueryEval(mongoQuery);
    console.log("MongoDB Response:", mongoResponse);
    const finalResponse = await chatWithOpenAIResponse(
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
    // const mongoQuery = await chatWithOpenAIQuery(queryText);
    // console.log("MongoDB Query:", mongoQuery);

    // // Execute the query
    // const mongoResponse = await executeMongooseQueryEval(mongoQuery);
    // console.log("MongoDB Response:", mongoResponse);

    // // Get a final human-readable response
    // const finalResponse = await chatWithOpenAIResponse(
    //   `MongoDB Query: ${mongoQuery}\n\nMongoDB Response: ${JSON.stringify(mongoResponse)}`
    // );
    // console.log("Final Response:", finalResponse);

    // if (!finalResponse || finalResponse.length === 0) {
    //   await respond("No records found.");
    // } else {
    //   await respond(finalResponse);
    // }
  } catch (error) {
    console.error("❌ Error handling /query command:", error);
    await respond("An error occurred while processing your query.");
  }
}

app.command("/latequery", queryHandler);
app.command("/query", queryHandler);

module.exports = app;
