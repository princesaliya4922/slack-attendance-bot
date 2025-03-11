const { GoogleGenerativeAI } = require("@google/generative-ai");

const API_KEY = "AIzaSyB1LntCRcqpSBc6oXzAlKRgRNHWx6ywAqQ";
const genAI = new GoogleGenerativeAI(API_KEY);

const now = new Date()


async function chatWithGemini(prompt) {

    const finalMsg = `You are a leave management assistant. Analyze the message and extract the required details based on the following rules:  
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
            
            ### **Message**
            ${prompt}
            `

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const result = await model.generateContent(finalMsg);
    const response = result.response;
    // console.log("Gemini Response:", response.text());
    const cleanJson = response.text().replace(/```json|```/g, "").trim();
    // console.log(cleanJson);
    // console.log(JSON.parse(cleanJson));
    return JSON.parse(cleanJson);
}

// Example Usage
chatWithGemini("on leave tomorrow");

module.exports = chatWithGemini;
