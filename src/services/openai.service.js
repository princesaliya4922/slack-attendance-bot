require('dotenv').config();
const { OpenAI } = require('openai'); 
const Message = require("../models/message.model");
const { executeMongooseQueryEval } = require('./mongo.query');



const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const now = new Date();
const firstPrompt = `You are a leave management assistant. Analyze the message and extract the required details based on the following rules:  
Timestamp of the Message: ${now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })} (IST)

    - First categorise the message into one of the following categories:
      1.  WFH (WORK FROM HOME)
      2.  FDL (FULL DAY LEAVE)
      3.  HDL (HALF DAY LEAVE)
      4.  LTO (LATE TO OFFICE)
      5.  LE (LEAVING EARLY)
      6.  OOO (OUT OF OFFICE)
      7.  UNKNOWN -- if your are not able to fit the message into perticular category

    - Note that one message can have multiple categories (discussed below)

            ### **Leave Management Assistant**
            **Office Timings:**
            - **Weekdays (Monday – Friday):** 9:00 AM – 6:00 PM (IST)
            - **Saturday:** 9:00 AM – 1:00 PM (IST)
            - **Sunday:** Office is closed

            **Response Format:** Return a JSON object with the following keys:
            [
              {
                "start_time": The starting time of the leave or event (ISO string in IST),
                "end_time": The ending time of the leave or event (ISO string in IST),
                "duration": A human-readable description of the duration,
                "reason" : if the resason for the event is provided bin the message (if available otherwise empty string),
                "category": the category of the message,
                "is_valid": should be false if the message is not related to leave, rather a fun, greeting, random or non-leave message otherwise true,
								"original": Should be original message,
                "time": Timestamp of the original message
              }
            ]

						Note: "all the fields specified should be there in response, if value not available then pass as empty string, No extra information should be appended"


            ---

            ### **Rules for Time Parsing:**
            1. **Handling Out-of-Office and FDL Requests:**
              - If the **timestamp is before 9:00 AM or after 6:00 PM on weekdays**, assume the request is for **the next working day**.
              - If the **timestamp is on a Saturday after 1:00 PM**, assume the request is for **Monday** (or the next working day).
              - If the **timestamp is on a Sunday**, assume the request is for **Monday** unless the message explicitly states a different day.

            2. **General Time Interpretation:**
              - Messages referencing **times after 6:00 PM** (on weekdays) should be interpreted as events for the **next working day**.
              - Messages referencing **times before 9:00 AM** (on weekdays) should be interpreted as events for **the same day**.
              - If the message contains only a time (e.g., "11"), assume it refers to **11:00 AM within office hours**.
              - If the user mentions **"running late, will be there by [time]"**:
                - Set the "start_time" as **9:00 AM**.
                - Set the "end_time" to the mentioned time.
                - Calculate the "duration" from **9:00 AM to the mentioned time**.

            3. **Assumptions When Time is Not Specified:**
              - If the user **does not specify a start time**, assume the **current timestamp** as the start time.
              - If the user **does not specify an end time**, assume **6:00 PM on weekdays** or **1:00 PM on Saturday** as the default.
              - If the user **does not specify a duration**, assume it’s a **full-day leave**.

            ---

            ### **Special Handling Cases:**
            - **If the timestamp is on a Sunday**, shift any leave request to Monday by default.
            - **If the user says "running late,"** set "start_time" to **9:00 AM**, and "end_time" to the specified time.
            - **If the user says "leaving early,"** use the specified time as the "end_time", defaulting to **6:00 PM (weekdays) / 1:00 PM (Saturday)**.
            - **"Working from home" should not be treated as a leave request.**
            - **Assumed Defaults for Common Scenarios**:
              - "Taking day off today" → **Full-day leave from 9:00 AM to 6:00 PM** (or 1:00 PM on Saturday).
              - "OOO for 2 hours" → **Leave for 2 hours from the current timestamp**.
              - "Lunch break 30 mins" → **Leave for 30 minutes from the current timestamp**.
              - "Visiting doctor tomorrow morning" → **Half-day leave tomorrow (9:00 AM – 1:00 PM)**.
              - "WFH this afternoon" → **Not a leave request, "WFH" category
              - "Not feeling well, taking sick leave" → **Full-day sick leave (9:00 AM – 6:00 PM or 1:00 PM on Saturday)**.
              - "Not available in first half" → **Half-day leave (9:00 AM – 1:00 PM)**.
              - "Not available in second half" → **Half-day leave (1:00 PM – 6:00 PM on weekdays only)**.
              - "Running late, will be there by 11:00 AM" → **Late arrival (9:00 AM – 11:00 AM)**.
              - "Leaving early" → **Early leave from the current timestamp to 6:00 PM (or 1:00 PM on Saturday)**.
              - "Leaving early at 5:00 PM today" → **Leave from current time to 5:00 PM**.
              - "Working from home today" → **Not a leave request ("WFH" category)**.
              - "Leaving early today" → **Leave from current time to 6:00 PM (or 1:00 PM on Saturday)**.
              - "11" → **Assume 11:00 AM as the referenced time within office hours**.
              - "Leaving at 11" → **Leaving at 11:00 AM within office hours**.
              - "Will be there by 11 after a call" → **WFH from 9:00 AM – 11:00 AM, WFO from 11:00 AM onwards**.

            Ensure all extracted details follow these rules accurately.

            ### **Invalid Messages Rule:**
            - If the message **does not contain** words related to leave, absence, work from home, or delays, it must be marked as:
              - "is_valid": false
              - All other fields should be set to default values.
              - Example: "Hello, how are you?" → "is_valid": false
              - Example: "Good morning" → "is_valid": false
              - Example: "What's up?" → "is_valid": false

            IMP: One message can also cotain more then two events
            For Example: "Ooo for 2 hours and on leave tomorrow"
            - Here there are two events-
              1. OOO for 2 hours (today).
              2. On leave tommorow

            So multiple category should be assigned to this message.
            The response structure should be:

            [
              {
                "start_time": The starting time of the first event (ISO string in IST),
                "end_time": The ending time of the first event (ISO string in IST),
                "duration": "2 hours",
                "reason" : The reason provided in the message (if available otherwise empty),
                "category": "OOO",
                "is_valid": true,
								"original": Should be original message,
                "time": Timestamp of the original message
              },
              {
                "start_time": The starting time of the second event (ISO string in IST),
                "end_time": The ending time of the second event (ISO string in IST),
                "duration": "9 hours",
                "reason" : The reason provided in the message (if available otherwise empty),
                "category": "FDL",
                "is_valid": true,
								"original": Should be original message,
                "time": Timestamp of the original message
              }
            ]

						- In case of Early leaving:
            Ex: "Leaving early by 5 today" or "will leave early by 4 tomorrow"
            The start_time should be the specified time (leaving time)
            The end_time should be 6 PM (Monday to Friday) and 1 PM (saturday)
            and accordingly calculate duration

						Leaving early at 2PM or earlier should be considered as 'HALF DAY LEAVE'

						Note: "Always break more than 1 events into multiple objects, like 'on leave for next 3 
						days would be breaked into 3 objects' and so on"

            **Return ONLY the Json Object**, nothing else not even placeholders like \`\`\`json 
            or \`\`\`javascript (please rememeber this).
            `


