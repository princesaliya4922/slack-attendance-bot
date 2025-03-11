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




// Listen for messages and save them to MongoDB
app.event("message", async ({ event }) => {
  try {
    if (!event.subtype) {
      console.log(`📩 Message from ${event.user}: ${event.text}`);

      // const newMessage = new Message({
      //   user: event.user,
      //   text: event.text,
      //   ts: event.ts,
      //   channel: event.channel,
      // });

      // await newMessage.save();

      const res = await chatWithGemini(event.text);
      const username = await getUserName(event.user);
      const channelname = await getChannelName(event.channel);
      res.forEach(obj=>{
        obj.user = event.user;
        obj.channel = event.channel;
        obj.username = username;
        obj.channelname = channelname;
      });

      //store to mongodb
      for (const obj of res) {
        if (obj['is_valid']) {
          await Message.insertOne(obj);
        }
      }      
      // await Message.insertMany(res);
      
      // res.channelName = await getChannelName(newMessage.channel);
      console.log(res)
      // console.log(await getUserName(newMessage.user));
      

    }
  } catch (error) {
    console.error("❌ Error handling message:", error);
  }
});

module.exports = app;
