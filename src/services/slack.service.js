const { App } = require("@slack/bolt");
const Message = require("../models/message.model");
const env = require("../config/env");
const chatWithGemini = require("./gemini.service");

// console.log(env.SLACK_APP_TOKEN)

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

    return response.user ? response.user.real_name || response.user.name : "Unknown User";
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


async function parseQuery(queryText) {
  try {
    const response = await chatWithGemini(`Convert this query into a MongoDB JSON query: ${queryText}`);
    return JSON.parse(response);
  } catch (error) {
    console.error("❌ Error parsing query:", error);
    return null;
  }
}


async function executeQuery(query) {
  try {
    return await Message.find(query);
  } catch (error) {
    console.error("❌ Error executing MongoDB query:", error);
    return [];
  }
}

function formatResults(results) {
  return results.map(r => `📌 **${r.username}** was on **${r.category}** leave from ${r.start_time} to ${r.end_time}`).join("\n");
}





// Listen for messages and save them to MongoDB
app.event("message", async ({ event, say }) => {
  try {
    if (!event.subtype) {
      console.log(`📩 Message from ${event.user}: ${event.text}`);

      const userInput = event.text.trim();

      // Check if the message is a query
      if (userInput.startsWith("/attquery")) {
        const queryText = userInput.replace("/attquery", "").trim();
        if (!queryText) {
          await say("Please provide a query. Example: `/attquery show all leaves for John`");
          return;
        }

        const structuredQuery = await parseQuery(queryText);
        const results = await executeQuery(structuredQuery);

        if (results.length === 0) {
          await say("No records found.");
        } else {
          await say(formatResults(results));
        }

        return; // Stop further processing
      }

      // Process normal messages with Gemini
      const res = await chatWithGemini(userInput);
      const username = await getUserName(event.user);
      const channelname = await getChannelName(event.channel);

      res.forEach(obj => {
        obj.user = event.user;
        obj.channel = event.channel;
        obj.username = username;
        obj.channelname = channelname;
      });

      // Store valid responses in MongoDB
      for (const obj of res) {
        if (obj["is_valid"]) {
          await Message.insertOne(obj);
        }
      }

      console.log(res);
    }
  } catch (error) {
    console.error("❌ Error handling message:", error);
  }
});


module.exports = app;