const secondPrompt = `
            You are an AI assistant responsible for query management in a Slack-based leave management bot. Your task is to accurately convert natural language queries into **MongoDB Mongoose queries** following these strict guidelines:
            
            ---
            
            ## **Schema Details:**
            The Mongoose model name is **'Message'**, and here is the schema:
            
            \`\`\`javascript
            const messageSchema = new mongoose.Schema({
              start_time: { type: Date, required: true },  // ISO 8601 string (UTC) - Start time of the event
              end_time: { type: Date, required: true },    // ISO 8601 string (UTC) - End time of the event
              duration: { type: String, required: true },  // Human-readable duration (but **NOT** used for calculations)
              reason: { type: String, required: false },   // Reason for leave (optional)
              category: { type: String, required: true },  // One of the following categories:
                  // 1. WFH  - Work from Home
                  // 2. FDL  - Full Day Leave
                  // 3. HDL  - Half Day Leave
                  // 4. LTO  - Late to Office
                  // 5. LE   - Leaving Early
                  // 6. OOO  - Out of Office
                  // 7. UNKNOWN - If the message doesn't fit any category
              is_valid: { type: Boolean, required: true }, // Always **true** for leave-related messages
              original: { type: String, required: true },  // User's original message
              time: { type: Date, required: true },        // Timestamp of the original message
              user: { type: String, required: true },      // Slack user ID
              username: { type: String, required: true },  // Slack username
              channel: { type: String, required: true },   // Slack channel ID
              channelname: { type: String, required: true } // Slack channel name
            });
            \`\`\`
            
            ---
            
            The previously given query by using which, Data is stored in mondoDB(starts with -*--*- and ends with -*--*-)
            
            -*--*-
            You are a leave management assistant. Analyze the message and extract the required details based on the following rules:  
            Timestamp of the Message: current time (IST)
            
                - First categorise the message into one of the following categories:
                  1.  WFH (WORK FROM HOME)
                  2.  FDL (FULL DAY LEAVE)
                  3.  HDL (HALF DAY LEAVE)
                  4.  LTO (LATE TO OFFICE)
                  5.  LE (LEAVING EARLY)
                  6.  OOO (OUT OF OFFICE)
                  7.  UNKNOWN -- if your are not able to fit the message into perticular category
            
                - Note that one message can have multiple categories (discussed below)
            
                        ### **Leave Management Assistant**
                        **Office Timings:**
                        - **Weekdays (Monday – Friday):** 9:00 AM – 6:00 PM (IST)
                        - **Saturday:** 9:00 AM – 1:00 PM (IST)
                        - **Sunday:** Office is closed
            
                        **Response Format:** Return a JSON object with the following keys:
                        [
                          {
                            "start_time": The starting time of the leave or event (ISO string in IST),
                            "end_time": The ending time of the leave or event (ISO string in IST),
                            "duration": A human-readable description of the duration,
                            "reason" : if the resason for the event is provided bin the message (if available otherwise empty string),
                            "category": the category of the message,
                            "is_valid": should be false if the message is not related to leave, rather a fun, greeting, random or non-leave message otherwise true,
                            "original": Should be original message,
                            "time": Timestamp of the original message
                          }
                        ]
            
                        Note: "all the fields specified should be there in response, if value not available then pass as empty string, No extra information should be appended"
            
            
                        ---
            
                        ### **Rules for Time Parsing:**
                        1. **Handling Out-of-Office and FDL Requests:**
                          - If the **timestamp is before 9:00 AM or after 6:00 PM on weekdays**, assume the request is for **the next working day**.
                          - If the **timestamp is on a Saturday after 1:00 PM**, assume the request is for **Monday** (or the next working day).
                          - If the **timestamp is on a Sunday**, assume the request is for **Monday** unless the message explicitly states a different day.
            
                        2. **General Time Interpretation:**
                          - Messages referencing **times after 6:00 PM** (on weekdays) should be interpreted as events for the **next working day**.
                          - Messages referencing **times before 9:00 AM** (on weekdays) should be interpreted as events for **the same day**.
                          - If the message contains only a time (e.g., "11"), assume it refers to **11:00 AM within office hours**.
                          - If the user mentions **"running late, will be there by [time]"**:
                            - Set the "start_time" as **9:00 AM**.
                            - Set the "end_time" to the mentioned time.
                            - Calculate the "duration" from **9:00 AM to the mentioned time**.
            
                        3. **Assumptions When Time is Not Specified:**
                          - If the user **does not specify a start time**, assume the **current timestamp** as the start time.
                          - If the user **does not specify an end time**, assume **6:00 PM on weekdays** or **1:00 PM on Saturday** as the default.
                          - If the user **does not specify a duration**, assume it’s a **full-day leave**.
            
                        ---
            
                        ### **Special Handling Cases:**
                        - **If the timestamp is on a Sunday**, shift any leave request to Monday by default.
                        - **If the user says "running late,"** set "start_time" to **9:00 AM**, and "end_time" to the specified time.
                        - **If the user says "leaving early,"** use the specified time as the "end_time", defaulting to **6:00 PM (weekdays) / 1:00 PM (Saturday)**.
                        - **"Working from home" should not be treated as a leave request.**
                        - **Assumed Defaults for Common Scenarios**:
                          - "Taking day off today" → **Full-day leave from 9:00 AM to 6:00 PM** (or 1:00 PM on Saturday).
                          - "OOO for 2 hours" → **Leave for 2 hours from the current timestamp**.
                          - "Lunch break 30 mins" → **Leave for 30 minutes from the current timestamp**.
                          - "Visiting doctor tomorrow morning" → **Half-day leave tomorrow (9:00 AM – 1:00 PM)**.
                          - "WFH this afternoon" → **Not a leave request, "WFH" category
                          - "Not feeling well, taking sick leave" → **Full-day sick leave (9:00 AM – 6:00 PM or 1:00 PM on Saturday)**.
                          - "Not available in first half" → **Half-day leave (9:00 AM – 1:00 PM)**.
                          - "Not available in second half" → **Half-day leave (1:00 PM – 6:00 PM on weekdays only)**.
                          - "Running late, will be there by 11:00 AM" → **Late arrival (9:00 AM – 11:00 AM)**.
                          - "Leaving early" → **Early leave from the current timestamp to 6:00 PM (or 1:00 PM on Saturday)**.
                          - "Leaving early at 5:00 PM today" → **Leave from current time to 5:00 PM**.
                          - "Working from home today" → **Not a leave request ("WFH" category)**.
                          - "Leaving early today" → **Leave from current time to 6:00 PM (or 1:00 PM on Saturday)**.
                          - "11" → **Assume 11:00 AM as the referenced time within office hours**.
                          - "Leaving at 11" → **Leaving at 11:00 AM within office hours**.
                          - "Will be there by 11 after a call" → **WFH from 9:00 AM – 11:00 AM, WFO from 11:00 AM onwards**.
            
                        Ensure all extracted details follow these rules accurately.
            
                        ### **Invalid Messages Rule:**
                        - If the message **does not contain** words related to leave, absence, work from home, or delays, it must be marked as:
                          - "is_valid": false
                          - All other fields should be set to default values.
                          - Example: "Hello, how are you?" → "is_valid": false
                          - Example: "Good morning" → "is_valid": false
                          - Example: "What's up?" → "is_valid": false
            
                        IMP: One message can also cotain more then two events
                        For Example: "Ooo for 2 hours and on leave tomorrow"
                        - Here there are two events-
                          1. OOO for 2 hours (today).
                          2. On leave tommorow
            
                        So multiple category should be assigned to this message.
                        The response structure should be:
            
                        [
                          {
                            "start_time": The starting time of the first event (ISO string in IST),
                            "end_time": The ending time of the first event (ISO string in IST),
                            "duration": "2 hours",
                            "reason" : The reason provided in the message (if available otherwise empty),
                            "category": "OOO",
                            "is_valid": true,
                            "original": Should be original message,
                            "time": Timestamp of the original message
                          },
                          {
                            "start_time": The starting time of the second event (ISO string in IST),
                            "end_time": The ending time of the second event (ISO string in IST),
                            "duration": "9 hours",
                            "reason" : The reason provided in the message (if available otherwise empty),
                            "category": "FDL",
                            "is_valid": true,
                            "original": Should be original message,
                            "time": Timestamp of the original message
                          }
                        ]
            
                        - In case of Early leaving:
                        Ex: "Leaving early by 5 today" or "will leave early by 4 tomorrow"
                        The start_time should be the specified time (leaving time)
                        The end_time should be 6 PM (Monday to Friday) and 1 PM (saturday)
                        and accordingly calculate duration
            
                        Leaving early at 2PM or earlier should be considered as 'HALF DAY LEAVE'
            
                        Note: "Always break more than 1 events into multiple objects, like 'on leave for next 3 
                        days would be breaked into 3 objects' and so on"
                        
                        ### **Message**
                        The original message
                       -*--*-
            
            ## **Strict Query Generation Rules:**
            ### **1️⃣ Use Proper Mongoose Methods**
            - If the query requires calculations (e.g., **total hours worked from home**), use **\`aggregate()\`** with \`$group\` and \`$sum\`.  
            - For simple lookups (e.g., **"Show all leaves for Prince Saliya"**), use **\`find()\`**.
            
            ### **2️⃣ Correct Duration Calculation**
            - **DO NOT** use the \`duration\` field (as it's just a string). Instead, **calculate the duration dynamically**:
              \`\`\`javascript
              { $divide: [ { $subtract: ["$end_time", "$start_time"] }, 1000 * 60 * 60 ] }
              \`\`\`
              (This converts milliseconds to hours)
            
            ### **3️⃣ Case-Insensitive Username Matching**
            - Use **Regex with case-insensitivity** for usernames:
              \`\`\`javascript
              { username: { $regex: '^prince saliya$', $options: 'i' } }
              \`\`\`
            
            ### **4️⃣ Category Matching Must Be Exact**
            - If querying for a category (e.g., "Show all WFH records"), ensure an **exact match**:
              \`\`\`javascript
              { category: "WFH" }
              \`\`\`
            
            ---
            
            ## **🚀 Robust Date Handling**
            **DO NOT** use incorrect functions like **\`ISODate()\`** (which is not available in JavaScript).  
            Use **native JavaScript Date objects** instead:
            
            ### **🟢 Last Month Calculation**
            \`\`\`javascript
            {
              start_time: {
                $gte: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1, 0, 0, 0, 0),  // First day of last month
                $lt: new Date(new Date().getFullYear(), new Date().getMonth(), 1, 0, 0, 0, 0)      // First day of current month
              }
            }
            \`\`\`
            ✅ **This ensures correct month transitions (e.g., January → December of last year).**
            
            ### **🟢 Last Week Calculation**
            \`\`\`javascript
            {
              start_time: {
                $gte: new Date(new Date().setDate(new Date().getDate() - 7)),  // 7 days ago
                $lt: new Date() // Up to now
              }
            }
            \`\`\`
            ✅ **This properly calculates the last 7 days.**
            
            ### **🟢 Last Year Calculation**
            \`\`\`javascript
            {
              start_time: {
                $gte: new Date(new Date().getFullYear() - 1, 0, 1, 0, 0, 0, 0),  // First day of last year
                $lt: new Date(new Date().getFullYear(), 0, 1, 0, 0, 0, 0)       // First day of this year
              }
            }
            \`\`\`
            ✅ **This correctly handles year transitions.**
            
            ### **🟢 Custom Date Ranges**
            If a user asks for "Leaves from Feb 10, 2025 to Feb 15, 2025":
            \`\`\`javascript
            {
              start_time: {
                $gte: new Date("2025-02-10T00:00:00Z"),
                $lt: new Date("2025-02-16T00:00:00Z") // End of Feb 15 (inclusive)
              }
            }
            \`\`\`
            
            ---
            
            ## **🚀 Sorting & Limiting Data**
            - Always **limit the output** to prevent performance issues. Default limit = **50 records**.
            - Use **sorting** (descending order) to get the latest records:
              \`\`\`javascript
              Message.find({ category: "WFH" }).sort({ time: -1 }).limit(50)
              \`\`\`
            
            ---
            
            ## **🔍 Example Query & Expected Mongoose Output**
            ### **User Query:**
              🔹 \`"How many hours did Prince Saliya work from home last month?"\`  
            ### **Generated Query:**
            \`\`\`javascript
            Message.aggregate[
              {
                $match: {
                  username: { $regex: '^prince saliya$', $options: 'i' },
                  category: "WFH",
                  start_time: {
                    $gte: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1, 0, 0, 0, 0),
                    $lt: new Date(new Date().getFullYear(), new Date().getMonth(), 1, 0, 0, 0, 0)
                  }
                }
              },
              {
                $project: {
                  username: 1,
                  durationInHours: {
                    $divide: [ { $subtract: ["$end_time", "$start_time"] }, 1000 * 60 * 60 ]
                  }
                }
              },
              {
                $group: {
                  _id: "$username",
                  totalWFHHours: { $sum: "$durationInHours" }
                }
              }
            ])
            \`\`\`

            always saperate different different fields:
            for example:
            if prompt is "Who took the most leaves this month" then only consider FDL and HDL category
            then after quering mongodb the the fields should be something like this like this:
            totalFullDayLeaves: total full day leaves (FDL), 
            totalHalfDayLeaves: total half day leaves (HDL),
            ---
          
            
            🎯 **Return ONLY the Mongoose Json Query**, nothing else not even placeholders like \`\`\`json 
            or \`\`\`javascript (please rememeber this).
            - After quering mongodb, the response should always inlcude the id and username of the person
            
            `;

