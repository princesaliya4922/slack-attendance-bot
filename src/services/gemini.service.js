const { GoogleGenerativeAI } = require("@google/generative-ai");
const Message = require("../models/message.model");
const API_KEY = "AIzaSyB1LntCRcqpSBc6oXzAlKRgRNHWx6ywAqQ";
const genAI = new GoogleGenerativeAI(API_KEY);

const now = new Date()


async function chatWithGemini(prompt) {

const finalMsg = `
You are a leave management assistant. Analyze the message and extract the required details based on the following rules:
Timestamp of the Message: ${now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })} (IST)
Todays's Day: ${now.toLocaleString("en-US", { timeZone: "Asia/Kolkata", weekday: "long" })}

### **Leave Management Assistant**
#### **Office Timings:**
- **Weekdays (Monday – Friday):** 9:00 AM – 6:00 PM (IST)
- **Saturday:** 9:00 AM – 1:00 PM (IST)
- **Sunday:** Office is closed

#### **Response Format:**
Return a JSON array with the following structure for each event extracted from the message:
\`\`\`json
[
  {
    "start_time": "The starting time of the leave or event (ISO string in IST)",
    "end_time": "The ending time of the leave or event (ISO string in IST)",
    "duration": "Human-readable duration",
    "reason": "Reason extracted from message (if available, otherwise empty string)",
    "category": "One of the predefined categories",
    "is_valid": true/false (should be false if the message is not related to leave, rather a fun, greeting or not valid leave request),
    "errMessage": "Error message if is_valid is false, otherwise empty string",
    "original": "Original message",
    "time": "Timestamp of the original message"
  }
]
\`\`\`

Note: "all the fields specified should be there in response, if value not available then pass as empty string, No extra information should be appended"

#### **Categories:**
1. **WFH (WORK FROM HOME)**
2. **FDL (FULL DAY LEAVE)**
3. **HDL (HALF DAY LEAVE)**
4. **LTO (LATE TO OFFICE)**
5. **LE (LEAVING EARLY)**
6. **OOO (OUT OF OFFICE)** (Includes AFK - Away from Keyboard)
7. **UNKNOWN** (If the message does not fit any category)

### **General Rules for Categorization and Time Parsing:**
1. **Handling Out-of-Office (OOO) and FDL Requests:**
   - If the message is sent **before 9:00 AM or after 6:00 PM on weekdays**, assume the leave is for the **next working day**.
   - If sent **on a Saturday after 1:00 PM or on a Sunday**, assume the leave is for **Monday (or next working day)** unless explicitly mentioned otherwise.

2. **Handling Messages with Time References:**
   - If the message contains a time **after 6:00 PM**, interpret it as an event for the **next working day**.
   - If it contains a time **before 9:00 AM**, assume the event is for the **same day**.
   - A single time reference like **"11"** should be assumed as **11:00 AM**.

3. **Assumptions When Time is Not Specified:**
        - If the user **does not specify a start time**, assume the **current timestamp** as the start time.
        - If the user **does not specify an end time**, assume **6:00 PM on weekdays** or **1:00 PM on Saturday** as the default.
        - If the user **does not specify a duration**, assume it’s a **full-day leave**.

4. **Late to Office (LTO) Handling:**
   - If an employee says **"Running late, will be there by 11"**, then:
     - \`start_time = 9:00 AM\`
     - \`end_time = 11:00 AM\`
     - \`duration = 2 hours\`
     - \`category = LTO\`

5. **Leaving Early (LE) Handling:**
   - If an employee says **"Leaving early at 5 PM today"**, then:
     - \`start_time = 5:00 PM\`
     - \`end_time = 6:00 PM (weekdays) / 1:00 PM (Saturday)\`
     - \`duration = 1 hour\`
     - \`category = LE\`
   - If an employee leaves **between 1 PM and 2 PM**, categorize as **HDL** **(Only on Monday to Friday) otherwise ignore it**.
   - If an employee requests **LE (leaving early) after 6 PM (in context of today or time is not specified)**, set \`is_valid = false\`.(specify errMessage creatively like "It's already 'current-time' bro, chill 'emoji'") (IMPORTANT)
   - If leaving early message come durring office hours (9am to 6pm weekdays and 9am to 1pm on saturday) but the message is like this:
     - weekdays -> message: "Leaving early at at 7pm today" -> here the office timing is 9am to 6pm so this message is invalid **\`is_valid = false\`**
     - saturday -> message: "Leaving early at at 2pm today" -> here the office timing is 9am to 1pm so this message is invalid **\`is_valid = false\`**
    - specify errMessage accordingly like (You can't leave early after office hours, 'emoji')

6. **WFH Handling:**
   - "WFH today" → \`category = WFH\` (not a leave request).
   - "Will be WFH till 11 AM" → WFH from **9:00 AM to 11:00 AM**.
   - "will arrive little late by 11 till then WFH" → in this case employee is late but working from home 
      so only consider WFH category and not LTO.
      { "category": "WFH", "start_time": "9am", "end_time": "11am", "duration": "2 hours", ... }

7. **Multiple Events in a Single Message:**
   - Messages like **"OOO for 2 hours and on leave tomorrow"** should be split into **two objects**:
     \`\`\`json
     [
       { "category": "OOO", "duration": "2 hours", ... },
       { "category": "FDL", "duration": "9 hours", ... }
     ]
     \`\`\`
   - "On leave for the next 3 days" should be **split into three separate objects**.
   - Always consider to split multiple events into multiple object until there is any exeption
     like "will arrive little late by 11 till then WFH" (here two events are related to each other
     as we discussed earlier)

8. **Past Leaves Handling:**
   - If the requested leave date is **more than 6 months in the past**, set \`is_valid = false\` and \`errMessage = "You can't take leave in the past, Do you want me to time travel? 'emoji'"\`.
   - If an employee requests **OOO for 2 hours after 6 PM or before 9 AM**, set \`is_valid = false\`. (IMPORTANT)
   

### **Special Cases & Assumptions:**
- **"Not feeling well, taking sick leave"** → \`FDL\` (Full-day leave from 9:00 AM – 6:00 PM or 1:00 PM on Saturday).
- **"Not available in first half"** → \`HDL\` (9:00 AM – 1:00 PM).
- **"Not available in second half"** → \`HDL\` (1:00 PM – 6:00 PM on weekdays).
- **"Lunch break 30 mins"** → \`OOO\` (30-minute absence from the current timestamp).
- **"Leaving early today"** → **LE from the current time to 6:00 PM (or 1:00 PM on Saturday)**.
- **"Will be there by 11 after a call"** → **WFH from 9:00 AM – 11:00 AM**.
- **"Will be there by 11"** → **LTO (9:00 AM – 11:00 AM)**.
- **"Working from home today"** → **Not a leave request ("WFH" category)**.
- **"Visiting doctor tomorrow morning"** → **Half-day leave tomorrow (9:00 AM – 1:00 PM)**.
- **"OOO for 2 hours"** → **OOO for 2 hours from the current timestamp**.
- **"Leaving early"** → **Early leave from the current timestamp to 6:00 PM (or 1:00 PM on Saturday)**.
- **"Leaving early at 5:00 PM today"** → **LE (start_time: 5 PM, end_time: 6 PM, duration: 1 hour)**.

Ensure all extracted details follow these rules accurately.

### **Invalid Messages Handling:**
- If the message **does not contain** words related to leave, absence, WFH, or delays:
  - Set \`is_valid = false\`.
  - Set \`errMessage = "Not a leave-related message"\`.
  - Example:
    - **"Hello, how are you?"** → \`is_valid: false, errMessage: "Not a leave-related message"\`
    - **"Good morning"** → \`is_valid: false, errMessage: "Not a leave-related message"\`
    - **"What's up?"** → \`is_valid: false, errMessage: "Not a leave-related message"\`

### **Final Notes:**
- First ensure which day is today (monday to friday or saturday or sunday) and look at office timings and then calculate accordingly.
- **Time calculations should be precise** (especially \`start_time\`, \`end_time\`, and \`duration\`).
generally start_time and end_time would be the time duration in which employee is not in office, and duration is the difference bw start_time and end_time
- **All times must be in IST.**
- **Break multiple events into separate objects**.
- **Ensure response format strictly follows JSON format and without any formating placeholders like \`\`\`javascript or \`\`\`json.**
- Im gonna send errMessage to employee in slack group so if you are specifying errMessage then make sure format it according to slack in some cool way (with emogi or something) and make it user friendly.
but if message is not in context of today (example: "Will leave early tomorrow at 4pm") then obviously it should be valid (is_valid = true) and errMessage should be empty string.
- On saturday office close time is **1 PM** so make sure to consider this while calculating end_time on saturday. let say if today is friday and message is "will leave early tomorrow at 4pm" or something like that
then since tomorrow saturday so is_true should be false and errMessage creatively based on user message (in some fun way) like "it's saturday bro" or something like that.
- Remember office closes at 1 PM on saturday so make sure to consider this while calculating end_time on saturday.
- Negative timings doesn't work, if start_time is greater than end_time then set **is_valid to false**

### **Message**
${prompt}
`;

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const result = await model.generateContent(finalMsg);
    const response = result.response;
    // console.log("Gemini Response:", response.text());
    const cleanJson = response.text().replace(/```json|```/g, "").trim();
    // console.log(cleanJson);
    // console.log(JSON.parse(cleanJson));
    return JSON.parse(cleanJson);
}

