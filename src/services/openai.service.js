require('dotenv').config();
const { OpenAI } = require('openai'); 
const Message = require("../models/message.model");
const { executeMongooseQueryEval } = require('./mongo.query');
const {openaiCategoryPromptFinal, openaiQueryPromptFinal, openaiResponsePromptFinal} = require('./prompts')

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const now = new Date();
const firstPrompt = openaiCategoryPromptFinal();


const thirdPrompt = `
current Time: ${now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })} (IST)
Todays's Day: ${now.toLocaleString("en-US", { timeZone: "Asia/Kolkata", weekday: "long" })}

So your job is to generate clear and concise english response to the user query based on query and mongodb query response.

here is some information about leave category:

#### **Categories:**
1. **WFH (WORK FROM HOME)**
2. **FDL (FULL DAY LEAVE)**
3. **HDL (HALF DAY LEAVE)**
4. **LTO (LATE TO OFFICE)**
5. **LE (LEAVING EARLY)**
6. **OOO (OUT OF OFFICE)**


Note : The below is the given example of response format, you can use this format to generate response. But doesn't mean you have to use this format only, you can generate response in your own way but it should be clear and concise and creative. !Important just make sure dont use below format in response use your creativity to generate a clear concise and creative response. 
🌴 for Full Day Leave (FDL)
🌓 for Half Day Leave (HDL)
⏰ for Late to Office (LTO)
🏃‍♂️ for Leaving Early (LE)
🚪 for Out of Office (OOO)
🏡 for Work From Home (WFH)


- The response will be sent to slack bot so format it accordingly.

- 'groupedDocuments' field contains all the refered documents in the of that perticular group. so if 
  any additional information is required (asked in query) then it should be there in 'groupedDocuments' field.

- Just dont add all the information of 'groupedDocuments' in response, just add necessary details and format it nicely.

- The response should be in good format and add emojis to make it more user friendly.

- conver dates in human readable way and use IST timezone.

- If query is Asking for all leave details then give it.
`;

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
    const cleanJson = data.replace(/^```(json|javascript)\n|\n```$/g, '').trim();
    return JSON.parse(cleanJson);
  } catch (error) {
    console.error("Error:", error);
    return "Something went wrong!";
  }
}

async function chatWithOpenAIQuery(prompt) {
  try {
    const secondPrompt = openaiQueryPromptFinal(prompt);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // or "gpt-3.5-turbo" for a cheaper option
      messages: [{role: "system", content: secondPrompt },{ role: "user", content: prompt }],
      temperature: 0.7, // Adjust creativity
    });

    const data = response.choices[0].message.content;
    const cleanJson = data.replace(/^```(json|javascript)\n|\n```$/g, '').trim();
    console.log(cleanJson);
    // return JSON.parse(data);
    return cleanJson;
  } catch (error) {
    console.error("Error:", error);
    return "Something went wrong!";
  }
}

async function chatWithOpenAIResponse(prompt) {
  try {


    const finalMsg = openaiResponsePromptFinal(prompt);
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // or "gpt-3.5-turbo" for a cheaper option
      messages: [{role: "system", content: finalMsg },{ role: "user", content: prompt }],
      temperature: 0.7, // Adjust creativity
    });

    const data = response.choices[0].message.content;
    console.log(data);
    // return JSON.parse(data);
    return data.replace(/\*\*/g, "*");
  } catch (error) {
    console.error("Error:", error);
    return "Something went wrong!";
  }
}


module.exports = { chatWithOpenAI, chatWithOpenAICategory, chatWithOpenAIQuery, chatWithOpenAIResponse };