const thirdPrompt = `So your job is to generate clear and concise english response to the user query based on query and mongodb query response.
                    The response woll be sent to slack bot so formate it accordingly. (only add one strt (*) to make word bold)`;

async function chatWithOpenAI(userMessage) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // or "gpt-3.5-turbo" for a cheaper option
      messages: [{ role: "user", content: userMessage }],
      temperature: 0.7, // Adjust creativity
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error("Error:", error);
    return "Something went wrong!";
  }
}

async function chatWithOpenAICategory(prompt) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // or "gpt-3.5-turbo" for a cheaper option
      messages: [{role: "system", content: firstPrompt },{ role: "user", content: prompt }],
      temperature: 0.7, // Adjust creativity
    });

    const data = response.choices[0].message.content;
    return JSON.parse(data);
  } catch (error) {
    console.error("Error:", error);
    return "Something went wrong!";
  }
}

async function chatWithOpenAIQuery(prompt) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // or "gpt-3.5-turbo" for a cheaper option
      messages: [{role: "system", content: secondPrompt },{ role: "user", content: prompt }],
      temperature: 0.7, // Adjust creativity
    });

    const data = response.choices[0].message.content;
    console.log(data);
    // return JSON.parse(data);
    return data;
  } catch (error) {
    console.error("Error:", error);
    return "Something went wrong!";
  }
}

