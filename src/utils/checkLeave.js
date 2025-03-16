const Message = require("../models/message.model");

async function checkLeave(startTime, endTime, userName) {
  // Step 1: Calculate Start and End of the Day based on the startTime

  const startDate = new Date(startTime);
  const endDate = new Date(endTime);

  console.log("CheckLeave startDate", startDate, endDate);

  // Ensure the start and end times are in ISO format
  const startOfDay = new Date(startDate);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const startOfDayISO = startOfDay.toISOString();

  const endOfDay = new Date(startDate);
  endOfDay.setUTCHours(23, 59, 59, 999);
  const endOfDayISO = endOfDay.toISOString();

  // Fetch existing records for the entire day
  const existingRecords = await Message.find({
    username: userName,
    start_time: { $lt: endOfDayISO },
    end_time: { $gt: startOfDayISO },
  });

  console.log(existingRecords, "Existing Records");

  // Step 3: Check for conflicts
  const conflict = existingRecords.some((existingEvent) => {
    console.log(startTime, existingEvent.start_time);
    return (
      (startDate >= existingEvent.start_time &&
        startDate < existingEvent.end_time) ||
      (endDate > existingEvent.start_time &&
        endDate <= existingEvent.end_time) ||
      (startDate <= existingEvent.start_time &&
        endDate >= existingEvent.end_time)
    );
  });

  console.log("conflict", conflict, "conflict");

  if (conflict) {
    // Step 4: Return Result
    const categories = existingRecords
      .map((event) => event.category)
      .join(", ");
    const errorMessage = `Your event conflicts with existing events in the categories: ${categories}. Please resolve these conflicts before scheduling a new event.`;

    return errorMessage;
  }

  // No conflict found
  return null;
}

module.exports = checkLeave;
