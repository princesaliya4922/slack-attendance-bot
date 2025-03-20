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
    else if (event.subtype === "message_changed"){
      const oldMessage = event.previous_message.text.trim();
      const newMessage = event.message.text.trim();
      const userId = event.message.user;
      const channelId = event.channel;

      const leaves = await Message.find({ user: userId, original: oldMessage });
      leaves.forEach((leave)=>{
        if(leave.end_time.getTime() < now.getTime()){
          Message.deleteOne({_id: leave._id });
        }
      })
      // await Message.deleteMany({ user: userId, original: oldMessage });

      // console.log('old m:', newMessage)
      const res = await chatWithGeminiCategory(newMessage);
      const username = await getUserName(userId);
      const channelname = await getChannelName(channelId);
      res.forEach((obj) => {
        obj.user = userId;
        obj.channel = channelId;
        obj.username = username;
        obj.channelname = channelname;
      });

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
              `*Leave Updated*\n👨‍💻 *Name:* ${
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
      
    }
  } catch (error) {
    console.error("❌ Error handling message:", error);
  }
});