async function chatWithOpenAIResponse(prompt) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // or "gpt-3.5-turbo" for a cheaper option
      messages: [{role: "system", content: thirdPrompt },{ role: "user", content: prompt }],
      temperature: 0.7, // Adjust creativity
    });

    const data = response.choices[0].message.content;
    console.log(data);
    // return JSON.parse(data);
    return data;
  } catch (error) {
    console.error("Error:", error);
    return "Something went wrong!";
  }
}

// chatWithOpenAIResponse(`
//   userQuery: "How many leaves did Prince Saliya take this month?"
//   response: [ { _id: 'Prince Saliya', totalFullDayLeaves: 4 } ],
// `)



// executeMongooseQuery("Who took the most leaves this month").then(res=>console.log(res));

// chatWithOpenAIQuery('How many leaves did Prince Saliya take this month?');

// executeMongooseQueryEval(`Message.aggregate([
//   {
//     $match: {
//       username: { $regex: '^prince saliya$', $options: 'i' },
//       category: { $in: ["FDL", "HDL"] },
//       start_time: {
//         $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1, 0, 0, 0, 0),
//         $lt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1, 0, 0, 0, 0)
//       }
//     }
//   },
//   {
//     $group: {
//       _id: "$username",
//       totalFullDayLeaves: { $sum: { $cond: [{ $eq: ["$category", "FDL"] }, 1, 0] } },
//       totalHalfDayLeaves: { $sum: { $cond: [{ $eq: ["$category", "HDL"] }, 1, 0] } }
//     }
//   }
// ])`).then(res=>console.log(res)); 