async function queryGemini(prompt) {

  const finalMsg = `
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
Message.aggregate([
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

---

## **🔹 Now Convert This Query:**
🔍 **User Query:**  
  **"${prompt}"**

🎯 **Return ONLY the Mongoose Query**, nothing else.
`;



  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const result = await model.generateContent(finalMsg);
  const response = result.response;
  // console.log("Gemini Response:", response.text());
  // const cleanJson = response.text().replace(/```json|```/g, "").trim();
  // console.log(cleanJson); 
  // console.log(JSON.parse(cleanJson));
  console.log('query',response.text());

  const mResponse=await Message.aggregate([
    {
      $match: {
        category: { $in: ["FDL", "HDL", "OOO"] }  // Include only relevant leave categories
      }
    },
    {
      $group: {
        _id: "$username",
        totalLeaveDays: { $sum: 1 }  // Count number of leave records per user
      }
    },
    {
      $sort: { totalLeaveDays: -1 }  // Sort in descending order
    },
    {
      $limit: 1  // Get only the top result (remove this if ranking all users)
    }
  ])
  
  

  // console.log('mResponse',mResponse);
  // return JSON.parse(cleanJson);
}

// queryGemini('Who took the most leaves this month');

// Example Usage
// chatWithGemini("on leave tomorrow");
 
module.exports = chatWithGemini;
