const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  start_time: { type: Date, required: true },
  end_time: { type: Date, required: true },
  duration: { type: String, required: true },
  reason: { type: String, required: false },
  category: { type: String, required: true },
  is_valid: { type: Boolean, required: true },
  original: { type: String, required: true },
  time: { type: Date, required: true },
  user: { type: String, required: true },
  username: { type: String, required: true },
  channel: { type: String, required: true },
  channelname: { type: String, required: true },
});

module.exports = mongoose.model("Message", messageSchema);