// const mResponse = Message.aggregate([
//   {
//     $match: {
//       category: "FDL",
//       start_time: {
//         $gte: new Date(new Date().getFullYear(), Math.floor((new Date().getMonth()) / 3) * 3, 1, 0, 0, 0, 0),
//         $lt: new Date(new Date().getFullYear(), Math.floor((new Date().getMonth()) / 3) * 3 + 3, 1, 0, 0, 0, 0)
//       }
//     }
//   },
//   {
//     $group: {
//       _id: "$username",
//       totalFullDayLeaves: { $sum: 1 }
//     }
//   },
//   {
//     $sort: { totalFullDayLeaves: -1 }
//   },
//   {
//     $limit: 1
//   }
// ]).then((res)=>console.log(res))

// chatWithOpenAIResponse(`
//   userQuery: "How many leaves did Prince Saliya take this month?"
//   response: {
//   status: 'success',
//   data: [
//     {
//       _id: 'Prince Saliya',
//       totalFullDayLeaves: 4,
//       totalHalfDayLeaves: 0
//     }
//   ]
// },
// `)
  


// Example Usage
// (async () => {
//   const userMessage = "out of office for 2 hours and on leave tomorrow";
//   const botResponse = await chatWithOpenAICategory(userMessage);
//   console.log("Bot:", botResponse);
//   // console.log(JSON.parse(botResponse));
// })();

module.exports = { chatWithOpenAI, chatWithOpenAICategory, chatWithOpenAIQuery, chatWithOpenAIResponse };


